/* Owns explicit OpenSSH observation and bounded subprocess cleanup. */
import { spawn, execFile as nodeExecFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { SystemGitRepository } from './git-repository.js';
import { SystemGitConfig } from './git-config.js';
import { FileRoleStore } from './role-store.js';
import { openSync, closeSync } from 'node:fs';
import type { AuthObservation, AuthTester } from '../application/auth-test.js';
import { isSafeAuthDestination } from '../application/auth-test.js';
import type { RemoteInfo } from './git-repository.js';

/** Detect an actual terminal without allocating one or reading credentials. */
export function hasAuthTerminal(): boolean {
  if (!process.stdin.isTTY || !process.stderr.isTTY) return false;
  try { const fd = openSync('/dev/tty', 'r+'); closeSync(fd); return true; } catch { return false; }
}

/** Cancellable local reads for the same budget as the explicit SSH operation. */
export function authTestInputs(signal: AbortSignal) {
  const execFile = promisify(nodeExecFile);
  const exec = (file: string, args: string[], options?: { env: NodeJS.ProcessEnv }) =>
    execFile(file, args, { ...options, signal, encoding: 'utf8' as const });
  return {
    repository: new SystemGitRepository({ exec }),
    gitConfig: new SystemGitConfig({ exec }),
    roleStore: new FileRoleStore({ createIfMissing: false })
  };
}

interface Execution {
  code: number | null;
  stdout: string;
  stderr: string;
  failure?: string;
}

/** Best-effort ancestry tracking; the inherited terminal group may contain unrelated peers. */
function trackDescendants(child: ChildProcess) {
  const known = new Map<number, string>();
  let rootRunning = true, stopped = false;
  child.once('exit', () => { rootRunning = false; });
  const exec = promisify(nodeExecFile);
  type Entry = { parent: number; started: string };
  let pending: Promise<Map<number, Entry>> | undefined;
  const refresh = () => {
    if (pending) return pending;
    pending = (async () => {
      const rows = new Map<number, Entry>();
      try {
        const { stdout } = await exec('/bin/ps', ['-e', '-o', 'pid=,ppid=,lstart='], {
          env: { ...process.env, LC_ALL: 'C' }, timeout: 250, maxBuffer: 2 * 1024 * 1024
        });
        if (stopped) return rows;
        for (const line of stdout.split('\n')) {
          if (!line.trim()) continue;
          const match = /^\s*(\d+)\s+(\d+)\s+([A-Za-z]{3} [A-Za-z]{3}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s*$/.exec(line);
          if (!match || Number(match[1]) < 1 || !Number.isSafeInteger(Number(match[1])) ||
              !Number.isSafeInteger(Number(match[2]))) return new Map<number, Entry>();
          rows.set(Number(match[1]), { parent: Number(match[2]), started: match[3] });
        }
        if (rootRunning && child.pid && rows.has(child.pid) && !known.has(child.pid)) {
          known.set(child.pid, rows.get(child.pid)!.started);
        }
        let added = true;
        while (added) {
          added = false;
          for (const [pid, row] of rows) {
            if (!known.has(pid) && known.has(row.parent) &&
                known.get(row.parent) === rows.get(row.parent)?.started) {
              known.set(pid, row.started); added = true;
            }
          }
        }
      } catch { /* Inspection unavailable: the direct ChildProcess remains the safe fallback. */ }
      return rows;
    })().finally(() => { pending = undefined; });
    return pending;
  };
  void refresh();
  const timer = setInterval(() => { void refresh(); }, 250);
  timer.unref();
  return {
    async signal(sig: NodeJS.Signals) {
      if (pending) await pending;
      const rows = await refresh();
      // Recheck start times before each round; PID reuse between inspection and kill is still possible.
      for (const [pid, started] of [...known].reverse()) {
        if (pid !== child.pid && rows.get(pid)?.started === started) {
          try { process.kill(pid, sig); } catch { /* exited or no longer signalable */ }
        }
      }
      try { child.kill(sig); } catch { /* already exited */ }
    },
    stop() { stopped = true; clearInterval(timer); }
  };
}

/** OpenSSH implementation used only by the explicit auth-test command. */
export class SystemAuthTester implements AuthTester {
  constructor(private readonly interactive: boolean, private readonly env: NodeJS.ProcessEnv = process.env) {}

  async observe(remote: RemoteInfo, signal: AbortSignal): Promise<AuthObservation> {
    if (!isSafeAuthDestination(remote) || this.env.GITROLE_SSH_BIN !== undefined ||
      this.env.GIT_SSH_COMMAND !== undefined || this.env.GIT_SSH !== undefined ||
      (this.env.GIT_SSH_VARIANT !== undefined && !['ssh', 'auto'].includes(this.env.GIT_SSH_VARIANT))) {
      return { outcome: 'unobserved', reason: 'unsupported SSH transport or destination' };
    }
    if (process.platform === 'win32') return { outcome: 'unobserved', reason: 'process-group cleanup is not supported on this platform' };
    const args = ['-T', '-o', 'ConnectTimeout=5',
      ...(!this.interactive ? ['-o', 'BatchMode=yes'] : []),
      ...(remote.port !== undefined ? ['-p', String(remote.port)] : []),
      remote.user ? `${remote.user}@${remote.host}` : remote.host!];
    // Configuration inspection has effects too. It belongs to this explicitly requested operation.
    const config = await this.execute(['-G', ...args], signal);
    if (config.failure) return this.failed(config.failure, signal);
    if (config.code !== 0 || !/^hostname \S+/m.test(config.stdout) || !/^user \S+/m.test(config.stdout) ||
      !/^port \d+$/m.test(config.stdout) ||
      config.stdout.split(/\r?\n/).some(line => line.startsWith('remotecommand ') && line !== 'remotecommand none')) {
      return { outcome: 'unobserved', reason: 'SSH settings could not be inspected or a remote command is configured' };
    }
    const execution = await this.execute(args, signal, true);
    if (execution.failure) return this.failed(execution.failure, signal);
    const lines = `${execution.stdout}\n${execution.stderr}`.split(/\r?\n/);
    const greetings = lines.map(line => /^Hi ([A-Za-z0-9-]+)! You've successfully authenticated, but GitHub does not provide shell access\.$/.exec(line)?.[1]).filter((s): s is string => Boolean(s));
    if ((execution.code === 0 || execution.code === 1) && greetings.length === 1) {
      return { outcome: 'observed', account: greetings[0] };
    }
    const raw = `${execution.stdout}\n${execution.stderr}`;
    const reason = /Could not resolve hostname/i.test(raw) ? 'host could not be resolved' :
      /Connection refused/i.test(raw) ? 'connection refused' :
      /Host key verification failed/i.test(raw) ? 'host key verification failed' :
      /Permission denied/i.test(raw) ? 'authentication refused' :
      /timed out/i.test(raw) ? 'connection timed out' : 'no recognized account greeting';
    return { outcome: 'unobserved', reason };
  }

  private failed(reason: string, signal: AbortSignal): AuthObservation {
    return { outcome: signal.aborted && signal.reason === 'cancelled' ? 'cancelled' : 'unobserved', reason };
  }

  private execute(args: string[], signal: AbortSignal, handshake = false): Promise<Execution> {
    if (signal.aborted) return Promise.resolve({ code: null, stdout: '', stderr: '', failure: signal.reason === 'cancelled' ? 'cancelled' : 'time budget exhausted' });
    return new Promise(resolve => {
      // Keep the controlling terminal for interactive SSH. NonTTY children own a killable session/group.
      const child = spawn('ssh', args, {
        env: this.interactive ? this.env : { ...this.env, SSH_ASKPASS_REQUIRE: 'never' },
        detached: !this.interactive,
        stdio: [this.interactive ? 'inherit' : 'ignore', 'pipe', 'pipe']
      });
      const descendants = this.interactive ? trackDescendants(child) : undefined;
      let stdout = '', stderr = '', bytes = 0;
      let failure: string | undefined;
      let cleanup: ReturnType<typeof setTimeout> | undefined;
      let finished = false;
      const kill = async (sig: NodeJS.Signals) => {
        if (descendants) { await descendants.signal(sig); return; }
        try { if (child.pid) process.kill(-child.pid, sig); } catch { /* already exited */ }
      };
      const finish = (code: number | null) => {
        if (finished) return;
        finished = true;
        if (cleanup) clearTimeout(cleanup);
        descendants?.stop();
        signal.removeEventListener('abort', abort);
        resolve({ code, stdout, stderr, failure });
      };
      const stop = (reason: string) => {
        if (failure || finished) return;
        failure = reason;
        void kill('SIGTERM').then(() => {
          if (finished) return;
          cleanup = setTimeout(() => {
            void kill('SIGKILL').then(() => {
              child.stdout.destroy(); child.stderr.destroy(); child.unref();
              finish(null);
            });
          }, 1000);
        });
      };
      const abort = () => stop(signal.reason === 'cancelled' ? 'cancelled' : 'time budget exhausted');
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 65536) stop('SSH output exceeded the limit'); else {
          stdout += chunk.toString();
          // Configuration stdout contains settings, never terminal interaction.
          if (this.interactive && handshake) process.stderr.write(chunk);
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 65536) stop('SSH output exceeded the limit'); else {
          stderr += chunk.toString();
          if (this.interactive) process.stderr.write(chunk);
        }
      });
      child.on('error', (error: NodeJS.ErrnoException) => { failure = error.code === 'ENOENT' ? 'ssh is not available' : 'SSH could not be started'; finish(null); });
      child.on('close', (code, sig) => {
        if (sig && !failure) { stop('SSH was terminated'); return; }
        // A cancelled leader can exit before its children. Keep the cleanup grace and escalation alive.
        if (!failure) finish(code);
      });
    });
  }
}

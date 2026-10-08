/*
 * Probes SSH authentication output to identify the GitHub account behind a host alias.
 */
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(nodeExecFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export type ExecFile = (file: string, args: string[], options?: { env?: NodeJS.ProcessEnv; timeout?: number }) => Promise<ExecResult>;

/** URL and execution context used by Git's standard OpenSSH transport. */
export interface SshProbeContext {
  user?: string;
  port?: number;
  path?: string;
  env?: NodeJS.ProcessEnv;
}

export interface SshAuthProbeOptions {
  binaryPath?: string;
  exec?: ExecFile;
}

export interface SshAuthProbeResult {
  ok: boolean;
  host: string;
  githubUser?: string;
  message?: string;
}

export class SystemSshAuthProbe {
  private readonly binaryPath: string;
  private readonly exec: ExecFile;

  constructor(options: SshAuthProbeOptions = {}) {
    this.binaryPath = options.binaryPath ?? process.env.GITROLE_SSH_BIN ?? 'ssh';
    this.exec = options.exec ?? execFile;
  }

  async probeGithubUser(host: string, context?: SshProbeContext): Promise<SshAuthProbeResult> {
    const destination = context?.user ? `${context.user}@${host}` : host;
    const portArgs = context?.port !== undefined ? ['-p', String(context.port)] : [];
    const options = { env: context?.env, timeout: 10000 };
    const probeArgs = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', ...portArgs, destination];
    if (context) {
      // Git uses its standard ssh transport here; an independent diagnostic binary cannot prove it.
      if (this.binaryPath !== 'ssh') {
        return { ok: false, host, message: 'diagnostic SSH binary differs from Git transport; authentication is unverified. Review the diagnostic override with the setup owner; a separate SSH check cannot verify this transport.' };
      }
      if ((context.port !== undefined && (!Number.isInteger(context.port) || context.port < 1 || context.port > 65535)) ||
          !context.path || /[\r\n\0]/.test(context.path) || host.startsWith('-') || context.user?.startsWith('-')) {
        return { ok: false, host, message: 'SSH URL context is unsupported; authentication is unverified' };
      }
      // Online only. ssh -G may execute Match exec or DNS; callers must skip this entire method offline.
      // Compare all effective options in Git's receive-pack and our handshake contexts.
      try {
        const receivePack = `git-receive-pack '${context.path.replace(/'/g, "'\\''")}'`;
        const gitContext = await this.exec(this.binaryPath, ['-G', ...portArgs, destination, receivePack], options);
        const probeContext = await this.exec(this.binaryPath, ['-G', ...probeArgs], options);
        const expected = parseSshConfiguration(gitContext.stdout);
        const actual = parseSshConfiguration(probeContext.stdout);
        // Interactive Git authentication can unlock different credentials than our bounded probe.
        const required = ['hostname', 'user', 'port', 'identityfile', 'identitiesonly', 'batchmode',
          'passwordauthentication', 'kbdinteractiveauthentication', 'pubkeyauthentication'];
        const complete = required.every((key) => expected.has(key) && actual.has(key));
        const noninteractive = expected.get('batchmode')?.[0] === 'yes';
        // These diagnostic limits can make observation fail, but cannot authorize another identity.
        for (const key of ['connecttimeout', 'requesttty']) { expected.delete(key); actual.delete(key); }
        if (!complete || !noninteractive ||
          JSON.stringify([...expected]) !== JSON.stringify([...actual]) ||
          !['none', undefined].includes(expected.get('remotecommand')?.[0])) {
          const reasons: string[] = [];
          if (!complete) reasons.push('OpenSSH did not report all settings needed to compare the push and connection check. Review the existing OpenSSH setup.');
          if (expected.has('batchmode') && !noninteractive) reasons.push('Git can ask for your key passphrase during push; Gitrole checks without asking, so it may see different keys. Do not change settings just to clear this warning.');
          if (!['none', undefined].includes(expected.get('remotecommand')?.[0])) reasons.push('A configured remote command prevents this comparison. Review whether that command is intentional; Gitrole will not bypass it.');
          // Describe independent differences without repeating a reason already explained above.
          const differentKeys = new Set([...expected.keys(), ...actual.keys()].filter((key) =>
            JSON.stringify(expected.get(key)) !== JSON.stringify(actual.get(key))));
          if (!noninteractive) differentKeys.delete('batchmode');
          if (!['none', undefined].includes(expected.get('remotecommand')?.[0])) differentKeys.delete('remotecommand');
          if (!complete) for (const key of required) {
            if (!expected.has(key) || !actual.has(key)) differentKeys.delete(key);
          }
          if (differentKeys.size) reasons.push("Git's push command and the connection check use different SSH settings. Review command-dependent SSH rules with the setup owner.");
          // A probe-owned message envelope keeps reason lists distinct from raw connection errors.
          return { ok: false, host, message: `SSH account unverified:\n${reasons.map((reason) => `- ${reason}`).join('\n')}\n\n${manualCheck(host, context)}` };

        }
      } catch {
        return { ok: false, host, message: 'SSH account unverified: OpenSSH settings could not be inspected. Review the SSH configuration for errors before retrying; no account was confirmed.' };
      }
    }
    try {
      const result = await this.exec(this.binaryPath, context ? probeArgs : [
        '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', `git@${host}`
      ], options);

      const parsed = mapProbeOutput(host, `${result.stdout}\n${result.stderr}`);
      return parsed.ok ? parsed : { ...parsed, message: failedCheck(parsed.message, host, context) };
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
      };

      if (execError.code === 'ENOENT') {
        return {
          ok: false,
          host,
          message: 'ssh is not installed or not available on PATH. Review your OpenSSH installation and PATH before retrying.'
        };
      }

      const output = `${execError.stdout ?? ''}\n${execError.stderr ?? ''}`;
      const parsed = mapProbeOutput(host, output);

      if (parsed.githubUser && !('killed' in execError && execError.killed) && !('signal' in execError && execError.signal)) {
        return parsed;
      }

      return {
        ok: false,
        host,
        message: failedCheck(output.trim() || execError.message, host, context)
      };
    }
  }
}

export function mapProbeOutput(host: string, output: string): SshAuthProbeResult {
  const match = /Hi ([A-Za-z0-9-]+)! You've successfully authenticated/i.exec(output);

  if (match) {
    return {
      ok: true,
      host,
      githubUser: match[1]
    };
  }

  const message = normalizeMessage(output);

  return {
    ok: false,
    host,
    message
  };
}

function normalizeMessage(message: string): string {
  return message.trim() || 'unable to determine SSH auth identity';
}

function parseSshConfiguration(output: string): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (const line of output.trim().split('\n')) {
    const separator = line.indexOf(' ');
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    values.set(key, [...(values.get(key) ?? []), value]);
  }
  return new Map([...values].sort(([a], [b]) => a.localeCompare(b)));
}

// Advice only: never run this command. Preserve SSH alias/user/port and quote every argument.
function manualCheck(host: string, context?: SshProbeContext): string {
  const destination = context ? (context.user ? `${context.user}@${host}` : host) : `git@${host}`;
  if (/[\x00-\x1f\x7f]/.test(destination)) return 'Review this endpoint with the setup owner; it cannot be safely shown as a shell command.';
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  const port = context?.port !== undefined ? ` -p ${quote(String(context.port))}` : '';
  return `Manual connection check:\n  ssh -T${port} -- ${quote(destination)}\nThis may ask for your key passphrase and run configured SSH commands or change SSH state. Existing settings may still disable prompts. A greeting does not verify Git's push context or change Gitrole's verdict.`;
}

function failedCheck(detail: string | undefined, host: string, context?: SshProbeContext): string {
  return `SSH account unverified: the connection check failed or returned no recognized account. This does not tell us whether credentials are unavailable or the connection or server failed. Review the SSH error with the setup owner. Detail: ${normalizeMessage(detail ?? '')} ${manualCheck(host, context)}`;
}

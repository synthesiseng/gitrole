/*
 * Wraps repository-level git commands and parses remote metadata for higher layers.
 */
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { GitNotInstalledError } from '../application/use-cases/index.js';
import type { NonMergeCommit } from '../application/contracts.js';

const execFile = promisify(nodeExecFile);

export type RemoteProtocol = 'ssh' | 'https' | 'unknown';

export interface RemoteInfo {
  name: string;
  url: string;
  protocol: RemoteProtocol;
  host?: string;
  owner?: string;
  repository?: string;
  user?: string;
  port?: number;
  path?: string;
}

/** Current default push endpoints, resolved by Git rather than URL rewrite guesses. */
export interface PushDestination {
  remoteName?: string;
  targets: RemoteInfo[];
  message?: string;
  transport: { supported: boolean; message?: string };
}

export function parseRemoteUrl(name: string, url: string): RemoteInfo {
  if (/[\r\n\0]/.test(url)) return { name, url, protocol: 'unknown' };
  const httpsMatch = /^https:\/\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/.exec(url);

  if (httpsMatch) {
    return {
      name,
      url,
      protocol: 'https',
      host: httpsMatch[1],
      owner: httpsMatch[2],
      repository: httpsMatch[3]
    };
  }

  // Parse URL form before scp form: a colon in ssh:// is not a scp separator.
  if (/^ssh:\/\//.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.password || !parsed.hostname || parsed.search || parsed.hash || (parsed.port && Number(parsed.port) < 1)) throw new Error('unsupported SSH URL');
      const rawPath = /^ssh:\/\/[^/]+(\/.*)$/.exec(url)?.[1];
      if (!rawPath) throw new Error('missing SSH path');
      const path = decodeURIComponent(rawPath).replace(/^\/~/, '~');
      if (/[\r\n\0]/.test(path)) throw new Error('unsupported SSH path');
      const repositoryPath = path.replace(/^\//, '').replace(/\.git$/, '');
      const slash = repositoryPath.indexOf('/');
      return {
        name, url, protocol: 'ssh', host: parsed.hostname.replace(/^\[|\]$/g, ''),
        ...(parsed.username ? { user: decodeURIComponent(parsed.username) } : {}),
        ...(parsed.port ? { port: Number(parsed.port) } : {}), path,
        ...(slash >= 0 ? { owner: repositoryPath.slice(0, slash), repository: repositoryPath.slice(slash + 1) } : {})
      };
    } catch { return { name, url, protocol: 'unknown' }; }
  }

  // Git selects an explicit remote helper before considering SCP-style SSH.
  if (/^[A-Za-z0-9][A-Za-z0-9+.-]*::/.test(url)) return { name, url, protocol: 'unknown' };

  const sshScpMatch = /^(?:([^@/:]+)@)?([^/:]+):(.+)$/i.exec(url);
  if (sshScpMatch && !url.includes('://') && !/^[A-Za-z]:[\\/]/.test(url)) {
    const [, user, host, path] = sshScpMatch;
    const repositoryPath = path.replace(/\.git$/, '');
    const slash = repositoryPath.indexOf('/');
    return {
      name, url, protocol: 'ssh', host,
      ...(user ? { user } : {}), path,
      ...(slash >= 0 ? { owner: repositoryPath.slice(0, slash), repository: repositoryPath.slice(slash + 1) } : {})
    };
  }

  return {
    name,
    url,
    protocol: 'unknown'
  };
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export type ExecFile = (file: string, args: string[], options?: { env: NodeJS.ProcessEnv }) => Promise<ExecResult>;
type ExecFailure = NodeJS.ErrnoException;

export interface GitRepositoryOptions {
  binaryPath?: string;
  exec?: ExecFile;
}

export class SystemGitRepository {
  private readonly binaryPath: string;
  private readonly exec: ExecFile;

  constructor(options: GitRepositoryOptions = {}) {
    this.binaryPath = options.binaryPath ?? process.env.GITROLE_GIT_BIN ?? 'git';
    this.exec = options.exec ?? execFile;
  }

  async isInsideWorkTree(): Promise<boolean> {
    try {
      const result = await this.run(['rev-parse', '--is-inside-work-tree']);
      return result.stdout.trim() === 'true';
    } catch (error) {
      if (error instanceof GitNotInstalledError) {
        throw error;
      }

      return false;
    }
  }

  async hasCommits(): Promise<boolean> {
    try {
      await this.run(['rev-parse', '--verify', 'HEAD']);
      return true;
    } catch (error) {
      if (error instanceof GitNotInstalledError) {
        throw error;
      }

      return false;
    }
  }

  async getLatestNonMergeCommit(): Promise<NonMergeCommit | undefined> {
    try {
      const result = await this.run([
        'log',
        '--no-merges',
        '-1',
        '--format=%H%x1f%an%x1f%ae%x1f%s'
      ]);
      const value = result.stdout.trim();

      if (!value) {
        return undefined;
      }

      const [sha, authorName, authorEmail, subject] = value.split('\u001f');

      if (!sha || !authorName || !authorEmail || subject === undefined) {
        return undefined;
      }

      return {
        sha,
        authorName,
        authorEmail,
        subject
      };
    } catch (error) {
      if (error instanceof GitNotInstalledError) {
        throw error;
      }

      return undefined;
    }
  }

  async getTopLevelPath(): Promise<string | undefined> {
    return this.getOptionalValue(['rev-parse', '--show-toplevel']);
  }

  async getCurrentBranch(): Promise<string | undefined> {
    return this.getOptionalValue(['branch', '--show-current']);
  }

  async getUpstreamBranch(): Promise<string | undefined> {
    return this.getOptionalValue(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  }

  async getOriginUrl(): Promise<string | undefined> {
    return this.getOptionalValue(['remote', 'get-url', 'origin']);
  }

  async getOriginRemote(): Promise<RemoteInfo | undefined> {
    const originUrl = await this.getOriginUrl();

    return originUrl ? parseRemoteUrl('origin', originUrl) : undefined;
  }

  /** Resolves the current default push remote and all effective push URLs without contacting it. */
  async getPushDestination(env: NodeJS.ProcessEnv = process.env): Promise<PushDestination> {
    const run = (args: string[]) => this.run(args, { env: { ...env, LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C' } });
    const config = async (key: string): Promise<string | undefined> => {
      try { return (await run(['config', '--get', key])).stdout.replace(/\n$/, ''); }
      catch (error) { if ((error as { code?: number | string }).code === 1) return undefined; throw error; }
    };
    const transport = await this.getPushTransport(config, env);
    const branch = (await run(['branch', '--show-current'])).stdout.trim();
    const remotes = (await run(['remote'])).stdout.replace(/\n$/, '').split('\n').filter(Boolean);
    const remoteName =
      (branch ? await config(`branch.${branch}.pushRemote`) : undefined) ??
      await config('remote.pushDefault') ??
      (branch ? await config(`branch.${branch}.remote`) : undefined) ??
      (remotes.length === 1 ? remotes[0] : remotes.includes('origin') ? 'origin' : undefined);
    if (!remoteName) return { targets: [], transport, message: 'no configured default push destination' };
    if (!remotes.includes(remoteName)) {
      if (/[\r\n\0]/.test(remoteName)) return {
        remoteName, targets: [], transport,
        message: 'resolved push URL framing is unsupported; destination is unverified'
      };
      // Legacy .git/remotes and .git/branches entries are not listed by `remote`.
      // Let Git distinguish these from direct tokens without inventing a URL.
      try {
        await run(['remote', 'get-url', '--push', '--all', '--', remoteName]);
        return { remoteName, targets: [], transport, message: 'legacy push remote is unsupported; destination is unverified' };
      } catch (error) {
        const failure = error as { code?: number; stderr?: string };
        if (failure.code !== 2 || failure.stderr !== `error: No such remote '${remoteName}'\n`) throw error;
      }
      const url = await this.resolveDirectPushUrl(run, remoteName, env);
      if (!url) return {
        remoteName, targets: [], transport,
        message: 'resolved push URL framing is unsupported; destination is unverified'
      };
      // A literal dot is local only if Git's URL rewrites leave it unchanged.
      if (remoteName === '.' && url === '.') return {
        remoteName, targets: [], transport,
        message: 'local push destination has no GitHub authentication'
      };
      return { remoteName, targets: [parseRemoteUrl(remoteName, url)], transport };
    }
    const receivePack = await config(`remote.${remoteName}.receivepack`);
    if (receivePack !== undefined && receivePack !== 'git-receive-pack') {
      transport.supported = false; transport.message = 'custom receive-pack context is unsupported; authentication is unverified';
    }
    // get-url is line-framed; validate NUL-framed configured values first so a URL
    // containing a newline cannot silently become a different endpoint or path.
    const configAll = async (key: string): Promise<string[] | undefined> => {
      try {
        const output = (await run(['config', '--null', '--get-all', key])).stdout;
        return output.replace(/\0$/, '').split('\0');
      } catch (error) {
        if ((error as { code?: number | string }).code === 1) return undefined;
        throw error;
      }
    };
    const configuredUrls = await configAll(`remote.${remoteName}.pushurl`) ?? await configAll(`remote.${remoteName}.url`);
    if (!configuredUrls?.length || configuredUrls.some((url) => !url || /[\r\n\0]/.test(url))) {
      return { remoteName, targets: [], transport, message: 'push URL framing is unsupported; destination is unverified' };
    }
    const urls = (await run(['remote', 'get-url', '--push', '--all', '--', remoteName])).stdout.replace(/\n$/, '').split('\n');
    // A rewrite base is a config key, which Git rejects when it contains a newline,
    // and configured URLs with a newline are already rejected above. Aliasing therefore
    // cannot split one URL into several lines. A longer get-url line count is still
    // unsupported framing. A shorter list is pushInsteadOf rewriting only some fetch
    // URLs: Git pushes those and does not push the other fetch URLs.
    if (!urls.length || urls.length > configuredUrls.length || urls.some((url) => !url || /[\r\n\0]/.test(url))) {
      return { remoteName, targets: [], transport, message: 'resolved push URL framing is unsupported; destination is unverified' };
    }
    return {
      remoteName, targets: urls.map((url) => parseRemoteUrl(remoteName, url)), transport
    };
  }

  private async resolveDirectPushUrl(
    run: (args: string[]) => Promise<ExecResult>,
    destination: string,
    env: NodeJS.ProcessEnv
  ): Promise<string | undefined> {
    // Evaluate includes in the original context, then replay only effective aliases.
    // A synthetic remote in that context could activate an inactive hasconfig include.
    let output = '';
    try {
      output = (await run(['config', '--null', '--get-regexp', '^url\\..*\\.(pushinsteadof|insteadof)$'])).stdout;
    } catch (error) {
      if ((error as { code?: number }).code !== 1) throw error;
    }
    const aliases: NodeJS.ProcessEnv = {};
    const entries = output ? output.split('\0') : [''];
    if (entries.pop() !== '') return undefined;
    for (const [index, entry] of entries.entries()) {
      const separator = entry.indexOf('\n');
      const key = entry.slice(0, separator);
      if (separator < 0 || !/^url\..*\.(pushinsteadof|insteadof)$/.test(key)) return undefined;
      // Separate key/value environment entries preserve order, duplicates, empty
      // values and '=' in keys without implementing any of Git's rewrite rules.
      aliases[`GIT_CONFIG_KEY_${index}`] = key;
      aliases[`GIT_CONFIG_VALUE_${index}`] = entry.slice(separator + 1);
    }
    const directory = await mkdtemp(path.join(os.tmpdir(), 'gitrole-push-resolve-'));
    try {
      const globalConfig = path.join(directory, 'empty-global');
      await writeFile(globalConfig, '', { mode: 0o600 });
      const isolatedEnv: NodeJS.ProcessEnv = {
        ...Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_'))),
        GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig,
        LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C'
      };
      await this.run(['init', '--quiet', '--bare', '--template=', directory], { env: isolatedEnv });
      const gitDir = `--git-dir=${directory}`;
      await this.run([gitDir, 'config', '--local', 'remote.probe.url', destination], { env: isolatedEnv });
      const resolved = await this.run([gitDir, 'remote', 'get-url', '--push', '--all', '--', 'probe'], {
        env: { ...isolatedEnv, ...aliases, GIT_CONFIG_COUNT: String(entries.length) }
      });
      const url = resolved.stdout.replace(/\n$/, '');
      return url && !/[\r\n\0]/.test(url) ? url : undefined;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async getPushTransport(
    config: (key: string) => Promise<string | undefined>, env: NodeJS.ProcessEnv
  ): Promise<PushDestination['transport']> {
    // Never execute or shell-parse user-supplied wrappers, even when they happen to look like ssh.
    if (env.GIT_SSH_COMMAND !== undefined || await config('core.sshCommand') !== undefined || env.GIT_SSH !== undefined) {
      return { supported: false, message: 'custom Git SSH command cannot be reproduced; authentication is unverified. Review GIT_SSH_COMMAND, GIT_SSH and core.sshCommand with the setup owner; do not remove an intentional override just to clear this warning.' };
    }
    const variant = env.GIT_SSH_VARIANT ?? await config('ssh.variant');
    if (variant !== undefined && variant !== 'ssh' && variant !== 'auto') return {
      supported: false, message: 'Git SSH variant is unsupported; authentication is unverified'
    };
    return { supported: true };
  }

  async setOriginUrl(url: string): Promise<void> {
    await this.run(['remote', 'set-url', 'origin', url]);
  }

  async getLocalUserName(): Promise<string | undefined> {
    return this.getOptionalValue(['config', '--local', '--get', 'user.name']);
  }

  async getLocalUserEmail(): Promise<string | undefined> {
    return this.getOptionalValue(['config', '--local', '--get', 'user.email']);
  }

  async setLocalUserName(name: string): Promise<void> {
    await this.run(['config', '--local', 'user.name', name]);
  }

  async setLocalUserEmail(email: string): Promise<void> {
    await this.run(['config', '--local', 'user.email', email]);
  }

  private async getOptionalValue(args: string[]): Promise<string | undefined> {
    try {
      const result = await this.run(args);
      const value = result.stdout.trim();

      return value ? value : undefined;
    } catch (error) {
      if (error instanceof GitNotInstalledError) {
        throw error;
      }

      return undefined;
    }
  }

  private async run(args: string[], options?: { env: NodeJS.ProcessEnv }): Promise<ExecResult> {
    try {
      return await this.exec(this.binaryPath, args, options);
    } catch (error) {
      throw mapGitError(error as ExecFailure);
    }
  }
}

function mapGitError(error: ExecFailure): Error {
  if (error.code === 'ENOENT') {
    return new GitNotInstalledError();
  }

  return error;
}

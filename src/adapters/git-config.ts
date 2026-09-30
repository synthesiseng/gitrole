/*
 * Wraps global git config reads and writes behind an adapter-friendly interface.
 */
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { EffectiveGitIdentity, IdentitySource, DoctorResult } from '../application/contracts.js';
import { GitNotInstalledError } from '../application/use-cases/index.js';

const execFile = promisify(nodeExecFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export type ExecFile = (file: string, args: string[], options?: { env: NodeJS.ProcessEnv }) => Promise<ExecResult>;
type ExecFailure = NodeJS.ErrnoException;

export interface GitConfigOptions {
  binaryPath?: string;
  exec?: ExecFile;
}

export class SystemGitConfig {
  private readonly binaryPath: string;
  private readonly exec: ExecFile;

  constructor(options: GitConfigOptions = {}) {
    this.binaryPath = options.binaryPath ?? process.env.GITROLE_GIT_BIN ?? 'git';
    this.exec = options.exec ?? execFile;
  }

  async getGlobalUserName(): Promise<string | undefined> {
    return this.getValue('user.name');
  }

  async getGlobalUserEmail(): Promise<string | undefined> {
    return this.getValue('user.email');
  }

  async setGlobalUserName(name: string): Promise<void> {
    await this.run(['config', '--global', 'user.name', name]);
  }

  async setGlobalUserEmail(email: string): Promise<void> {
    await this.run(['config', '--global', 'user.email', email]);
  }

  /** Read Git's actual author and committer, including config and environment precedence. */
  async getEffectiveIdentity(env?: NodeJS.ProcessEnv): Promise<EffectiveGitIdentity> {
    const run = async (args: string[], identityProbe = false) => {
      // Known benign identity errors are classified from Git's C-locale diagnostics.
      const commandEnv = identityProbe ? { ...(env ?? process.env), LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C' } : env;
      return this.run(args, commandEnv ? { env: commandEnv } : undefined);
    };
    const config = async (key: string): Promise<{ value?: string; source: IdentitySource }> => {
      try {
        const result = await run(['config', '--includes', '--show-scope', '--null', '--get', key]);
        const [scope, value] = result.stdout.split('\0');
        if (!['system', 'global', 'local', 'worktree', 'command'].includes(scope)) {
          throw new Error('git returned an unsupported config scope');
        }
        return { value, source: scope as IdentitySource };
      } catch (error) {
        if (getErrorCode(error as ExecFailure) === 1) return { source: 'unset' };
        throw mapGitError(error as ExecFailure);
      }
    };
    const identity = async (kind: 'AUTHOR' | 'COMMITTER') => {
      const fields = await Promise.all(['name', 'email'].map(async (field) => {
        const specific = await config(`${kind.toLowerCase()}.${field}`);
        return specific.value !== undefined && specific.value !== '' ? specific : config(`user.${field}`);
      }));
      let values: string[];
      try {
        const result = await run(['var', `GIT_${kind}_IDENT`], true);
        const match = /^(.*) <([^<>]*)> \d+ [+-]\d{4}\n?$/.exec(result.stdout);
        if (!match) throw new Error('git returned an invalid identity');
        values = [match[1], match[2]];
      } catch (error) {
        const stderr = Reflect.get(error as object, 'stderr');
        if (typeof stderr !== 'string' || !/unable to auto-detect email address|no email was given and auto-detection is disabled|empty ident name|no name was given and auto-detection is disabled/.test(stderr)) {
          throw mapGitError(error as ExecFailure);
        }
        return { identity: { fullName: { source: 'unset' }, email: { source: 'unset' } } as DoctorResult['commitIdentity'], fields };
      }
      const environment = env ?? process.env;
      const diagnosed = values.map((value, i) => {
        const field = i === 0 ? 'NAME' : 'EMAIL';
        const fromEnv = environment[`GIT_${kind}_${field}`] !== undefined || (i === 1 && fields[i].value === undefined && environment.EMAIL !== undefined);
        return { value, source: fromEnv ? 'env' as const : fields[i].value !== undefined ? fields[i].source : 'git' as const };
      });
      return { identity: { fullName: diagnosed[0], email: diagnosed[1] }, fields };
    };
    const [author, committer] = await Promise.all([identity('AUTHOR'), identity('COMMITTER')]);
    const sources = author.fields.map((field, i) => field.source === 'unset' && (i === 0 ? author.identity.fullName.source : author.identity.email.source) === 'git' ? 'git' as const : field.source);
    const effective = sources[0] === sources[1] ? sources[0] : 'mixed';
    return {
      author: author.identity,
      committer: committer.identity,
      scope: { effective: effective as EffectiveGitIdentity['scope']['effective'], hasLocalOverride: sources.some((source) => source === 'local' || source === 'worktree') }
    };
  }

  private async getValue(key: string): Promise<string | undefined> {
    try {
      const result = await this.run(['config', '--global', '--get', key]);
      const value = result.stdout.trim();

      return value ? value : undefined;
    } catch (error) {
      if (error instanceof GitNotInstalledError) {
        throw error;
      }

      const execError = error as ExecFailure;
      const errorCode = getErrorCode(execError);

      if (errorCode === 1) {
        return undefined;
      }

      throw mapGitError(execError);
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
  const errorCode = getErrorCode(error);

  if (errorCode === 'ENOENT') {
    return new GitNotInstalledError();
  }

  if (errorCode === 1) {
    return error;
  }

  return error;
}

function getErrorCode(error: ExecFailure): string | number | undefined {
  const errorCode = Reflect.get(error, 'code');

  if (typeof errorCode === 'string' || typeof errorCode === 'number') {
    return errorCode;
  }

  return undefined;
}

/*
 * Loads SSH keys through ssh-add and normalizes home-directory path expansion.
 */
import { execFile as nodeExecFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

import { validateSshKeyPath } from '../domain/role.js';

const execFile = promisify(nodeExecFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export type ExecFile = (file: string, args: string[]) => Promise<ExecResult>;

export interface SshAgentOptions {
  binaryPath?: string;
  exec?: ExecFile;
}

export class SystemSshAgent {
  private readonly binaryPath: string;
  private readonly exec: ExecFile;

  constructor(options: SshAgentOptions = {}) {
    this.binaryPath = options.binaryPath ?? process.env.GITROLE_SSH_ADD_BIN ?? 'ssh-add';
    this.exec = options.exec ?? execFile;
  }

  async loadKey(path: string): Promise<{ ok: boolean; message?: string }> {
    const expandedPath = expandHomePath(path);

    try {
      // Saved roles may predate save-time validation; a lone "-" also means stdin.
      validateSshKeyPath(path);
      await this.exec(this.binaryPath, ['--', expandedPath]);

      return { ok: true };
    } catch (error) {
      const execError = error as NodeJS.ErrnoException;

      if (execError.code === 'ENOENT') {
        return {
          ok: false,
          message: 'ssh-add is not installed or not available on PATH'
        };
      }

      return {
        ok: false,
        message: execError.message
      };
    }
  }
}

export function expandHomePath(input: string, homeDirectory = os.homedir()): string {
  if (input === '~') {
    return homeDirectory;
  }

  if (input.startsWith('~/')) {
    return `${homeDirectory}${input.slice(1)}`;
  }

  return input;
}

/*
 * Provides hermetic helpers for CLI end-to-end tests and fixture repositories.
 */
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

export interface HermeticWorkspace {
  rootDir: string;
  homeDir: string;
  configHome: string;
  repoDir: string;
  sshStubPath: string;
  sshAddStubPath: string;
  env: NodeJS.ProcessEnv;
}

export interface SavedRoleInput {
  name: string;
  fullName: string;
  email: string;
  githubUser?: string;
  githubHost?: string;
  sshKeyPath?: string;
}

export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

const distCliPath = path.resolve(process.cwd(), 'dist/cli/index.js');
const successHandshakeSuffix =
  "You've successfully authenticated, but GitHub does not provide shell access.";

export async function createHermeticWorkspace(options: {
  repoName?: string;
  sshUsersByHost?: Record<string, string>;
  sshMessagesByHost?: Record<string, string>;
} = {}): Promise<HermeticWorkspace> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-e2e-'));
  const homeDir = path.join(rootDir, 'home');
  const configHome = path.join(rootDir, 'config');
  const repoDir = path.join(rootDir, options.repoName ?? 'repo');
  const sshStubPath = path.join(rootDir, 'ssh');
  const sshAddStubPath = path.join(rootDir, 'ssh-add-stub.mjs');

  await mkdir(homeDir, { recursive: true });
  await mkdir(configHome, { recursive: true });
  await mkdir(repoDir, { recursive: true });
  await writeSshStub(sshStubPath, options.sshUsersByHost ?? {}, options.sshMessagesByHost ?? {});
  await writeSshAddStub(sshAddStubPath);

  return {
    rootDir,
    homeDir,
    configHome,
    repoDir,
    sshStubPath,
    sshAddStubPath,
    env: {
      ...process.env,
      HOME: homeDir,
      XDG_CONFIG_HOME: configHome,
      GIT_CONFIG_NOSYSTEM: '1',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      GITROLE_SSH_BIN: undefined,
      GIT_SSH: undefined, GIT_SSH_COMMAND: undefined, GIT_SSH_VARIANT: undefined,
      PATH: `${rootDir}:${process.env.PATH}`,
      GITROLE_SSH_ADD_BIN: sshAddStubPath
    }
  };
}

export async function initRepo(workspace: HermeticWorkspace): Promise<void> {
  const initResult = runCommand('git', ['init', '-b', 'main'], {
    cwd: workspace.repoDir,
    env: workspace.env
  });

  if (initResult.status === 0) {
    return;
  }

  mustSucceed(
    runCommand('git', ['init'], {
      cwd: workspace.repoDir,
      env: workspace.env
    }),
    'git init fallback failed'
  );
  mustSucceed(
    runCommand('git', ['branch', '-M', 'main'], {
      cwd: workspace.repoDir,
      env: workspace.env
    }),
    'git branch -M main failed'
  );
}

export function runCli(
  workspace: HermeticWorkspace,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): SpawnResult {
  return runCommand(process.execPath, [distCliPath, ...args], {
    cwd: options.cwd ?? workspace.repoDir,
    env: {
      ...workspace.env,
      ...options.env
    }
  });
}

export function useRole(
  workspace: HermeticWorkspace,
  roleName: string,
  scope: 'global' | 'local' = 'global'
): SpawnResult {
  return runCli(workspace, ['use', roleName, ...(scope === 'local' ? ['--local'] : [])]);
}

export function runGit(
  workspace: HermeticWorkspace,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): SpawnResult {
  return runCommand('git', args, {
    cwd: options.cwd ?? workspace.repoDir,
    env: {
      ...workspace.env,
      ...options.env
    }
  });
}

export async function saveRole(workspace: HermeticWorkspace, role: SavedRoleInput): Promise<void> {
  const args = ['add', role.name, '--name', role.fullName, '--email', role.email];

  if (role.githubUser) {
    args.push('--github-user', role.githubUser);
  }

  if (role.githubHost) {
    args.push('--github-host', role.githubHost);
  }

  if (role.sshKeyPath) {
    args.push('--ssh', role.sshKeyPath);
  }

  mustSucceed(runCli(workspace, args, { cwd: workspace.rootDir }), `failed to save role ${role.name}`);
}

export function setGlobalIdentity(
  workspace: HermeticWorkspace,
  identity: { name: string; email: string }
): void {
  mustSucceed(
    runGit(workspace, ['config', '--global', 'user.name', identity.name], {
      cwd: workspace.rootDir
    }),
    'failed to set global user.name'
  );
  mustSucceed(
    runGit(workspace, ['config', '--global', 'user.email', identity.email], {
      cwd: workspace.rootDir
    }),
    'failed to set global user.email'
  );
}

export function setLocalIdentity(
  workspace: HermeticWorkspace,
  identity: { name: string; email: string }
): void {
  mustSucceed(
    runGit(workspace, ['config', '--local', 'user.name', identity.name]),
    'failed to set local user.name'
  );
  mustSucceed(
    runGit(workspace, ['config', '--local', 'user.email', identity.email]),
    'failed to set local user.email'
  );
}

export function setOrigin(workspace: HermeticWorkspace, url: string): void {
  mustSucceed(runGit(workspace, ['remote', 'add', 'origin', url]), 'failed to add origin remote');
}

export function commitEmpty(
  workspace: HermeticWorkspace,
  options: {
    message: string;
    name?: string;
    email?: string;
  }
): void {
  const env = {
    ...workspace.env,
    ...(options.name ? { GIT_AUTHOR_NAME: options.name, GIT_COMMITTER_NAME: options.name } : {}),
    ...(options.email ? { GIT_AUTHOR_EMAIL: options.email, GIT_COMMITTER_EMAIL: options.email } : {})
  };

  mustSucceed(
    runGit(workspace, ['commit', '--allow-empty', '-m', options.message], { env }),
    'failed to create commit'
  );
}

export function getOriginUrl(workspace: HermeticWorkspace): string {
  const result = runGit(workspace, ['remote', 'get-url', 'origin']);
  mustSucceed(result, 'failed to read origin URL');
  return result.stdout.trim();
}

export function parseJsonOutput<T>(result: SpawnResult, context: string): T {
  mustSucceed(result, context);
  return JSON.parse(result.stdout) as T;
}

export async function writeRepoPolicy(
  workspace: HermeticWorkspace,
  policy: {
    version?: 1;
    defaultRole: string;
    allowedRoles: string[];
  }
): Promise<void> {
  await writeFile(
    path.join(workspace.repoDir, '.gitrole'),
    JSON.stringify(
      {
        version: policy.version ?? 1,
        defaultRole: policy.defaultRole,
        allowedRoles: policy.allowedRoles
      },
      null,
      2
    ),
    'utf8'
  );
}

export function getLocalConfigValue(workspace: HermeticWorkspace, key: string): string {
  const result = runGit(workspace, ['config', '--local', '--get', key]);
  mustSucceed(result, `failed to read local Git config for ${key}`);
  return result.stdout.trim();
}

export function assertNoWarnChecks(parsed: {
  checks: Array<{ status: string; label: string }>;
}): void {
  assert.deepEqual(
    parsed.checks.filter((check) => check.status === 'warn'),
    []
  );
}

export function mustSucceed(result: SpawnResult, context: string): void {
  assert.equal(
    result.status,
    0,
    `${context}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv }
): SpawnResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8'
  }) as SpawnSyncReturns<string>;

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

async function writeSshStub(
  targetPath: string,
  sshUsersByHost: Record<string, string>,
  sshMessagesByHost: Record<string, string>
): Promise<void> {
  const source = `#!/usr/bin/env node
if (process.argv.includes('-G')) {
  process.stdout.write('hostname fixture.test\\nuser git\\nport 22\\nidentityfile /fixture/key\\nidentitiesonly yes\\nbatchmode yes\\npasswordauthentication no\\nkbdinteractiveauthentication no\\npubkeyauthentication yes\\npreferredauthentications publickey\\n');
  process.exit(0);
}
const usersByHost = ${JSON.stringify(sshUsersByHost)};
const messagesByHost = ${JSON.stringify(sshMessagesByHost)};
const target = process.argv.at(-1) ?? '';
const host = target.startsWith('git@') ? target.slice(4) : target;

if (usersByHost[host]) {
  process.stderr.write(\`Hi \${usersByHost[host]}! ${successHandshakeSuffix}\\n\`);
  process.exit(1);
}

if (messagesByHost[host]) {
  process.stderr.write(\`\${messagesByHost[host]}\\n\`);
  process.exit(255);
}

process.stderr.write('ssh: unable to determine auth identity\\n');
process.exit(255);
`;

  await writeFile(targetPath, source, 'utf8');
  await chmod(targetPath, 0o755);
}

async function writeSshAddStub(targetPath: string): Promise<void> {
  await writeFile(
    targetPath,
    `#!/usr/bin/env node
process.exit(0);
`,
    'utf8'
  );
  await chmod(targetPath, 0o755);
}

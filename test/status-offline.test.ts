/*
 * Locks status --short --offline: local 0.8 checks, no SSH round-trip.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseRemoteUrl } from '../src/adapters/git-repository.js';
import { summarizeAlignment } from '../src/application/alignment.js';
import type { Role } from '../src/domain/role.js';

const cliPath = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));

const workRole: Role = {
  name: 'work',
  fullName: 'Alex Developer',
  email: 'alex@work.example',
  githubUser: 'alex-dev',
  githubHost: 'github.com-work'
};

function hermeticEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides };

  for (const key of Object.keys(env)) {
    if (
      key.startsWith('GIT_AUTHOR') ||
      key.startsWith('GIT_COMMITTER') ||
      key === 'GIT_CONFIG_COUNT' ||
      key === 'GIT_CONFIG_PARAMETERS'
    ) {
      delete env[key];
    }
  }

  return env;
}

function runGit(repo: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function runStatus(repo: string, args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [cliPath, 'status', ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...env, NO_COLOR: '1', FORCE_COLOR: '0' }
  });
}

async function makeRepo(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const repo = path.join(root, 'repo');
  const configHome = path.join(root, 'config');
  const gitconfig = path.join(root, 'gitconfig');
  const sshMarker = path.join(root, 'ssh-called');
  const sshStub = path.join(root, 'ssh-stub.mjs');

  await mkdir(repo, { recursive: true });
  await mkdir(path.join(configHome, 'gitrole'), { recursive: true });
  await writeFile(
    sshStub,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(sshMarker)}, 'called\\n');
process.stderr.write("Hi alex-dev! You've successfully authenticated, but GitHub does not provide shell access.\\n");
process.exit(1);
`,
    'utf8'
  );
  await chmod(sshStub, 0o755);

  const env = hermeticEnv({
    HOME: root,
    XDG_CONFIG_HOME: configHome,
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GITROLE_SSH_BIN: sshStub
  });

  runGit(repo, ['init', '-b', 'main'], env);
  runGit(repo, ['config', '--global', 'user.name', workRole.fullName], env);
  runGit(repo, ['config', '--global', 'user.email', workRole.email], env);

  return { root, repo, configHome, sshMarker, env };
}

async function saveRoles(
  configHome: string,
  roles: Array<Record<string, string>>
) {
  await writeFile(
    path.join(configHome, 'gitrole', 'roles.json'),
    `${JSON.stringify({ roles }, null, 2)}\n`,
    'utf8'
  );
}

function writePolicy(repo: string, defaultRole: string, allowedRoles: string[]) {
  return writeFile(
    path.join(repo, '.gitrole'),
    `${JSON.stringify({ version: 1, defaultRole, allowedRoles }, null, 2)}\n`,
    'utf8'
  );
}

test('offline alignment ignores an SSH probe result and still warns on a local HTTPS pin miss', () => {
  const offlineSsh = summarizeAlignment({
    offline: true,
    role: workRole,
    observedState: {
      commitIdentity: {
        fullName: { value: workRole.fullName, source: 'local' },
        email: { value: workRole.email, source: 'local' }
      },
      configuredIdentity: {
        local: { fullName: workRole.fullName, email: workRole.email },
        global: {}
      },
      commitEnv: {},
      scope: { effective: 'local', hasLocalOverride: true },
      repository: {
        isInsideWorkTree: true,
        hasCommits: true,
        remote: parseRemoteUrl('origin', 'git@github.com-work:acme/service.git')
      },
      sshAuth: {
        ok: true,
        host: 'github.com-work',
        githubUser: 'someone-else'
      }
    }
  });

  assert.deepEqual(offlineSsh, {
    overall: 'aligned',
    commit: 'ok',
    remote: 'ok',
    auth: 'na',
    policy: 'na'
  });

  const liveSsh = summarizeAlignment({
    role: workRole,
    observedState: {
      commitIdentity: {
        fullName: { value: workRole.fullName, source: 'local' },
        email: { value: workRole.email, source: 'local' }
      },
      configuredIdentity: {
        local: { fullName: workRole.fullName, email: workRole.email },
        global: {}
      },
      commitEnv: {},
      scope: { effective: 'local', hasLocalOverride: true },
      repository: {
        isInsideWorkTree: true,
        hasCommits: true,
        remote: parseRemoteUrl('origin', 'git@github.com-work:acme/service.git')
      },
      sshAuth: {
        ok: true,
        host: 'github.com-work',
        githubUser: 'someone-else'
      }
    }
  });

  assert.equal(liveSsh.auth, 'warn');
  assert.equal(liveSsh.commit, 'warn');
  assert.equal(liveSsh.overall, 'warning');

  const httpsNoPin = summarizeAlignment({
    offline: true,
    role: workRole,
    observedState: {
      commitIdentity: {
        fullName: { value: workRole.fullName, source: 'local' },
        email: { value: workRole.email, source: 'local' }
      },
      configuredIdentity: {
        local: { fullName: workRole.fullName, email: workRole.email },
        global: {}
      },
      commitEnv: {},
      scope: { effective: 'local', hasLocalOverride: true },
      repository: {
        isInsideWorkTree: true,
        hasCommits: true,
        remote: parseRemoteUrl('origin', 'https://github.com/acme/service.git')
      }
    }
  });

  assert.equal(httpsNoPin.auth, 'warn');
  assert.equal(httpsNoPin.overall, 'warning');
});

test('status --short --offline does not run SSH and reports auth=na', async () => {
  const workspace = await makeRepo('gitrole-offline-ssh-');
  await saveRoles(workspace.configHome, [
    {
      name: 'work',
      fullName: 'Alex Developer',
      email: 'alex@work.example',
      githubUser: 'alex-dev',
      githubHost: 'github.com-work'
    }
  ]);
  runGit(workspace.repo, ['config', 'user.name', 'Alex Developer'], workspace.env);
  runGit(workspace.repo, ['config', 'user.email', 'alex@work.example'], workspace.env);
  runGit(
    workspace.repo,
    ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'init'],
    workspace.env
  );
  runGit(
    workspace.repo,
    ['remote', 'add', 'origin', 'git@github.com-work:acme/service.git'],
    workspace.env
  );

  const offline = runStatus(workspace.repo, ['--short', '--offline'], workspace.env);
  const markerAfterOffline = await readFile(workspace.sshMarker, 'utf8').catch(
    (error: NodeJS.ErrnoException) => {
      assert.equal(error.code, 'ENOENT');
      return '';
    }
  );

  assert.equal(offline.status, 0, offline.stderr);
  assert.equal(offline.stderr, '');
  assert.equal(
    offline.stdout.trim(),
    'role=work scope=local override=true commit=ok remote=ok auth=na policy=na overall=aligned'
  );
  assert.equal(markerAfterOffline, '');

  const reversed = runStatus(workspace.repo, ['--offline', '--short'], workspace.env);
  assert.equal(reversed.stdout.trim(), offline.stdout.trim());

  const live = runStatus(workspace.repo, ['--short'], workspace.env);
  const markerAfterLive = await readFile(workspace.sshMarker, 'utf8');

  assert.equal(live.status, 0, live.stderr);
  assert.equal(
    live.stdout.trim(),
    'role=work scope=local override=true commit=ok remote=ok auth=ok policy=na overall=aligned'
  );
  assert.match(markerAfterLive, /called/);
});

test('status --short --offline keeps HTTPS pin, env, fresh-repo, and policy checks', async () => {
  const workspace = await makeRepo('gitrole-offline-https-');
  await saveRoles(workspace.configHome, [
    {
      name: 'work',
      fullName: 'Alex Developer',
      email: 'alex@work.example',
      githubUser: 'alex-dev',
      githubHost: 'github.com'
    },
    {
      name: 'personal',
      fullName: 'Pat Person',
      email: 'pat@personal.example',
      githubUser: 'pat-person',
      githubHost: 'github.com'
    }
  ]);
  runGit(workspace.repo, ['config', 'user.name', 'Alex Developer'], workspace.env);
  runGit(workspace.repo, ['config', 'user.email', 'alex@work.example'], workspace.env);
  runGit(
    workspace.repo,
    ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'init'],
    workspace.env
  );
  runGit(
    workspace.repo,
    ['remote', 'add', 'origin', 'https://github.com/acme/service.git'],
    workspace.env
  );

  const noPinOffline = runStatus(workspace.repo, ['--short', '--offline'], workspace.env);
  const noPinLive = runStatus(workspace.repo, ['--short'], workspace.env);
  const noPinLine =
    'role=work scope=local override=true commit=ok remote=ok auth=warn policy=na overall=warning';

  assert.equal(noPinOffline.status, 2, noPinOffline.stderr);
  assert.equal(noPinOffline.stdout.trim(), noPinLine);
  assert.equal(noPinLive.stdout.trim(), noPinLine);

  await writePolicy(workspace.repo, 'work', ['work']);
  const pinnedOffline = runStatus(workspace.repo, ['--short', '--offline'], workspace.env);
  const pinnedLive = runStatus(workspace.repo, ['--short'], workspace.env);
  const pinnedLine =
    'role=work scope=local override=true commit=ok remote=ok auth=na policy=ok overall=aligned';

  assert.equal(pinnedOffline.status, 0, pinnedOffline.stderr);
  assert.equal(pinnedOffline.stdout.trim(), pinnedLine);
  assert.equal(pinnedLive.stdout.trim(), pinnedLine);

  runGit(workspace.repo, ['config', 'user.name', 'Pat Person'], workspace.env);
  runGit(workspace.repo, ['config', 'user.email', 'pat@personal.example'], workspace.env);
  const mismatch = runStatus(workspace.repo, ['--short', '--offline'], workspace.env);

  assert.equal(mismatch.status, 2, mismatch.stderr);
  assert.equal(
    mismatch.stdout.trim(),
    'role=personal scope=local override=true commit=ok remote=ok auth=warn policy=warn overall=warning'
  );

  runGit(workspace.repo, ['config', 'user.name', 'Alex Developer'], workspace.env);
  runGit(workspace.repo, ['config', 'user.email', 'alex@work.example'], workspace.env);
  const envWarn = runStatus(workspace.repo, ['--short', '--offline'], {
    ...workspace.env,
    GIT_COMMITTER_EMAIL: 'other@example.com'
  });

  assert.equal(envWarn.status, 2, envWarn.stderr);
  assert.equal(
    envWarn.stdout.trim(),
    'role=work scope=local override=true commit=warn remote=ok auth=na policy=ok overall=warning'
  );

  const freshRoot = await mkdtemp(path.join(os.tmpdir(), 'gitrole-offline-fresh-'));
  const freshRepo = path.join(freshRoot, 'repo');
  const freshConfig = path.join(freshRoot, 'config');
  await mkdir(freshRepo, { recursive: true });
  await mkdir(path.join(freshConfig, 'gitrole'), { recursive: true });
  const freshEnv = hermeticEnv({
    HOME: freshRoot,
    XDG_CONFIG_HOME: freshConfig,
    GIT_CONFIG_GLOBAL: path.join(freshRoot, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GITROLE_SSH_BIN: workspace.env.GITROLE_SSH_BIN
  });
  runGit(freshRepo, ['init', '-b', 'main'], freshEnv);
  runGit(freshRepo, ['config', '--global', 'user.name', 'Alex Developer'], freshEnv);
  runGit(freshRepo, ['config', '--global', 'user.email', 'alex@work.example'], freshEnv);
  await saveRoles(freshConfig, [
    {
      name: 'work',
      fullName: 'Alex Developer',
      email: 'alex@work.example',
      githubUser: 'alex-dev',
      githubHost: 'github.com'
    }
  ]);

  const fresh = runStatus(freshRepo, ['--short', '--offline'], freshEnv);

  assert.equal(fresh.status, 2, fresh.stderr);
  assert.equal(
    fresh.stdout.trim(),
    'role=work scope=global override=false commit=warn remote=warn auth=na policy=na overall=warning'
  );
  await assert.rejects(readFile(path.join(freshRoot, 'ssh-called'), 'utf8'));
});

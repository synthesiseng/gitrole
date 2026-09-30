/* Verifies effective ordinary-commit identity against real Git precedence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SystemGitRepository } from '../src/adapters/git-repository.js';
import { doctor, getStatus } from '../src/application/use-cases/index.js';
import { SystemGitConfig } from '../src/adapters/git-config.js';
import { getCurrentRole, importCurrentRole } from '../src/application/use-cases/role.js';

const exec = promisify(execFile);

test('effective author/committer follow Git includes, role commands, config and environment', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gitrole-effective-'));
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: root, GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_AUTHOR') || key.startsWith('GIT_COMMITTER') || key.startsWith('GIT_CONFIG') && key !== 'GIT_CONFIG_NOSYSTEM' || key === 'EMAIL') delete env[key as keyof typeof env];
  }
  const repo = path.join(root, 'repo');
  await mkdir(repo);
  const git = (args: string[]) => exec('git', args, { cwd: repo, env });
  // Bind role commands to the fixture environment too; honor probe locale options.
  const adapter = new SystemGitConfig({ exec: async (file, args, options) => exec(file, args, {
    cwd: repo, env: args[0] === 'var' ? { ...env, LC_ALL: options?.env.LC_ALL, LANG: options?.env.LANG, LANGUAGE: options?.env.LANGUAGE } : env
  }) });
  try {
    await git(['init', '-q']);
    await git(['config', 'user.name', 'Alex Work']);
    await git(['config', 'user.email', 'alex@work.example']);
    const oracle = async () => {
      const actual = await adapter.getEffectiveIdentity(env);
      for (const [kind, value] of [['AUTHOR', actual.author], ['COMMITTER', actual.committer]] as const) {
        const { stdout } = await git(['var', `GIT_${kind}_IDENT`]);
        assert.ok(stdout.startsWith(`${value.fullName.value} <${value.email.value}> `));
      }
      return actual;
    };
    let actual = await oracle();
    assert.equal(actual.author.email.source, 'local');
    await git(['config', '--global', 'user.name', 'Global User']);
    await git(['config', '--global', 'user.email', 'global@example.test']);
    for (const kind of ['author', 'committer']) {
      await git(['config', `${kind}.name`, '']);
      await git(['config', `${kind}.email`, '']);
    }
    actual = await oracle();
    assert.equal(actual.author.email.source, 'local');
    await git(['config', '--unset', 'user.name']);
    await git(['config', '--unset', 'user.email']);
    actual = await oracle();
    assert.equal(actual.author.email.source, 'global');
    assert.equal(actual.committer.email.source, 'global');
    assert.equal(actual.scope.hasLocalOverride, false);
    for (const kind of ['author', 'committer']) {
      await git(['config', '--unset', `${kind}.name`]);
      await git(['config', '--unset', `${kind}.email`]);
    }
    await git(['config', 'user.name', 'Alex Work']);
    await git(['config', 'user.email', 'alex@work.example']);
    await git(['config', '--global', '--unset', 'user.name']);
    await git(['config', '--global', '--unset', 'user.email']);
    await git(['config', 'author.email', 'other@personal.example']);
    actual = await oracle();
    assert.equal(actual.author.email.value, 'other@personal.example');
    assert.equal(actual.committer.email.value, 'alex@work.example');
    await git(['config', '--unset', 'author.email']);
    const include = path.join(root, 'included');
    await writeFile(include, '[user]\n name = Pat Personal\n email = pat@personal.example\n');
    await git(['config', 'include.path', include]);
    actual = await oracle();
    assert.equal(actual.author.fullName.value, 'Pat Personal');
    assert.equal(actual.author.email.source, 'local');
    const roles = [{ name: 'personal', fullName: 'Pat Personal', email: 'pat@personal.example' }];
    const deps = { gitConfig: adapter, roleStore: { list: async () => roles, get: async () => undefined, save: async (role: typeof roles[number]) => { roles.push(role); }, remove: async () => false }, sshAgent: { loadKey: async () => ({ ok: true }) } };
    assert.equal((await getCurrentRole(deps)).role?.name, 'personal');
    const imported = await importCurrentRole(deps, 'included');
    assert.equal(imported.role.email, 'pat@personal.example');
    const repository = new SystemGitRepository({ exec: async (file, args) => exec(file, args, { cwd: repo, env }) });
    // Isolate identity classification from the independent unborn-history warning.
    repository.hasCommits = async () => true;
    await git(['remote', 'add', 'origin', 'git@github.com:example/repo.git']);
    const diagnosisDeps = { ...deps, repository, env, sshAuthProbe: { probeGithubUser: async (host: string) => ({ ok: true, host, githubUser: 'personal' }) } };
    let diagnosis = await doctor(diagnosisDeps);
    assert.equal(diagnosis.role?.name, 'personal');
    assert.equal(diagnosis.overall, 'aligned');
    await git(['config', 'author.email', 'outside@example.test']);
    diagnosis = await doctor(diagnosisDeps);
    assert.equal(diagnosis.commitIdentity.email.value, 'outside@example.test');
    assert.equal(diagnosis.overall, 'warning');
    assert.equal((await getStatus(diagnosisDeps, { offline: true })).commit, 'warn');
    await git(['config', '--unset', 'author.email']);
    await git(['config', 'committer.email', 'other-committer@example.test']);
    diagnosis = await doctor(diagnosisDeps);
    assert.equal(diagnosis.role?.name, 'personal');
    assert.equal(diagnosis.committerIdentity?.email.value, 'other-committer@example.test');
    assert.equal(diagnosis.overall, 'warning');
    assert.equal((await getStatus(diagnosisDeps, { offline: true })).commit, 'warn');
    await git(['config', '--unset', 'committer.email']);
    Object.assign(env, { GIT_AUTHOR_EMAIL: 'override@agent.example', GIT_COMMITTER_EMAIL: 'committer@agent.example' });
    actual = await oracle();
    assert.equal(actual.author.email.source, 'env');
    assert.equal(actual.committer.email.source, 'env');
    assert.equal((await getCurrentRole(deps)).identity.email, 'override@agent.example');
    delete (env as NodeJS.ProcessEnv).GIT_AUTHOR_EMAIL;
    delete (env as NodeJS.ProcessEnv).GIT_COMMITTER_EMAIL;
    Object.assign(env, { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'Command User', GIT_CONFIG_KEY_1: 'user.email', GIT_CONFIG_VALUE_1: 'command@example.test' });
    actual = await oracle();
    assert.equal(actual.author.email.source, 'command');
    assert.equal(actual.scope.effective, 'command');
    for (const key of Object.keys(env)) if (key.startsWith('GIT_CONFIG_') && key !== 'GIT_CONFIG_NOSYSTEM') delete (env as NodeJS.ProcessEnv)[key];
    await git(['config', 'extensions.worktreeConfig', 'true']);
    await git(['config', '--worktree', 'user.name', 'Worktree User']);
    await git(['config', '--worktree', 'user.email', 'worktree@example.test']);
    actual = await oracle();
    assert.equal(actual.author.email.source, 'worktree');
    assert.equal(actual.scope.effective, 'worktree');
    assert.equal(actual.scope.hasLocalOverride, true);
    await git(['config', '--worktree', '--unset', 'user.name']);
    await git(['config', '--worktree', '--unset', 'user.email']);
    await git(['config', '--unset', 'include.path']);
    await git(['config', '--unset', 'user.name']);
    await git(['config', '--unset', 'user.email']);
    const systemConfig = path.join(root, 'system-config');
    await writeFile(systemConfig, '[user]\n name = System User\n email = system@example.test\n');
    delete (env as NodeJS.ProcessEnv).GIT_CONFIG_NOSYSTEM;
    (env as NodeJS.ProcessEnv).GIT_CONFIG_SYSTEM = systemConfig;
    actual = await oracle();
    assert.equal(actual.author.email.source, 'system');
    assert.equal(actual.scope.effective, 'system');
    await git(['config', '--global', 'user.name', 'Global User']);
    await git(['config', '--global', 'user.email', 'global@example.test']);
    actual = await oracle();
    assert.equal(actual.scope.effective, 'global');
    await git(['config', 'author.name', 'Local Author']);
    actual = await oracle();
    assert.equal(actual.scope.effective, 'mixed');
    await git(['config', '--unset', 'author.name']);
    await git(['config', '--global', '--unset', 'user.name']);
    await git(['config', '--global', '--unset', 'user.email']);
    (env as NodeJS.ProcessEnv).GIT_CONFIG_NOSYSTEM = '1';
    (env as NodeJS.ProcessEnv).EMAIL = 'fallback@example.test';
    // EMAIL supplies no name; runners need not have a usable OS account name.
    await git(['config', 'user.name', 'Fallback User']);
    actual = await oracle();
    assert.equal(actual.author.email.source, 'env');
    assert.equal(actual.author.fullName.value, 'Fallback User');
    assert.equal(actual.author.fullName.source, 'local');
    assert.equal(actual.committer.email.source, 'env');
    // Force the same empty-name rejection seen on Linux, without depending on the OS.
    Object.assign(env, { GIT_AUTHOR_NAME: '', GIT_COMMITTER_NAME: '' });
    for (const kind of ['AUTHOR', 'COMMITTER']) {
      await assert.rejects(() => git(['var', `GIT_${kind}_IDENT`]), /empty ident name/);
    }
    actual = await adapter.getEffectiveIdentity(env);
    assert.equal(actual.author.fullName.source, 'unset');
    assert.equal(actual.committer.fullName.source, 'unset');
    delete (env as NodeJS.ProcessEnv).GIT_AUTHOR_NAME;
    delete (env as NodeJS.ProcessEnv).GIT_COMMITTER_NAME;
    await git(['config', '--unset', 'user.name']);
    delete (env as NodeJS.ProcessEnv).EMAIL;
    await git(['config', 'user.useConfigOnly', 'true']);
    actual = await adapter.getEffectiveIdentity(env);
    assert.equal(actual.author.fullName.source, 'unset');
    assert.equal(actual.author.email.source, 'unset');
    assert.equal(actual.committer.fullName.source, 'unset');
    assert.equal(actual.committer.email.source, 'unset');

  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Git-generated identity provenance does not depend on the host account', async () => {
  const calls: string[][] = [];
  const adapter = new SystemGitConfig({ exec: async (_file, args) => {
    calls.push(args);
    if (args[0] === 'config') throw Object.assign(new Error('missing config'), { code: 1 });
    assert.equal(args[0], 'var');
    assert.ok(['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT'].includes(args[1]));
    return { stdout: 'Generated User <fallback@example.test> 1700000000 +0000\n', stderr: '' };
  } });
  const actual = await adapter.getEffectiveIdentity({ EMAIL: 'fallback@example.test' });
  for (const identity of [actual.author, actual.committer]) {
    assert.deepEqual(identity.fullName, { value: 'Generated User', source: 'git' });
    assert.deepEqual(identity.email, { value: 'fallback@example.test', source: 'env' });
  }
  assert.deepEqual(actual.scope, { effective: 'mixed', hasLocalOverride: false });
  assert.equal(calls.filter(args => args[0] === 'var').length, 2);
});

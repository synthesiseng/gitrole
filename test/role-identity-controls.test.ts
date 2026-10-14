/* Verifies identity control rejection, safe legacy diagnosis, and explicit recovery. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeRole, matchesIdentity, type Role } from '../src/domain/role.js';
import { FileRoleStore } from '../src/adapters/role-store.js';
import { importCurrentRole, useRole } from '../src/application/use-cases/role.js';

const valid: Role = { name: 'work', fullName: 'Zoë 李', email: 'zoe@example.invalid' };
const cli = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));
const controls = [...Array.from({ length: 32 }, (_, n) => n),
  ...Array.from({ length: 33 }, (_, n) => n + 127), 0x2028, 0x2029];

test('identity boundaries reject every control before trimming while retaining valid Unicode', () => {
  for (const field of ['fullName', 'email'] as const) {
    for (const code of controls) {
      for (const value of [`a${String.fromCharCode(code)}b`, `${String.fromCharCode(code)}a`, `a${String.fromCharCode(code)}`]) {
        assert.throws(() => normalizeRole({ ...valid, [field]: value }),
          { name: 'InvalidRoleIdentityError' }, `${field} ${JSON.stringify(value)}`);
      }
    }
  }
  const normalized = normalizeRole({ ...valid, fullName: `  ${valid.fullName}  ` });
  assert.equal(normalized.fullName, valid.fullName);
  assert.equal(normalized.email, valid.email);
});

test('invalid identities cannot save, import, match, or reach Git and SSH effects', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-controls-boundary-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'roles.json');
  const store = new FileRoleStore({ configFilePath: file });
  await assert.rejects(() => store.save({ ...valid, fullName: 'a\nb' }), { name: 'InvalidRoleIdentityError' });
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  await store.save(valid);
  const original = await readFile(file, 'utf8');
  for (const field of ['fullName', 'email'] as const) {
    const invalid = { ...valid, [field]: `unsafe\u001b[31mvalue`, sshKeyPath: '/synthetic/never-load' };
    await assert.rejects(() => store.save(invalid), { name: 'InvalidRoleIdentityError' });
    assert.equal(await readFile(file, 'utf8'), original);
    assert.equal(matchesIdentity(invalid, invalid), false);
    const effects: string[] = [];
    const deps = {
      roleStore: { list: async () => [invalid], get: async () => invalid,
        save: async () => { effects.push('save'); }, remove: async () => false },
      gitConfig: { getGlobalUserName: async () => invalid.fullName, getGlobalUserEmail: async () => invalid.email,
        setGlobalUserName: async () => { effects.push('global name'); },
        setGlobalUserEmail: async () => { effects.push('global email'); } },
      repository: { isInsideWorkTree: async () => true,
        hasCommits: async () => false, getLatestNonMergeCommit: async () => undefined,
        getTopLevelPath: async () => undefined, getCurrentBranch: async () => undefined,
        getUpstreamBranch: async () => undefined, getOriginUrl: async () => undefined,
        getOriginRemote: async () => undefined, setOriginUrl: async () => { effects.push('remote'); },
        getLocalUserName: async () => undefined, getLocalUserEmail: async () => undefined,
        setLocalUserName: async () => { effects.push('local name'); },
        setLocalUserEmail: async () => { effects.push('local email'); } },
      sshAgent: { loadKey: async () => { effects.push('ssh'); return { ok: true }; } }
    };
    for (const scope of ['global', 'local'] as const) {
      await assert.rejects(() => useRole(deps, 'work', { scope }), { name: 'InvalidRoleIdentityError' });
    }
    await assert.rejects(() => importCurrentRole(deps, 'imported'), { name: 'InvalidRoleIdentityError' });
    assert.deepEqual(effects, []);
  }
});

test('CLI preserves legacy controls for safe diagnosis and explicit repair', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-controls-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'gitrole'));
  const file = path.join(dir, 'gitrole', 'roles.json');
  const env = { PATH: process.env.PATH, HOME: dir, XDG_CONFIG_HOME: dir,
    GIT_CONFIG_GLOBAL: path.join(dir, 'global.gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_CEILING_DIRECTORIES: dir, GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1',
    SSH_AUTH_SOCK: path.join(dir, 'absent-agent'), TERM: 'dumb' };
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout;
  };
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, env, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.name', valid.fullName); git('config', 'user.email', valid.email);
  const config = await readFile(path.join(dir, '.git/config'), 'utf8');
  const legacy = { ...valid, fullName: '\nAlice\u001b[31m\n', email: 'a\u0085b@example.invalid' };
  const original = JSON.stringify({ roles: [legacy] });
  await writeFile(file, original);
  const store = new FileRoleStore({ configFilePath: file });
  assert.equal((await store.get('work'))?.fullName, legacy.fullName);
  assert.equal((await store.get('work'))?.email, legacy.email);
  for (const args of [['list'], ['doctor', '--offline'], ['doctor', '--offline', '--verbose']]) {
    const result = run(...args);
    assert.ok(result.status === 0 || result.status === 2, result.stderr);
    assert.doesNotMatch(result.stdout, /[\u001b\u0085]/);
    if (args[0] === 'list') assert.match(result.stdout, /\\u000aAlice\\u001b\[31m\\u000a/);
    else assert.match(result.stdout, /saved role "work".*control characters/);
    assert.equal(await readFile(file, 'utf8'), original);
  }
  for (const scope of ['--local', '--global']) {
    const result = run('use', 'work', scope);
    assert.equal(result.status, 1, result.stdout);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /control characters/);
    assert.equal(await readFile(file, 'utf8'), original);
    assert.equal(await readFile(path.join(dir, '.git/config'), 'utf8'), config);
    await assert.rejects(readFile(env.GIT_CONFIG_GLOBAL), { code: 'ENOENT' });
  }
  for (const name of ['work', 'new']) {
    const result = run('add', name, '--name', 'Alice\nForged', '--email', valid.email);
    assert.equal(result.status, 1, result.stdout); assert.equal(result.stdout, '');
    assert.equal(await readFile(file, 'utf8'), original);
  }
  git('config', 'user.name', legacy.fullName);
  for (const args of [['current'], ['status', '--offline'], ['doctor', '--offline', '--verbose']]) {
    const result = run(...args);
    assert.ok(result.status === 0 || result.status === 2, result.stderr);
    assert.doesNotMatch(result.stdout, /[\u001b\u0085]/);
    assert.match(result.stdout, /\\u001b/);
    assert.equal(await readFile(file, 'utf8'), original);
  }
  assert.equal(run('check', 'commit').status, 2);
  const short = run('status', '--short', '--offline');
  assert.equal(short.status, 2);
  assert.match(short.stdout, /^role=no-role scope=\S+ override=\S+ commit=\S+ remote=\S+ auth=\S+ policy=\S+ overall=warning\n$/);
  const json = run('doctor', '--offline', '--json');
  assert.equal(json.status, 2);
  assert.equal(JSON.parse(json.stdout).commitIdentity.fullName.value, 'Alice\u001b[31m');
  // A legitimate edit must not sanitize a different legacy role incidentally.
  await store.save({ ...valid, name: 'other' });
  assert.equal((await store.get('work'))?.fullName, legacy.fullName);
  const repaired = run('add', 'work', '--name', valid.fullName, '--email', valid.email);
  assert.equal(repaired.status, 0, repaired.stderr);
  assert.equal(run('use', 'work', '--local').status, 0);
  assert.match(run('current').stdout, /current role work/);
  assert.equal((await store.get('work'))?.fullName, valid.fullName);
  await writeFile(file, original);
  assert.equal(run('remove', 'work').status, 0);
  assert.deepEqual(await store.list(), []);
});

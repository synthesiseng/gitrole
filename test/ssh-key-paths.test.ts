/*
 * Verifies SSH key path validation, legacy role recovery, and CLI persistence boundaries.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeRole, type Role } from '../src/domain/role.js';
import { FileRoleStore } from '../src/adapters/role-store.js';
import { SystemSshAgent } from '../src/adapters/ssh-agent.js';
import { addRole, importCurrentRole, useRole } from '../src/application/use-cases/role.js';

const role: Role = { name: 'work', fullName: 'Test Developer', email: 'test@example.invalid' };
const invalidPath = {
  name: 'InvalidSshKeyPathError',
  message: 'SSH key path must not start with "-"; use "./" for a filename starting with "-"'
};
const cliPath = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));

for (const sshKeyPath of ['-D', '-d', '-sprovider', '-t0', '--', '-', '  -D  ', '\t-\n']) {
  test(`role validation rejects option-like key path ${JSON.stringify(sshKeyPath)}`, () => {
    assert.throws(() => normalizeRole({ ...role, sshKeyPath }), invalidPath);
  });
}

test('role validation preserves normal optional key path normalization', () => {
  for (const sshKeyPath of ['/tmp/key', 'relative/key', '~/.ssh/key', '/tmp/key with spaces', './-D', './-']) {
    assert.equal(normalizeRole({ ...role, sshKeyPath: `  ${sshKeyPath}  ` }).sshKeyPath, sshKeyPath);
  }
  for (const sshKeyPath of [undefined, '', '  ']) {
    assert.equal(normalizeRole({ ...role, sshKeyPath }).sshKeyPath, undefined);
  }
});

test('store and add reject unsafe new and updated roles without changing persisted bytes', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-key-validation-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'roles.json');
  const store = new FileRoleStore({ configFilePath: file });
  await assert.rejects(() => store.save({ ...role, sshKeyPath: '-D' }), invalidPath);
  await assert.rejects(() => readFile(file), { code: 'ENOENT' });
  await store.save({ ...role, sshKeyPath: '~/.ssh/valid key' });
  const before = await readFile(file, 'utf8');
  for (const name of ['work', 'new']) {
    for (const save of [
      (input: Role) => store.save(input),
      (input: Role) => addRole({ roleStore: store, gitConfig: gitConfig(), sshAgent: inertAgent() }, input)
    ]) {
      await assert.rejects(() => save({ ...role, name, sshKeyPath: '  -D ' }), invalidPath);
      assert.equal(await readFile(file, 'utf8'), before);
    }
  }
});

test('legacy unsafe keys remain readable; switch reports failure and import can replace the role', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-key-legacy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'roles.json');
  const original = JSON.stringify({ roles: [{ ...role, sshKeyPath: ' -D ' }] });
  await writeFile(file, original);
  const store = new FileRoleStore({ configFilePath: file });
  assert.equal((await store.get('work'))?.sshKeyPath, '-D');
  const calls: string[][] = [];
  const writes: string[] = [];
  const config = gitConfig(writes);
  const result = await useRole({ roleStore: store, gitConfig: config,
    sshAgent: new SystemSshAgent({ exec: async (_file, args) => {
      calls.push(args); return { stdout: '', stderr: '' };
    } }) }, 'work');
  assert.deepEqual(writes, ['name:Test Developer', 'email:test@example.invalid']);
  assert.deepEqual(result.ssh, { ok: false, message: invalidPath.message, path: '-D' });
  assert.deepEqual(calls, []);
  assert.equal(await readFile(file, 'utf8'), original);
  const imported = await importCurrentRole({ roleStore: store, gitConfig: config, sshAgent: inertAgent() }, 'work');
  assert.equal(imported.role.sshKeyPath, undefined);
  assert.equal((await store.get('work'))?.sshKeyPath, undefined);
  await writeFile(file, original);
  assert.equal(await store.remove('work'), true);
  assert.deepEqual(await store.list(), []);
});

test('CLI add rejects unsafe paths with exit 1 and leaves existing roles unchanged', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-key-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const storeFile = path.join(dir, 'gitrole', 'roles.json');
  const store = new FileRoleStore({ configFilePath: storeFile });
  await store.save(role);
  const before = await readFile(storeFile, 'utf8');
  // Explicit environment and fixture storage: no inherited agent or Git configuration.
  for (const name of ['work', 'new']) {
    for (const sshKeyPath of ['-D', '-', '  -sprovider  ']) {
      const result = spawnSync(process.execPath, [cliPath, 'add', name,
        '--name', role.fullName, '--email', role.email, `--ssh=${sshKeyPath}`], {
        cwd: dir, encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: dir, XDG_CONFIG_HOME: dir, NO_COLOR: '1' }
      });
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stdout, '');
      assert.ok(result.stderr.includes(invalidPath.message), result.stderr);
      assert.equal(await readFile(storeFile, 'utf8'), before);
    }
  }
  const valid = spawnSync(process.execPath, [cliPath, 'add', 'work', '--name', role.fullName,
    '--email', role.email, '--ssh', './-D'], {
    cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, XDG_CONFIG_HOME: dir, NO_COLOR: '1' }
  });
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal((await store.get('work'))?.sshKeyPath, './-D');
});

function gitConfig(writes: string[] = []) {
  return {
    getGlobalUserName: async () => role.fullName,
    getGlobalUserEmail: async () => role.email,
    setGlobalUserName: async (value: string) => { writes.push(`name:${value}`); },
    setGlobalUserEmail: async (value: string) => { writes.push(`email:${value}`); }
  };
}

function inertAgent() {
  return { loadKey: async () => { throw new Error('saving must not load an SSH key'); } };
}

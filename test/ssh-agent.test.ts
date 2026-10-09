/*
 * Covers ssh-add execution and home-directory expansion for stored key paths.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';

import { SystemSshAgent, expandHomePath } from '../src/adapters/ssh-agent.js';

test('expandHomePath expands ~ for ssh key paths', () => {
  assert.equal(expandHomePath('~/.ssh/id_work', '/Users/sara'), '/Users/sara/.ssh/id_work');
  assert.equal(expandHomePath('~', '/Users/sara'), '/Users/sara');
  assert.equal(expandHomePath('/tmp/id_work', '/Users/sara'), '/tmp/id_work');
});

test('ssh agent expands home paths before calling ssh-add', async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const agent = new SystemSshAgent({
    binaryPath: 'ssh-add',
    exec: async (file, args) => {
      calls.push({ file, args });
      return { stdout: '', stderr: '' };
    }
  });

  await agent.loadKey('~/.ssh/id_work');

  assert.deepEqual(calls, [
    {
      file: 'ssh-add',
      args: ['--', `${os.homedir()}/.ssh/id_work`]
    }
  ]);
});

for (const keyPath of ['-D', '-d', '-sprovider', '-t0', '--', '-', '  -D  ', '\t-\n']) {
  test(`ssh agent refuses option-like path ${JSON.stringify(keyPath)} without execution`, async () => {
    const calls: string[][] = [];
    const agent = new SystemSshAgent({ exec: async (_file, args) => {
      calls.push(args);
      return { stdout: '', stderr: '' };
    } });
    assert.deepEqual(await agent.loadKey(keyPath), {
      ok: false,
      message: 'SSH key path must not start with "-"; use "./" for a filename starting with "-"'
    });
    assert.deepEqual(calls, []);
  });
}

for (const keyPath of ['/tmp/key', 'keys/id_work', './-D', './-', '/tmp/key with spaces', 'keys/-D', ' key with spaces ']) {
  test(`ssh agent passes ${JSON.stringify(keyPath)} as one operand`, async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const agent = new SystemSshAgent({ binaryPath: '/fixture/ssh-add', exec: async (file, args) => {
      calls.push({ file, args });
      return { stdout: '', stderr: '' };
    } });
    assert.deepEqual(await agent.loadKey(keyPath), { ok: true });
    assert.deepEqual(calls, [{ file: '/fixture/ssh-add', args: ['--', keyPath] }]);
  });
}

test('ssh agent retains missing executable and loading failure results', async () => {
  for (const [error, message] of [
    [Object.assign(new Error('missing'), { code: 'ENOENT' }), 'ssh-add is not installed or not available on PATH'],
    [new Error('key file not found'), 'key file not found']
  ] as const) {
    const agent = new SystemSshAgent({ exec: async (_file, args) => {
      assert.deepEqual(args, ['--', '/fixture/missing key']);
      throw error;
    } });
    assert.deepEqual(await agent.loadKey('/fixture/missing key'), { ok: false, message });
  }
});

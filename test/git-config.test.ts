/*
 * Verifies the global git config adapter against success and failure cases.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { SystemGitConfig } from '../src/adapters/git-config.js';
import { GitNotInstalledError } from '../src/application/use-cases/index.js';

test('git config adapter reads and writes the expected global keys', async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const adapter = new SystemGitConfig({
    binaryPath: 'git',
    exec: async (file, args) => {
      calls.push({ file, args });

      if (args.at(-1) === 'user.name') {
        return { stdout: 'Sara Loera\n', stderr: '' };
      }

      if (args.at(-1) === 'user.email') {
        return { stdout: 'sara@example.com\n', stderr: '' };
      }

      return { stdout: '', stderr: '' };
    }
  });

  await adapter.setGlobalUserName('Sara Loera');
  await adapter.setGlobalUserEmail('sara@example.com');

  const name = await adapter.getGlobalUserName();
  const email = await adapter.getGlobalUserEmail();

  assert.equal(name, 'Sara Loera');
  assert.equal(email, 'sara@example.com');
  assert.deepEqual(calls, [
    { file: 'git', args: ['config', '--global', 'user.name', 'Sara Loera'] },
    { file: 'git', args: ['config', '--global', 'user.email', 'sara@example.com'] },
    { file: 'git', args: ['config', '--global', '--get', 'user.name'] },
    { file: 'git', args: ['config', '--global', '--get', 'user.email'] }
  ]);
});

test('identity probes control locale, preserve identity input and propagate unrelated errors', async () => {
  const env = { LC_ALL: 'de_DE.UTF-8', LANG: 'de_DE.UTF-8', LANGUAGE: 'de', GIT_AUTHOR_NAME: 'Agent', EMAIL: 'agent@example.test' };
  const original = { ...env };
  const probes: string[] = [];
  let unrelatedFailure = false;
  const adapter = new SystemGitConfig({ exec: async (_file, args, options) => {
    if (args[0] === 'config') {
      assert.deepEqual(options?.env, original);
      throw Object.assign(new Error('missing config'), { code: 1 });
    }
    assert.equal(args[0], 'var');
    probes.push(args[1]);
    assert.deepEqual(options?.env, { ...original, LC_ALL: 'C', LANG: 'C', LANGUAGE: 'C' });
    const stderr = unrelatedFailure ? 'fatal: unable to read config file: Permission denied' : 'fatal: no email was given and auto-detection is disabled';
    throw Object.assign(new Error('git failed'), { code: 128, stderr });
  } });
  const actual = await adapter.getEffectiveIdentity(env);
  assert.equal(actual.author.email.source, 'unset');
  assert.equal(actual.committer.email.source, 'unset');
  assert.deepEqual(probes.sort(), ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']);
  assert.deepEqual(env, original);
  unrelatedFailure = true;
  await assert.rejects(() => adapter.getEffectiveIdentity(env), error => {
    assert.equal(Reflect.get(error as object, 'stderr'), 'fatal: unable to read config file: Permission denied');
    return true;
  });
});

test('git config adapter raises a clear error when git is missing', async () => {
  const adapter = new SystemGitConfig({
    exec: async () => {
      const error = new Error('spawn git ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    }
  });

  await assert.rejects(() => adapter.getGlobalUserName(), GitNotInstalledError);
});

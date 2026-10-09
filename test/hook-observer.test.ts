/* Real local Git/filesystem fixtures for the optional doctor hook observation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { observeLegacyHook } from '../src/adapters/hook-observer.js';

const exec = promisify(execFile);
// Exact published 0.10.11 payload; intentionally independent of the new packaged hook.
const legacy = '#!/bin/sh\n# Optional check-only pre-commit hook. It does not switch roles.\n# Install: cp hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit\nexec gitrole status --short\n';

async function fixture(t: { after: (fn: () => Promise<void>) => void }, bare = false) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'gitrole-hook-observer-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'repository');
  const home = path.join(root, 'home');
  await mkdir(home);
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && !key.startsWith('GITROLE_')));
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig'), GIT_ALLOW_PROTOCOL: '', GIT_TERMINAL_PROMPT: '0' });
  const git = async (...args: string[]) => exec('git', args, { cwd, env });
  await exec('git', ['init', ...(bare ? ['--bare'] : []), cwd], { env });
  const hook = path.join(cwd, ...(bare ? [] : ['.git']), 'hooks', 'pre-commit');
  const observe = () => observeLegacyHook({ cwd, env });
  const install = async (content = legacy, mode = 0o755, file = hook) => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
    await chmod(file, mode);
  };
  return { root, cwd, env, hook, git, observe, install };
}

test('exact legacy hook is informational, preserves bytes/mode/mtime, and never executes', async t => {
  const f = await fixture(t);
  await f.install();
  const before = await lstat(f.hook);
  const result = await f.observe();
  assert.equal(result?.status, 'info');
  assert.equal(result?.label, 'hook');
  assert.match(result!.message, /Legacy Gitrole/);
  assert.match(result!.message, /combined commit\/push/);
  assert.equal(await readFile(f.hook, 'utf8'), legacy);
  const after = await lstat(f.hook);
  assert.equal(after.mode, before.mode);
  assert.equal(after.mtimeMs, before.mtimeMs);
  const marker = path.join(f.root, 'must-not-execute');
  await f.install(`#!/bin/sh\ntouch '${marker}'\ngitrole status --short\n`);
  assert.match((await f.observe())!.message, /execution behavior not determined/);
  await assert.rejects(lstat(marker), { code: 'ENOENT' });
});

test('absent, new, and unrelated custom hooks produce no finding; nonexecutable legacy is qualified', async t => {
  const f = await fixture(t);
  assert.equal(await f.observe(), undefined);
  for (const content of ['#!/bin/sh\nexec gitrole check commit\n', '#!/bin/sh\nexit 0\n']) {
    await f.install(content);
    assert.equal(await f.observe(), undefined);
  }
  await f.install(legacy, 0o644);
  assert.match((await f.observe())!.message, /not executable; it is not established as an active commit blocker/);
});

test('edited, commented, conditional, and quoted invocations remain text-only findings', async t => {
  const f = await fixture(t);
  for (const content of [legacy + '# edited\n', legacy.replaceAll('\n', '\r\n'), '# gitrole status --short\n', 'if false; then gitrole status --short; fi\n', 'f() { gitrole status --short; }\n', 'echo "gitrole status --short"\n']) {
    await f.install(content);
    const result = await f.observe();
    assert.match(result!.message, /contains legacy status invocation text; execution behavior not determined/);
    assert.doesNotMatch(result!.message, /Legacy Gitrole pre-commit hook file found/);
  }
});

test('custom absolute/relative hooksPath resolves from root and nested cwd without exposing controls', async t => {
  const f = await fixture(t);
  const nested = path.join(f.cwd, 'nested');
  await mkdir(nested);
  for (const hooksPath of ['custom hooks', path.join(f.root, 'shared hooks\nname\u0085\u2028\u2029')]) {
    await f.git('config', 'core.hooksPath', hooksPath);
    await f.install(legacy, 0o755, path.resolve(f.cwd, hooksPath, 'pre-commit'));
    for (const cwd of [f.cwd, nested]) {
      const result = await observeLegacyHook({ cwd, env: f.env });
      assert.match(result!.message, /Legacy Gitrole/);
      assert.doesNotMatch(result!.message, /[\n\r\x1b\u007f-\u009f\u2028\u2029]/);
    }
  }
});

test('symlink targets and parent symlinks are bounded and explicitly qualified', async t => {
  const f = await fixture(t);
  const target = path.join(f.root, 'actual');
  await f.install(legacy, 0o755, target);
  await symlink(target, f.hook);
  assert.match((await f.observe())!.message, /symlink target matches/);
  await rm(f.hook);
  const directory = path.join(f.root, 'actual-hooks');
  await f.install(legacy, 0o755, path.join(directory, 'pre-commit'));
  const alias = path.join(f.root, 'alias-hooks');
  await symlink(directory, alias);
  await f.git('config', 'core.hooksPath', alias);
  assert.match((await f.observe())!.message, /symlink target matches/);
  await rm(path.join(directory, 'pre-commit'));
  assert.equal(await f.observe(), undefined, 'valid parent symlink with absent hook is ordinary absence');
});

test('dangling links, loops, and more than eight links report unknown', async t => {
  const f = await fixture(t);
  await symlink(path.join(f.root, 'missing'), f.hook);
  assert.match((await f.observe())!.message, /migration state unknown/);
  await rm(f.hook);
  await symlink(f.hook, f.hook);
  assert.match((await f.observe())!.message, /migration state unknown/);
  await rm(f.hook);
  const target = path.join(f.root, 'actual');
  await f.install(legacy, 0o755, target);
  let previous = target;
  for (let index = 0; index < 8; index++) {
    const next = path.join(f.root, `link-${index}`);
    await symlink(previous, next);
    previous = next;
  }
  await symlink(previous, f.hook);
  assert.match((await f.observe())!.message, /migration state unknown/);
  await rm(f.hook);
  await symlink(path.join(f.root, 'link-6'), f.hook);
  assert.match((await f.observe())!.message, /symlink target matches/, 'exactly eight links may resolve');
});

test('oversize, directory, FIFO and device hooks are not read as scripts', async t => {
  const f = await fixture(t);
  await f.install('x'.repeat(65537));
  assert.match((await f.observe())!.message, /exceeds 64 KiB/);
  await f.install('x'.repeat(65536));
  assert.equal(await f.observe(), undefined);
  await rm(f.hook);
  await mkdir(f.hook);
  assert.match((await f.observe())!.message, /not a regular file/);
  await rm(f.hook, { recursive: true });
  await exec('mkfifo', [f.hook], { env: f.env });
  assert.match((await f.observe())!.message, /not a regular file/);
  await rm(f.hook);
  await symlink('/dev/null', f.hook);
  assert.match((await f.observe())!.message, /not a regular file/);
});

test('bare context skips inspection, and explicit Git directory/worktree context resolves', async t => {
  const bare = await fixture(t, true);
  await bare.install();
  assert.equal(await bare.observe(), undefined);
  const f = await fixture(t);
  await f.install();
  const result = await observeLegacyHook({ cwd: f.root, env: { ...f.env, GIT_DIR: path.join(f.cwd, '.git'), GIT_WORK_TREE: f.cwd } });
  assert.match(result!.message, /Legacy Gitrole/);
  assert.match((await observeLegacyHook({ cwd: f.root, env: f.env }))!.message, /migration state unknown/);
});

test('linked worktree default and per-worktree hooksPath use Git effective resolution', async t => {
  const f = await fixture(t);
  await f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-m', 'fixture');
  const linked = path.join(f.root, 'linked');
  await f.git('worktree', 'add', '-b', 'linked', linked);
  await f.install();
  assert.match((await observeLegacyHook({ cwd: linked, env: f.env }))!.message, /Legacy Gitrole/);
  await f.git('config', 'extensions.worktreeConfig', 'true');
  await exec('git', ['config', '--worktree', 'core.hooksPath', 'local hooks'], { cwd: linked, env: f.env });
  await f.install(legacy, 0o755, path.join(linked, 'local hooks', 'pre-commit'));
  const nested = path.join(linked, 'nested');
  await mkdir(nested);
  assert.match((await observeLegacyHook({ cwd: nested, env: f.env }))!.message, /local hooks/);
});

test('unreadable hook reports unknown without changing permissions', async t => {
  if (process.getuid?.() === 0) { t.skip('root can read mode-000 files'); return; }
  const f = await fixture(t);
  await f.install(legacy, 0o000);
  try {
    assert.match((await f.observe())!.message, /migration state unknown/);
    assert.equal((await lstat(f.hook)).mode & 0o777, 0);
  } finally {
    await chmod(f.hook, 0o600);
  }
});

async function doctorCli(f: Awaited<ReturnType<typeof fixture>>, args = ['doctor', '--json']) {
  const cli = path.resolve('dist/cli/index.js');
  try {
    const result = await exec(process.execPath, [cli, ...args], { cwd: f.cwd, env: { ...f.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const result = error as { code: number; stdout: string; stderr: string };
    return { code: result.code, stdout: result.stdout, stderr: result.stderr };
  }
}

async function saveDoctorIdentity(f: Awaited<ReturnType<typeof fixture>>) {
  await f.git('config', 'user.name', 'Fixture Person');
  await f.git('config', 'user.email', 'fixture@example.test');
  const directory = path.join(f.env.XDG_CONFIG_HOME!, 'gitrole');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'roles.json'), JSON.stringify({ roles: [{ name: 'fixture', fullName: 'Fixture Person', email: 'fixture@example.test', githubUser: 'fixture-user', githubHost: 'fixture.test' }] }));
  await f.git('commit', '--allow-empty', '-m', 'fixture');
}

test('online doctor hook findings preserve all other JSON fields and exits in both JSON flag placements', async t => {
  const f = await fixture(t);
  await saveDoctorIdentity(f);
  const newHook = await readFile(path.resolve('hooks/pre-commit'), 'utf8');
  for (const withRemote of [false, true]) {
    if (withRemote) {
      await f.git('remote', 'add', 'origin', 'https://fixture.test/fixture/repository.git');
      await writeFile(path.join(f.cwd, '.gitrole'), JSON.stringify({ version: 1, defaultRole: 'fixture', allowedRoles: ['fixture'] }));
    }
    await rm(f.hook, { force: true });
    const baseline = await doctorCli(f);
    assert.equal(baseline.stderr, '');
    assert.equal(baseline.code, withRemote ? 0 : 2, baseline.stdout);
    const unsupportedPlacement = await doctorCli(f, ['--json', 'doctor']);
    assert.equal(unsupportedPlacement.code, 1);
    const expected = JSON.parse(baseline.stdout);
    assert.deepEqual(expected.checks.filter((check: { label: string }) => check.label === 'hook'), []);
    for (const [name, content, finding] of [
      ['absent', undefined, false],
      ['legacy', legacy, true],
      ['new', newHook, false],
      ['custom', '#!/bin/sh\n# gitrole status --short\nexit 0\n', true],
      ['unverified', 'x'.repeat(65537), true]
    ] as const) {
      await rm(f.hook, { force: true });
      if (content !== undefined) await f.install(content);
      for (const args of [['doctor', '--json'], ['--json', 'doctor']]) {
        const result = await doctorCli(f, args);
        if (args[0] === '--json') {
          assert.deepEqual(result, unsupportedPlacement, `${name}: unsupported global flag placement stays unchanged`);
          continue;
        }
        assert.equal(result.code, baseline.code, name);
        assert.equal(result.stderr, baseline.stderr, name);
        const actual = JSON.parse(result.stdout);
        assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), name);
        const hooks = actual.checks.filter((check: { label: string }) => check.label === 'hook');
        assert.equal(hooks.length, finding ? 1 : 0, name);
        for (const hook of hooks) assert.deepEqual(Object.keys(hook).sort(), ['label', 'message', 'status']);
        for (const hook of hooks) assert.equal(hook.status, 'info');
        actual.checks = actual.checks.filter((check: { label: string }) => check.label !== 'hook');
        assert.deepEqual(actual, expected, `${name}: hook inspection must not affect diagnosis`);
      }
    }
  }
});

for (const offline of [false, true]) {
test(`${offline ? 'offline' : 'online'} doctor preserves diagnosis and hook info with controlled SSH effects`, async t => {
  const f = await fixture(t);
  await saveDoctorIdentity(f);
  await f.git('remote', 'add', 'origin', 'git@fixture.test:fixture/repository.git');
  const bin = path.join(f.root, 'bin');
  const log = path.join(f.root, 'ssh-calls.jsonl');
  await mkdir(bin);
  const ssh = path.join(bin, 'ssh');
  await writeFile(ssh, `#!${process.execPath}\nconst fs = require('node:fs');\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nif (process.argv.includes('-G')) {\nprocess.stdout.write('hostname fixture.test\\nuser git\\nport 22\\nidentityfile /fixture/key\\nidentitiesonly yes\\nbatchmode yes\\npasswordauthentication no\\nkbdinteractiveauthentication no\\npubkeyauthentication yes\\npreferredauthentications publickey\\n');\nprocess.exit(0);\n}\nprocess.stderr.write("Hi fixture-user! You've successfully authenticated, but GitHub does not provide shell access.\\n");\nprocess.exit(1);\n`);
  await chmod(ssh, 0o755);
  f.env.PATH = `${bin}${path.delimiter}${f.env.PATH}`;
  let baseline: unknown;
  for (const installed of [false, true]) {
    if (installed) await f.install();
    await writeFile(log, '');
    const result = await doctorCli(f, ['doctor', '--json', ...(offline ? ['--offline'] : [])]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.checks.some((check: { label: string; status: string }) => check.label === 'auth' && check.status === (offline ? 'info' : 'ok')), true);
    assert.equal(parsed.checks.filter((check: { label: string }) => check.label === 'hook').length, installed ? 1 : 0);
    parsed.checks = parsed.checks.filter((check: { label: string }) => check.label !== 'hook');
    if (installed) assert.deepEqual(parsed, baseline); else baseline = parsed;
    const recorded = await readFile(log, 'utf8');
    if (offline) {
      assert.equal(recorded, '', 'offline hook observation must execute no SSH, including -G');
      continue;
    }
    const calls: string[][] = recorded.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(calls.filter(args => args.includes('-G')).length, 2);
    assert.equal(calls.filter(args => args.includes('-T') && !args.includes('-G')).length, 1);
    assert.equal(calls.every(args => args.includes('-G') || args.includes('BatchMode=yes')), true);
  }
});

}

for (const change of ['hook-mode', 'neighbor-entry'] as const) {
  test(`bounded read detects hook changes but tolerates unrelated directory changes: ${change}`, async t => {
    const f = await fixture(t);
    await f.install();
    const originalOpen = fsPromises.open;
    let changed = false;
    // Mock the existing Node boundary, not a production injection hook. The actual
    // open, read and mutation still occur on the isolated filesystem fixture.
    const mocked = t.mock.method(fsPromises, 'open', async (...args: Parameters<typeof fsPromises.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === f.hook) {
        const originalRead = handle.read;
        t.mock.method(handle, 'read', async (...readArgs: unknown[]) => {
          const result = await Reflect.apply(originalRead, handle, readArgs);
          if (!changed) {
            changed = true;
            if (change === 'hook-mode') await chmod(f.hook, 0o600);
            else await writeFile(path.join(path.dirname(f.hook), 'unrelated-neighbor'), 'neighbor');
          }
          return result;
        });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try {
      const result = await f.observe();
      assert.equal(changed, true, 'hostile/control mutation must execute during the actual read');
      assert.match(result!.message, change === 'hook-mode' ? /migration state unknown/ : /Legacy Gitrole/);
    } finally {
      mocked.mock.restore();
      syncBuiltinESMExports();
    }
  });
}

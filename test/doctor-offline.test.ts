/* Exercises offline doctor through the real CLI and Git with controlled SSH sentinels. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DoctorResult } from '../src/application/contracts.js';

const cli = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));
const work = { name: 'work', fullName: 'Sara Fixture', email: 'sara@example.test', githubUser: 'fixture-user', githubHost: 'fixture.test' };
const personal = { name: 'personal', fullName: 'Other Fixture', email: 'other@example.test', githubUser: 'other-fixture', githubHost: 'fixture.test' };

async function fixture(t: test.TestContext, committed = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gitrole-doctor-offline-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const bin = path.join(root, 'bin');
  const roles = path.join(root, 'config', 'gitrole', 'roles.json');
  const marker = path.join(root, 'ssh-called');
  await mkdir(repo); await mkdir(bin); await mkdir(path.dirname(roles), { recursive: true });
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    HOME: root, XDG_CONFIG_HOME: path.join(root, 'config'),
    GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    LC_ALL: 'C', LANG: 'C', NO_COLOR: '1'
  };
  // Every SSH entrypoint points at a synthetic executable. Even inspection is observable.
  const sentinel = `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(marker)}, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv.includes('-G')) {
  process.stdout.write('hostname fixture.test\\nuser git\\nport 22\\nidentityfile /fixture/key\\nidentitiesonly yes\\nbatchmode yes\\npasswordauthentication no\\nkbdinteractiveauthentication no\\npubkeyauthentication yes\\npreferredauthentications publickey\\n');
  process.exit(0);
}
process.stderr.write("Hi fixture-user! You've successfully authenticated, but GitHub does not provide shell access.\\n");
process.exit(1);
`;
  for (const name of ['ssh', 'alternate', 'wrapper']) {
    await writeFile(path.join(bin, name), sentinel); await chmod(path.join(bin, name), 0o755);
  }
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  await writeFile(roles, JSON.stringify({ roles: [work, personal] }));
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', work.fullName); git('config', 'user.email', work.email);
  if (committed) git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'fixture');
  git('remote', 'add', 'origin', 'git@fixture.test:team/repo.git');
  const run = (args: string[], overrides: NodeJS.ProcessEnv = {}, cwd = repo) => spawnSync(process.execPath, [cli, 'doctor', ...args], {
    cwd, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 15000
  });
  const zeroSsh = async () => {
    const calls = await readFile(marker, 'utf8').catch((error: NodeJS.ErrnoException) => {
      assert.equal(error.code, 'ENOENT'); return '';
    });
    assert.equal(calls, '', 'offline doctor executed SSH (including configuration inspection)');
  };
  const json = async (expected: number, overrides: NodeJS.ProcessEnv = {}, cwd = repo) => {
    const result = run(['--offline', '--json'], overrides, cwd);
    // Observe effects before output assertions so a weakened guard fails at its owning oracle.
    await zeroSsh();
    assert.equal(result.status, expected, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    const data = JSON.parse(result.stdout) as DoctorResult;
    assert.equal(data.sshAuth, undefined);
    for (const target of data.repository.push?.targets ?? []) assert.equal(target.sshAuth, undefined);
    assert.equal(data.overall, expected === 0 ? 'aligned' : 'warning');
    return data;
  };
  const policy = (defaultRole: string, allowedRoles = [defaultRole]) => writeFile(path.join(repo, '.gitrole'), JSON.stringify({ version: 1, defaultRole, allowedRoles }));
  return { root, repo, roles, marker, bin, env, git, run, json, zeroSsh, policy };
}

function check(result: DoctorResult, label: string, status: string, message: RegExp) {
  assert.ok(result.checks.some((entry) => entry.label === label && entry.status === status && message.test(entry.message)), JSON.stringify(result.checks));
}

test('offline doctor invokes zero SSH in human and both JSON orders; online control observes SSH', async (t) => {
  const f = await fixture(t);
  const before = await Promise.all([readFile(f.roles, 'utf8'), readFile(path.join(f.repo, '.git/config'), 'utf8')]);
  const human = f.run(['--offline']);
  await f.zeroSsh();
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /SSH authentication skipped \(--offline\); local checks only/);
  assert.doesNotMatch(human.stdout, /SSH auth (matches|resolved|could not)/);
  const forward = f.run(['--offline', '--json']);
  const reverse = f.run(['--json', '--offline']);
  await f.zeroSsh();
  assert.equal(forward.status, 0); assert.equal(reverse.status, 0);
  assert.equal(forward.stdout, reverse.stdout);
  const data = await f.json(0);
  check(data, 'auth', 'info', /skipped/);
  assert.equal(data.role?.githubUser, 'fixture-user'); // Saved expectation remains distinct from observation.
  assert.deepEqual(Object.keys(data).sort(), ['checks', 'commitIdentity', 'committerIdentity', 'configuredIdentity', 'overall', 'repository', 'role', 'scope']);
  assert.deepEqual(Object.keys(data.repository.push!.targets[0]), ['remote']);
  assert.deepEqual(await Promise.all([readFile(f.roles, 'utf8'), readFile(path.join(f.repo, '.git/config'), 'utf8')]), before);
  const online = f.run(['--json']);
  assert.equal(online.status, 0, online.stderr || online.stdout);
  assert.equal(JSON.parse(online.stdout).sshAuth.githubUser, 'fixture-user');
  const calls = (await readFile(f.marker, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as string[]);
  assert.ok(calls.some((args) => args.includes('-G')), 'online control must exercise SSH inspection');
  assert.ok(calls.some((args) => args.includes('-T')), 'online control must exercise authentication');
});

test('offline doctor skips alternate SSH binaries and custom wrappers', async (t) => {
  const f = await fixture(t);
  for (const key of ['GITROLE_SSH_BIN', 'GIT_SSH', 'GIT_SSH_COMMAND']) {
    check(await f.json(0, { [key]: path.join(f.bin, key === 'GITROLE_SSH_BIN' ? 'alternate' : 'wrapper') }), 'auth', 'info', /skipped/);
  }
  f.git('config', 'core.sshCommand', path.join(f.bin, 'wrapper'));
  await f.json(0);
});

test('offline doctor checks later push hosts while ignoring unrelated fetch host', async (t) => {
  const f = await fixture(t);
  f.git('remote', 'set-url', 'origin', 'git@fetch.test:team/repo.git');
  f.git('config', '--add', 'remote.origin.pushurl', 'git@fixture.test:team/repo.git');
  f.git('config', '--add', 'remote.origin.pushurl', 'git@later.test:team/repo.git');
  const result = await f.json(2);
  assert.equal(result.repository.fetchRemote?.host, 'fetch.test');
  check(result, 'host', 'warn', /later\.test.*does not match/);
  assert.equal(result.checks.filter((entry) => entry.label === 'auth' && entry.status === 'info').length, 2);
  const human = f.run(['--offline']); await f.zeroSsh();
  assert.equal(human.status, 2); assert.match(human.stdout, /later\.test.*does not match/);
});

test('offline doctor preserves pure and mixed HTTPS pin semantics for every target order', async (t) => {
  const f = await fixture(t);
  for (const urls of [
    ['https://fixture.test/team/repo.git'],
    ['git@fixture.test:team/repo.git', 'https://fixture.test/team/repo.git'],
    ['https://fixture.test/team/repo.git', 'git@fixture.test:team/repo.git']
  ]) {
    f.git('config', '--replace-all', 'remote.origin.pushurl', urls[0]);
    for (const url of urls.slice(1)) f.git('config', '--add', 'remote.origin.pushurl', url);
    await rm(path.join(f.repo, '.gitrole'), { force: true });
    check(await f.json(2), 'auth', 'warn', /no repo pin/);
    await f.policy('work');
    const aligned = await f.json(0);
    check(aligned, 'auth', 'info', /HTTPS/);
    assert.ok(!aligned.checks.some((entry) => /mixed SSH and HTTPS/.test(entry.message)));
    await f.policy('personal');
    check(await f.json(2), 'auth', 'warn', /does not match pin/);
    await f.policy('personal', ['personal', 'work']);
    await f.json(0); // An allowed non-default role remains locally aligned.
    await writeFile(f.roles, JSON.stringify({ roles: [{ ...work, githubUser: undefined }, personal] }));
    check(await f.json(2), 'auth', 'warn', /no identity pin/);
    await writeFile(f.roles, JSON.stringify({ roles: [work, personal] }));
  }
});

test('offline doctor retains local identity, policy, missing-role and destination warnings', async (t) => {
  const f = await fixture(t);
  check(await f.json(2, { GIT_COMMITTER_EMAIL: 'committer@example.test' }), 'commit', 'warn', /committer/);
  check(await f.json(2, { GIT_AUTHOR_EMAIL: 'unknown@example.test' }), 'role', 'warn', /does not match/);
  await f.policy('personal'); check(await f.json(2), 'policy', 'warn', /not allowed/);
  await rm(path.join(f.repo, '.gitrole'));
  await writeFile(f.roles, JSON.stringify({ roles: [] }));
  const noRole = await f.json(2); check(noRole, 'role', 'warn', /does not match/); check(noRole, 'auth', 'info', /skipped/);
  await writeFile(f.roles, JSON.stringify({ roles: [work, personal] }));
  f.git('remote', 'set-url', 'origin', 'file:///synthetic/repo.git');
  check(await f.json(2), 'remote', 'warn', /unsupported|local push/);
  f.git('remote', 'remove', 'origin');
  check(await f.json(2), 'remote', 'warn', /destination/);
});

test('offline doctor handles fresh repositories, outside-repo, usage and local data errors', async (t) => {
  const f = await fixture(t, false);
  check(await f.json(2), 'history', 'warn', /no commits/);
  check(await f.json(2, {}, f.root), 'repo', 'warn', /not inside/);
  for (const args of [['--offline', '--unknown'], ['--json', '--offline', '--unknown']]) {
    const result = f.run(args); await f.zeroSsh(); assert.equal(result.status, 1);
  }
  await writeFile(path.join(f.repo, '.gitrole'), '{');
  let result = f.run(['--offline', '--json']); await f.zeroSsh(); assert.equal(result.status, 1); assert.equal(result.stdout, '');
  await rm(path.join(f.repo, '.gitrole'));
  await writeFile(f.roles, '{');
  result = f.run(['--offline']); await f.zeroSsh(); assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.match(result.stderr, /saved role data is invalid/);
});

test('doctor help exposes offline JSON composition and local-only meaning', () => {
  const result = spawnSync(process.execPath, [cli, 'doctor', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--offline/);
  assert.match(result.stdout, /doctor --offline --json/);
  assert.match(result.stdout, /doctor --json --offline/);
  assert.match(result.stdout, /Authentication is skipped \(info\), not failed or verified/);
});

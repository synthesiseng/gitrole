/* Real Git commits exercise the local guard with isolated identity and transport sentinels. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const cli = path.resolve('dist/cli/index.js');
const packagedHook = path.resolve('hooks/pre-commit');
const role = { name: 'work', fullName: 'Fixture Developer', email: 'fixture@example.test' };
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
interface Fixture { root: string; repo: string; store: string; env: NodeJS.ProcessEnv; marker: string; }
function run(f: Fixture, executable: string, args: string[], env: NodeJS.ProcessEnv = {}, cwd = f.repo) {
  return spawnSync(executable, args, { cwd, env: { ...f.env, ...env }, encoding: 'utf8', timeout: 15000 });
}
function git(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}, cwd = f.repo) {
  const result = run(f, 'git', args, env, cwd);
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
}
function check(f: Fixture, expected = 0, env: NodeJS.ProcessEnv = {}, cwd = f.repo) {
  const result = run(f, process.execPath, [cli, 'check', 'commit'], env, cwd);
  assert.equal(result.status, expected, `check commit\n${result.stdout}\n${result.stderr}`);
  assert.equal(result.stdout, '');
  if (expected === 0) assert.equal(result.stderr, '');
  else assert.notEqual(result.stderr, '');
  return result;
}
function assertBypass(stderr: string) {
  assert.equal((stderr.match(/git commit --no-verify/g) ?? []).length, 1);
  assert.match(stderr, /all other pre-commit checks/);
  assert.match(stderr, /commit-msg/);
  assert.match(stderr, /does not correct identity/);
  assert.match(stderr, /deliberately accept that bypass/);
}
async function roles(f: Fixture, values: unknown = [role]) { await writeFile(f.store, JSON.stringify({ roles: values })); }
async function policy(f: Fixture, defaultRole = 'work', allowedRoles = ['work']) {
  await writeFile(path.join(f.repo, '.gitrole'), JSON.stringify({ version: 1, defaultRole, allowedRoles }));
}
async function fixture(t: TestContext): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gitrole-local-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  const store = path.join(home, '.config/gitrole/roles.json');
  await mkdir(path.dirname(store), { recursive: true });
  await mkdir(repo); await mkdir(bin);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') || key.startsWith('GITROLE_') || key === 'EMAIL') delete env[key];
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(home, 'global'), GIT_TERMINAL_PROMPT: '0', PATH: `${bin}:${process.env.PATH}`, NO_COLOR: '1', FORCE_COLOR: '0' });
  await writeFile(env.GIT_CONFIG_GLOBAL!, '[user]\nuseConfigOnly = true\n');
  const marker = path.join(root, 'forbidden');
  const sentinel = `#!/bin/sh\nprintf '%s\\n' "$*" >> ${quote(marker)}\nexit 97\n`;
  for (const name of ['ssh', 'ssh-add', 'git-remote-fixture', 'fsmonitor']) {
    await writeFile(path.join(bin, name), sentinel); await chmod(path.join(bin, name), 0o755);
  }
  await writeFile(path.join(bin, 'gitrole'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cli)} "$@"\n`);
  await chmod(path.join(bin, 'gitrole'), 0o755);
  const f = { root, repo, store, env, marker };
  git(f, ['init', '-b', 'main']);
  git(f, ['config', 'user.name', role.fullName]); git(f, ['config', 'user.email', role.email]);
  git(f, ['config', 'commit.gpgsign', 'false']);
  await roles(f);
  await copyFile(packagedHook, path.join(repo, '.git/hooks/pre-commit'));
  await chmod(path.join(repo, '.git/hooks/pre-commit'), 0o755);
  return f;
}
async function noAttempts(f: Fixture) {
  await assert.rejects(readFile(f.marker), { code: 'ENOENT' });
}

for (const remote of [undefined, 'https://example.test/project.git', 'git@fixture.test:project.git']) {
  test(`local guard permits correctly pinned first and established commits with ${remote ?? 'no remote'}`, async (t) => {
    const f = await fixture(t); await policy(f);
    if (remote) git(f, ['remote', 'add', 'origin', remote]);
    const before = await Promise.all([readFile(f.store), readFile(path.join(f.repo, '.git/config')), readFile(path.join(f.repo, '.gitrole'))]);
    check(f);
    git(f, ['commit', '--allow-empty', '-m', 'first']);
    git(f, ['commit', '--allow-empty', '-m', 'second']);
    assert.equal(git(f, ['rev-list', '--count', 'HEAD']), '2');
    assert.equal(git(f, ['log', '--format=%an <%ae>|%cn <%ce>']), Array(2).fill(`${role.fullName} <${role.email}>|${role.fullName} <${role.email}>`).join('\n'));
    const after = await Promise.all([readFile(f.store), readFile(path.join(f.repo, '.git/config')), readFile(path.join(f.repo, '.gitrole'))]);
    assert.deepEqual(after, before);
    assert.ok((await stat(path.join(f.repo, '.git/hooks/pre-commit'))).mode & 0o111);
    await noAttempts(f);
  });
}

test('large valid index does not turn a matching identity into a read failure', async (t) => {
  const f = await fixture(t);
  const blob = git(f, ['hash-object', '-w', '--stdin']);
  const entries = Array.from({ length: 10000 }, (_, i) =>
    `100644 ${blob}\t${String(i).padStart(5, '0')}-${'x'.repeat(90)}\n`).join('');
  assert.ok(Buffer.byteLength(entries) > 1024 * 1024);
  const indexed = spawnSync('git', ['update-index', '--index-info'], {
    cwd: f.repo, env: f.env, input: entries, encoding: 'utf8'
  });
  assert.equal(indexed.status, 0, indexed.stderr);
  check(f);
  git(f, ['commit', '-q', '-m', 'large index']);
  check(f);
  await noAttempts(f);
});

test('an unpinned repository still requires a complete saved role and never creates missing storage', async (t) => {
  const f = await fixture(t);
  check(f); await rm(f.store); check(f, 2);
  await assert.rejects(readFile(f.store), { code: 'ENOENT' });
  const blocked = run(f, 'git', ['commit', '--allow-empty', '-m', 'must refuse']);
  assert.equal(blocked.status, 1); assertBypass(blocked.stderr);
  assert.notEqual(run(f, 'git', ['rev-parse', '--verify', 'HEAD']).status, 0);
  await roles(f, []); check(f, 2);
  await roles(f, [{ ...role, email: '' }]); check(f, 2);
});

test('author, committer, and Git-prepared --author mismatches refuse without advancing HEAD', async (t) => {
  const f = await fixture(t); git(f, ['commit', '--allow-empty', '-m', 'baseline']);
  const head = git(f, ['rev-parse', 'HEAD']);
  for (const env of [{ GIT_AUTHOR_EMAIL: 'other@example.test' }, { GIT_COMMITTER_EMAIL: 'other@example.test' }]) {
    check(f, 2, env);
    assert.equal(run(f, 'git', ['commit', '--allow-empty', '-m', 'blocked'], env).status, 1);
    assert.equal(git(f, ['rev-parse', 'HEAD']), head);
  }
  const author = run(f, 'git', ['commit', '--allow-empty', '--author=Other <other@example.test>', '-m', 'blocked']);
  assert.equal(author.status, 1); assert.match(author.stderr, /author|identity/i);
  assert.equal(git(f, ['rev-parse', 'HEAD']), head);
  git(f, ['commit', '--amend', '--allow-empty', '--no-edit']);
  check(f);
});

test('allowed non-default role does not require a saved default; duplicate identity first-match remains authoritative', async (t) => {
  const f = await fixture(t);
  await policy(f, 'missing-default', ['missing-default', 'work']); check(f);
  await roles(f, [{ ...role, name: 'other' }, role]); check(f, 2);
  await roles(f, [role, { ...role, name: 'other' }]); check(f);
  await policy(f, 'other', ['other']); check(f, 2);
});

test('legacy unrelated blank and reserved profiles do not veto a valid match; reserved matched role refuses', async (t) => {
  const f = await fixture(t);
  await roles(f, [{ name: 'blank', fullName: '', email: '' }, { name: 'no-role', fullName: 'Other', email: 'other@test' }, role]); check(f);
  await roles(f, [{ ...role, name: 'no-role' }, role]); check(f, 2);
});

test('malformed required policy or any stored record wins over identity mismatch', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.repo, '.gitrole'), '{');
  check(f, 1, { GIT_AUTHOR_EMAIL: 'other@test' });
  await rm(path.join(f.repo, '.gitrole'));
  await roles(f, [role, { name: 'broken', fullName: 42, email: 'other@test' }]); check(f, 1);
  await writeFile(f.store, '{'); check(f, 1);
});

test('required-file symlinks distinguish valid targets from dangling targets and nonregular files', async (t) => {
  const f = await fixture(t);
  const target = path.join(f.root, 'roles-target');
  await copyFile(f.store, target); await rm(f.store); await symlink(target, f.store); check(f);
  await rm(target); check(f, 1);
  await rm(f.store); await mkdir(f.store); check(f, 1);
  await rm(f.store, { recursive: true }); await roles(f);
  await symlink(path.join(f.root, 'missing-policy'), path.join(f.repo, '.gitrole')); check(f, 1);
});

test('global-only unborn and mixed-source identities refuse, while established matching global identity passes', async (t) => {
  const f = await fixture(t);
  git(f, ['config', '--global', 'user.name', role.fullName]); git(f, ['config', '--global', 'user.email', role.email]);
  git(f, ['config', '--unset', 'user.name']); git(f, ['config', '--unset', 'user.email']); check(f, 2);
  git(f, ['config', 'user.name', role.fullName]); check(f, 2);
  git(f, ['config', 'user.email', role.email]); git(f, ['commit', '--allow-empty', '-m', 'baseline']);
  git(f, ['config', '--unset', 'user.name']); git(f, ['config', '--unset', 'user.email']); check(f);
});

test('outside and bare contexts refuse while corrupt index, refs, and missing objects are read failures', async (t) => {
  const f = await fixture(t); check(f, 2, {}, f.root);
  const bare = path.join(f.root, 'bare.git'); git(f, ['init', '--bare', bare]); check(f, 2, {}, bare);
  await writeFile(path.join(f.repo, '.git/index'), 'damaged'); check(f, 1);
  await rm(path.join(f.repo, '.git/index'));
  await writeFile(path.join(f.repo, '.git/refs/heads/main'), 'broken\n'); check(f, 1);
  await rm(path.join(f.repo, '.git/refs/heads/main'));
  git(f, ['commit', '--allow-empty', '-m', 'baseline']);
  const oid = git(f, ['rev-parse', 'HEAD']);
  await rm(path.join(f.repo, '.git/objects', oid.slice(0, 2), oid.slice(2))); check(f, 1);
  await noAttempts(f);
});

test('linked worktrees are checked locally and configured fsmonitor is not executed by the direct check', async (t) => {
  const f = await fixture(t); git(f, ['commit', '--allow-empty', '-m', 'baseline']);
  const linked = path.join(f.root, 'linked'); git(f, ['worktree', 'add', '-b', 'linked', linked]);
  check(f, 0, {}, linked);
  git(f, ['config', 'core.fsmonitor', path.join(f.root, 'bin/fsmonitor')]);
  check(f); await noAttempts(f);
  run(f, 'git', ['status', '--porcelain']);
  assert.notEqual(await readFile(f.marker, 'utf8'), '', 'positive control must detect configured fsmonitor');
});

test('online status positive control triggers synthetic SSH while check commit never probes it', async (t) => {
  const f = await fixture(t); git(f, ['remote', 'add', 'origin', 'git@fixture.test:project.git']);
  check(f); await noAttempts(f);
  const result = run(f, process.execPath, [cli, 'status', '--short']);
  assert.equal(result.status, 2);
  assert.match(await readFile(f.marker, 'utf8'), /-G/);
});

test('check commit rejects operands and offline/json flags instead of expanding its public contract', async (t) => {
  const f = await fixture(t);
  for (const extra of [['--offline'], ['--json'], ['extra']]) {
    const result = run(f, process.execPath, [cli, 'check', 'commit', ...extra]);
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.notEqual(result.stderr, '');
  }
});

test('all local Git observations deny transport, optional locks and lazy fetch without resolving remotes or history', async (t) => {
  const f = await fixture(t);
  git(f, ['remote', 'add', 'origin', 'fixture::would-network']);
  const gitPath = spawnSync('/bin/sh', ['-c', 'command -v git'], { env: f.env, encoding: 'utf8' }).stdout.trim();
  assert.ok(path.isAbsolute(gitPath));
  const trace = path.join(f.root, 'git-observations');
  const adapter = path.join(f.root, 'git-observer');
  await writeFile(adapter, `#!/bin/sh\n[ "$GIT_NO_LAZY_FETCH" = 1 ] && [ "\${GIT_ALLOW_PROTOCOL+x}" = x ] && [ "$GIT_ALLOW_PROTOCOL" = '' ] && [ "$GIT_OPTIONAL_LOCKS" = 0 ] || exit 96\nprintf '%s\\n' "$*" >> ${quote(trace)}\nexec ${quote(gitPath)} "$@"\n`);
  await chmod(adapter, 0o755);
  const before = await readFile(path.join(f.repo, '.git/config'));
  check(f, 0, { GITROLE_GIT_BIN: adapter });
  const observed = await readFile(trace, 'utf8');
  assert.match(observed, /ls-files --stage/);
  assert.doesNotMatch(observed, /^(?:remote|push|fetch|ls-remote|log|rev-list)\b/m);
  assert.doesNotMatch(observed, /(?:remote\.[^ ]+\.url|pushRemote|pushDefault|@\{push\})/);
  assert.deepEqual(await readFile(path.join(f.repo, '.git/config')), before);
  await noAttempts(f);
});

test('Git command-scope and included identities use the actual effective values; missing Git fails closed', async (t) => {
  const f = await fixture(t);
  const commandEnv = { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: role.fullName, GIT_CONFIG_KEY_1: 'user.email', GIT_CONFIG_VALUE_1: role.email };
  check(f, 2, commandEnv);
  git(f, ['commit', '--allow-empty', '-m', 'baseline']);
  check(f, 0, commandEnv);
  check(f, 2, { ...commandEnv, GIT_CONFIG_VALUE_1: 'other@test' });
  const included = path.join(f.root, 'included config');
  await writeFile(included, `[user]\nname = ${role.fullName}\nemail = ${role.email}\n`);
  git(f, ['config', '--unset', 'user.name']); git(f, ['config', '--unset', 'user.email']);
  git(f, ['config', 'include.path', included]); check(f);
  check(f, 1, { GITROLE_GIT_BIN: path.join(f.root, 'missing-git') });
});

test('read-only guard leaves the index byte-for-byte unchanged and does not create absent policy', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.repo, 'tracked'), 'content\n'); git(f, ['add', 'tracked']);
  const index = path.join(f.repo, '.git/index');
  const before = await readFile(index);
  check(f); assert.deepEqual(await readFile(index), before);
  await assert.rejects(readFile(path.join(f.repo, '.gitrole')), { code: 'ENOENT' });
  check(f, 2, { GIT_AUTHOR_NAME: 'Wrong' }); assert.deepEqual(await readFile(index), before);
  await assert.rejects(readFile(`${index}.lock`), { code: 'ENOENT' });
});

test('unreadable regular storage and dangling storage-directory links are failures, not missing optional storage', async (t) => {
  const f = await fixture(t);
  if (process.getuid?.() !== 0 && process.platform !== 'win32') {
    await chmod(f.store, 0);
    try { check(f, 1); } finally { await chmod(f.store, 0o600); }
  } else {
    t.diagnostic('Permission-denial subcase requires a non-root POSIX account.');
  }
  await rm(path.dirname(f.store), { recursive: true });
  await symlink(path.join(f.root, 'missing-role-directory'), path.dirname(f.store));
  check(f, 1);
});


test('diagnostics escape controls, bound identity text and do not execute suggestions', async (t) => {
  const f = await fixture(t);
  const injected = `Wrong \u001b[31m $(touch ${f.marker}) ${'x'.repeat(2000)}`;
  const result = check(f, 2, { GIT_AUTHOR_NAME: injected });
  assert.doesNotMatch(result.stderr, /[\u001b\u0007]/);
  assert.ok(result.stderr.length < 5000, 'identity diagnostics must remain bounded');
  assert.match(result.stderr, /author/);
  assert.match(result.stderr, /--author|Git-prepared/);
  await noAttempts(f);
});


test('direct mismatch and read errors disclose bypass; hook presentation marker never changes the verdict', async (t) => {
  const f = await fixture(t);
  check(f, 0, { GITROLE_COMMIT_HOOK: '1' });
  const mismatch = { GIT_AUTHOR_EMAIL: 'other@example.test' };
  const direct = check(f, 2, mismatch);
  assertBypass(direct.stderr);
  const marked = check(f, 2, { ...mismatch, GITROLE_COMMIT_HOOK: '1' });
  assert.doesNotMatch(marked.stderr, /git commit --no-verify/);
  assert.equal(marked.stderr, direct.stderr.slice(0, direct.stderr.indexOf('git commit --no-verify')));
  assertBypass(check(f, 2, { ...mismatch, GITROLE_COMMIT_HOOK: '0' }).stderr);
  const wrapper = run(f, 'git', ['commit', '--allow-empty', '-m', 'blocked'], mismatch);
  assert.equal(wrapper.status, 1); assertBypass(wrapper.stderr);
  await writeFile(f.store, '{');
  assertBypass(check(f, 1).stderr);
  const markedError = check(f, 1, { GITROLE_COMMIT_HOOK: '1' });
  assert.doesNotMatch(markedError.stderr, /git commit --no-verify/);
  const brokenWrapper = run(f, 'git', ['commit', '--allow-empty', '-m', 'broken storage']);
  assert.equal(brokenWrapper.status, 1); assertBypass(brokenWrapper.stderr);
});


test('oversized valid role names remain usable but cannot flood diagnostics or produce truncated commands', async (t) => {
  const f = await fixture(t);
  const oversized = 'x'.repeat(200000);
  await roles(f, [{ ...role, name: oversized }]);
  check(f);
  const suggestion = check(f, 2, { GIT_COMMITTER_NAME: 'Other' });
  assert.ok(suggestion.stderr.length < 5000);
  assert.match(suggestion.stderr, /complete intended role name/);
  assert.doesNotMatch(suggestion.stderr, /gitrole use 'x/);
  await roles(f);
  await policy(f, oversized, [oversized]);
  const refused = check(f, 2);
  assert.ok(refused.stderr.length < 5000);
  assert.match(refused.stderr, /not allowed/);
  assert.match(refused.stderr, /truncated/);
  assertBypass(refused.stderr);
  await noAttempts(f);
});

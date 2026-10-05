/*
 * Exercises default push selection with real Git and prevents fetch-only authentication evidence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, mkdir, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SystemGitRepository, parseRemoteUrl } from '../src/adapters/git-repository.js';
import { SystemGitConfig } from '../src/adapters/git-config.js';
import { getStatus, doctor } from '../src/application/use-cases/index.js';
import { renderShortStatus } from '../src/interface/renderer.js';
import type { DoctorDependencies } from '../src/application/contracts.js';
const execFile = promisify(nodeExecFile);

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gitrole-push-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  await mkdir(repo);
  // Isolate global/system config and all inherited identity/SSH/config overrides.
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: root, GIT_CONFIG_GLOBAL: path.join(root, 'global'), GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C', LANGUAGE: 'C' };
  for (const key of Object.keys(env)) if (/^GIT_(AUTHOR|COMMITTER|CONFIG_COUNT|CONFIG_PARAMETERS|CONFIG$|CONFIG_KEY_|CONFIG_VALUE_|SSH|DIR|WORK_TREE|COMMON_DIR)/.test(key)) delete env[key];
  const git = async (...args: string[]) => execFile('git', args, { cwd: repo, env });
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.name', 'Fixture');
  await git('config', 'user.email', 'fixture@example.test');
  await git('config', 'push.default', 'current');
  const repository = new SystemGitRepository({ exec: (file, args, options) => execFile(file, args, { cwd: repo, env: options?.env ?? env }) });
  const role = { name: 'work', fullName: 'Fixture', email: 'fixture@example.test', githubHost: 'work.test', githubUser: 'work' };
  const calls: Array<{ host: string; context?: unknown }> = [];
  const dependencies: DoctorDependencies = {
    repository, env,
    gitConfig: new SystemGitConfig({ exec: (file, args, options) => execFile(file, args, { cwd: repo, env: options?.env ?? env }) }),
    roleStore: { list: async () => [role], get: async () => role, save: async () => {}, remove: async () => false },
    sshAuthProbe: { probeGithubUser: async (host, context) => { calls.push({ host, context }); return { ok: true, host, githubUser: host === 'work.test' ? 'work' : 'personal' }; } }
  };
  return { root, repo, env, git, repository, dependencies, calls };
}

test('real Git resolves default remote precedence and URLs, independent of upstream/refspec readiness', async (t) => {
  const f = await fixture(t);
  for (const remote of ['origin', 'fetch', 'push', 'branchpush']) await f.git('remote', 'add', remote, `git@${remote}.test:acme/repo.git`);
  const selected = async () => (await f.repository.getPushDestination(f.env)).remoteName;
  assert.equal(await selected(), 'origin');
  await f.git('config', 'branch.main.remote', 'fetch'); assert.equal(await selected(), 'fetch');
  await f.git('config', 'remote.pushDefault', 'push'); assert.equal(await selected(), 'push');
  await f.git('config', 'branch.main.pushRemote', 'branchpush'); assert.equal(await selected(), 'branchpush');
  await f.git('config', 'remote.branchpush.pushurl', 'ssh://alice@push.test:2222/acme/repo.git');
  let result = await f.repository.getPushDestination(f.env);
  assert.equal(result.targets[0].user, 'alice'); assert.equal(result.targets[0].port, 2222);
  assert.equal(result.targets[0].host, 'push.test');
  await f.git('config', 'branch.main.pushRemote', 'missing');
  const missing = await f.repository.getPushDestination(f.env);
  assert.equal(missing.remoteName, 'missing');
  assert.equal(missing.message, undefined);
  assert.deepEqual(missing.targets.map((target) => target.url), ['missing']);
  assert.equal(missing.targets[0].protocol, 'unknown');
  await f.git('config', 'branch.main.pushRemote', '.');
  assert.match((await f.repository.getPushDestination(f.env)).message!, /local push/);
  for (const key of ['branch.main.pushRemote', 'remote.pushDefault', 'branch.main.remote']) await f.git('config', '--unset', key);
  for (const remote of ['origin', 'fetch', 'push']) await f.git('remote', 'remove', remote);
  assert.equal(await selected(), 'branchpush');
  await f.git('remote', 'add', 'another', 'git@another.test:acme/repo.git');
  assert.match((await f.repository.getPushDestination(f.env)).message!, /no configured/);
  // An unborn branch can still have a destination; HEAD/refspec readiness is a separate concern.
  await f.git('config', 'remote.pushDefault', 'branchpush');
  assert.equal(await selected(), 'branchpush');
});

test('Git performs push URL rewriting including explicit pushurl interaction and every target', async (t) => {
  const f = await fixture(t);
  await f.git('remote', 'add', 'origin', 'https://fetch.test/acme/repo.git');
  await f.git('config', 'url.git@push.test:.pushInsteadOf', 'https://fetch.test/');
  assert.equal((await f.repository.getPushDestination(f.env)).targets[0].url, 'git@push.test:acme/repo.git');
  await f.git('config', 'remote.origin.pushurl', 'https://fetch.test/explicit/repo.git');
  assert.equal((await f.repository.getPushDestination(f.env)).targets[0].protocol, 'https');
  await f.git('config', 'url.ssh://alice@rewrite.test:2222/.insteadOf', 'https://fetch.test/');
  await f.git('config', '--add', 'remote.origin.pushurl', 'git@second.test:acme/repo.git');
  const actual = await f.repository.getPushDestination(f.env);
  const oracle = await f.git('remote', 'get-url', '--push', '--all', 'origin');
  assert.deepEqual(actual.targets.map((target) => target.url), oracle.stdout.trim().split('\n'));
  assert.equal(actual.targets.length, 2);
});

test('status and doctor verify push hosts, not fetch hosts, and aggregate every endpoint', async (t) => {
  const f = await fixture(t);
  await f.git('remote', 'add', 'origin', 'git@work.test:acme/repo.git');
  await f.git('config', 'remote.origin.pushurl', 'git@personal.test:acme/repo.git');
  let status = await getStatus(f.dependencies);
  assert.equal(status.auth, 'warn'); assert.equal(status.remote, 'warn'); assert.equal(status.overall, 'warning');
  assert.deepEqual(f.calls.map((call) => call.host), ['personal.test']);
  const result = await doctor(f.dependencies);
  assert.equal(result.repository.fetchRemote?.host, 'work.test');
  assert.equal(result.repository.remote?.host, 'personal.test');
  assert.equal(result.repository.push?.targets.length, 1);
  await f.git('config', 'remote.origin.pushurl', 'git@work.test:acme/repo.git');
  await f.git('config', '--add', 'remote.origin.pushurl', 'git@personal.test:acme/repo.git');
  f.calls.length = 0;
  status = await getStatus(f.dependencies);
  assert.equal(status.auth, 'warn'); assert.deepEqual(f.calls.map((call) => call.host), ['work.test', 'personal.test']);
  await f.git('config', '--add', 'remote.origin.pushurl', 'file:///unsupported/repo.git');
  status = await getStatus(f.dependencies); assert.equal(status.auth, 'warn');
  assert.equal((await doctor(f.dependencies)).overall, 'warning');
});

test('offline invokes zero SSH, including inspection, while preserving destination warnings', async (t) => {
  const f = await fixture(t);
  await f.git('remote', 'add', 'origin', 'git@work.test:acme/repo.git');
  await f.git('config', '--add', 'remote.origin.pushurl', 'git@work.test:other/repo.git');
  f.dependencies.sshAuthProbe.probeGithubUser = async () => { throw new Error('forbidden SSH attempt'); };
  const status = await getStatus(f.dependencies, { offline: true });
  assert.equal(status.auth, 'na'); assert.equal(status.remote, 'ok'); assert.equal(f.calls.length, 0);
  await f.git('remote', 'remove', 'origin');
  const missing = await getStatus(f.dependencies, { offline: true });
  assert.equal(missing.auth, 'na'); assert.equal(missing.remote, 'warn');
});

test('custom commands and variants fail closed without executing a wrapper; precedence is safe', async (t) => {
  const f = await fixture(t);
  await f.git('remote', 'add', 'origin', 'git@work.test:acme/repo.git');
  f.dependencies.sshAuthProbe.probeGithubUser = async () => { throw new Error('unsupported transport executed'); };
  for (const key of ['GIT_SSH_COMMAND', 'GIT_SSH']) {
    f.env[key] = '/never-execute-wrapper --secret';
    assert.equal((await getStatus(f.dependencies)).auth, 'warn'); delete f.env[key];
  }
  await f.git('config', 'core.sshCommand', 'wrapper -i unknown');
  f.env.GIT_SSH_COMMAND = 'higher-priority wrapper';
  assert.equal((await getStatus(f.dependencies)).auth, 'warn'); delete f.env.GIT_SSH_COMMAND;
  assert.equal((await getStatus(f.dependencies)).auth, 'warn');
  await f.git('config', '--unset', 'core.sshCommand');
  await f.git('config', 'ssh.variant', '');
  assert.equal((await getStatus(f.dependencies)).auth, 'warn');
  await f.git('config', 'ssh.variant', 'plink');
  assert.equal((await getStatus(f.dependencies)).auth, 'warn');
  f.env.GIT_SSH_VARIANT = 'ssh';
  assert.equal((await f.repository.getPushDestination(f.env)).transport.supported, true);
  delete f.env.GIT_SSH_VARIANT;
  await f.git('config', '--unset', 'ssh.variant');
  await f.git('config', 'remote.origin.receivepack', '');
  assert.equal((await getStatus(f.dependencies)).auth, 'warn');
  await f.git('config', 'remote.origin.receivepack', 'custom-receive');
  assert.equal((await getStatus(f.dependencies)).auth, 'warn');
});

test('included configuration affects effective push target and malformed Git configuration propagates', async (t) => {
  const f = await fixture(t);
  await f.git('remote', 'add', 'origin', 'git@work.test:acme/repo.git');
  await f.git('remote', 'add', 'personal', 'git@personal.test:acme/repo.git');
  const include = path.join(f.root, 'included');
  await writeFile(include, '[remote]\n pushDefault = personal\n');
  await f.git('config', 'include.path', include);
  assert.equal((await f.repository.getPushDestination(f.env)).remoteName, 'personal');
  await writeFile(include, '[invalid');
  await assert.rejects(() => f.repository.getPushDestination(f.env), /bad config/);
});

test('SSH URL parsing preserves Git user, port and raw path semantics', () => {
  const target = parseRemoteUrl('push', 'ssh://alice@host.test:2222/acme/../%72epo.git');
  assert.equal(target.host, 'host.test'); assert.equal(target.user, 'alice'); assert.equal(target.port, 2222);
  assert.equal(target.path, '/acme/../repo.git');
  assert.equal(parseRemoteUrl('push', 'file:///repo.git').protocol, 'unknown');
  assert.equal(parseRemoteUrl('push', 'ssh://alice:password@host.test/acme/repo.git').protocol, 'unknown');
});

test('mixed verified SSH and pinned HTTPS never aggregate auth=ok in either endpoint order', async (t) => {
  const f = await fixture(t);
  await f.git('remote', 'add', 'origin', 'git@work.test:acme/repo.git');
  await writeFile(path.join(f.repo, '.gitrole'), JSON.stringify({ version: 1, defaultRole: 'work', allowedRoles: ['work'] }));
  const ssh = 'git@work.test:acme/repo.git'; const https = 'https://work.test/acme/repo.git';
  for (const urls of [[ssh, https], [https, ssh]]) {
    await f.git('config', '--unset-all', 'remote.origin.pushurl').catch(() => {});
    for (const url of urls) await f.git('config', '--add', 'remote.origin.pushurl', url);
    const status = await getStatus(f.dependencies);
    assert.equal(status.auth, 'warn'); assert.equal(status.overall, 'warning');
    assert.equal(status.policy, 'ok'); assert.equal(status.remote, 'ok');
    const diagnosis = await doctor(f.dependencies);
    assert.equal(diagnosis.overall, 'warning');
    assert.ok(diagnosis.checks.some((check) => check.label === 'auth' && check.status === 'warn' && check.message.includes('mixed SSH and HTTPS')));
    assert.equal((await getStatus(f.dependencies, { offline: true })).auth, 'na');
  }
  await f.git('config', '--unset-all', 'remote.origin.pushurl');
  await f.git('config', 'remote.origin.pushurl', ssh);
  assert.equal((await getStatus(f.dependencies)).auth, 'ok');
  await f.git('config', 'remote.origin.pushurl', https);
  // Pure HTTPS and offline semantics are deliberately not changed by this bounded correction.
  assert.equal((await getStatus(f.dependencies)).auth, 'na');
  assert.equal((await getStatus(f.dependencies, { offline: true })).auth, 'na');
});


test('no-upstream current push and detached destination remain separate from refspec readiness', async (t) => {
  const f = await fixture(t);
  const bare = path.join(f.root, 'remote.git');
  await f.git('init', '--bare', '-q', bare);
  await f.git('-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'fixture');
  await f.git('remote', 'add', 'sole', bare);
  assert.equal((await f.repository.getPushDestination(f.env)).remoteName, 'sole');
  assert.match((await f.git('push', '--dry-run')).stderr, /main/);
  await f.git('config', 'push.autoSetupRemote', 'true');
  assert.equal((await f.repository.getPushDestination(f.env)).remoteName, 'sole');
  await f.git('checkout', '--detach', '-q');
  assert.equal((await f.repository.getPushDestination(f.env)).remoteName, 'sole');
  await assert.rejects(() => f.git('push', '--dry-run'), /not currently on a branch/);
});

test('offline retains HTTPS pin checks in mixed endpoints and roleless diagnosis sees later targets', async (t) => {
  const f = await fixture(t);
  await f.git('remote', 'add', 'origin', 'git@work.test:acme/repo.git');
  await f.git('config', '--add', 'remote.origin.pushurl', 'git@work.test:acme/repo.git');
  await f.git('config', '--add', 'remote.origin.pushurl', 'https://work.test/acme/repo.git');
  f.dependencies.sshAuthProbe.probeGithubUser = async () => { throw new Error('offline SSH forbidden'); };
  assert.equal((await getStatus(f.dependencies, { offline: true })).auth, 'warn');
  await writeFile(path.join(f.repo, '.gitrole'), JSON.stringify({ version: 1, defaultRole: 'work', allowedRoles: ['work'] }));
  assert.equal((await getStatus(f.dependencies, { offline: true })).auth, 'na');
  await f.git('config', 'user.email', 'unmatched@example.test');
  f.dependencies.sshAuthProbe.probeGithubUser = async (host) => ({ ok: true, host, githubUser: 'work' });
  const result = await doctor(f.dependencies);
  assert.ok(result.checks.some((check) => check.label === 'auth' && check.status === 'warn' && check.message.includes('HTTPS')));
  assert.equal(result.repository.push?.targets.length, 2);
});


test('present empty default remote settings refuse fallback exactly as Git does', async (t) => {
  const f = await fixture(t);
  const bare = path.join(f.root, 'remote.git');
  await f.git('init', '--bare', '-q', bare);
  await f.git('remote', 'add', 'origin', bare);
  await f.git('-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'fixture');
  for (const key of ['branch.main.pushRemote', 'remote.pushDefault', 'branch.main.remote']) {
    await f.git('config', key, '');
    const destination = await f.repository.getPushDestination(f.env);
    assert.equal(destination.targets.length, 0, key);
    assert.match(destination.message!, /no configured/, key);
    await assert.rejects(() => f.git('push', '--dry-run'), /No configured push destination|no path specified/);
    await f.git('config', '--unset', key);
  }
});

test('push URL framing rejects configured newlines and preserves endpoint whitespace', async (t) => {
  const f = await fixture(t);
  await f.git('remote', 'add', 'origin', 'git@work.test:acme/repo.git');
  for (const url of ['ssh://git@work.test/acme/repo.git\n', 'git@work.test:acme/repo.git\nsecond.test:other/repo.git']) {
    await f.git('config', 'remote.origin.pushurl', url);
    const destination = await f.repository.getPushDestination(f.env);
    assert.equal(destination.targets.length, 0);
    assert.match(destination.message!, /framing/);
    f.calls.length = 0;
    assert.equal((await getStatus(f.dependencies)).overall, 'warning');
    assert.equal(f.calls.length, 0);
  }
  const url = 'git@work.test:acme/repo.git ';
  await f.git('config', 'remote.origin.pushurl', url);
  assert.equal((await f.repository.getPushDestination(f.env)).targets[0].url, url);
});

test('Git-specific SSH URL boundary values cannot qualify a different context', () => {
  for (const url of ['SSH://git@host.test/acme/repo.git', 'HTTPS://host.test/acme/repo.git', 'ssh://git@host.test:0/acme/repo.git', 'ssh://git@host.test/acme/repo.git\n', 'ssh://git@host.test/acme/repo.git%0a']) {
    assert.equal(parseRemoteUrl('push', url).protocol, 'unknown', url);
  }
  assert.equal(parseRemoteUrl('push', 'ssh://host.test/~repo').path, '~repo');
  assert.equal(parseRemoteUrl('push', 'ssh://host.test/~user/repo.git').path, '~user/repo.git');
  assert.equal(parseRemoteUrl('push', 'ssh://%61lice@Host.TEST/acme/repo.git').host, 'Host.TEST');
  assert.equal(parseRemoteUrl('push', 'ssh://%61lice@Host.TEST/acme/repo.git').user, 'alice');
});


test('a configured remote beginning with an option is queried literally', async (t) => {
  const f = await fixture(t);
  const bare = path.join(f.root, 'remote.git');
  await f.git('init', '--bare', '-q', bare);
  await f.git('config', 'remote.-push.url', bare);
  await f.git('config', 'remote.pushDefault', '-push');
  await f.git('-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'fixture');
  assert.equal((await f.repository.getPushDestination(f.env)).remoteName, '-push');
  assert.match((await f.git('push', '--dry-run')).stderr, /main/);
});

test('insteadOf, pushInsteadOf, and pushurl use the URL Git pushes', async (t) => {
  const f = await fixture(t);
  await f.git('remote', 'add', 'origin', 'https://fetch.test/acme/repo.git');
  await f.git('remote', 'set-url', '--add', 'origin', 'https://other.test/two.git');
  await f.git('config', 'url.ssh://mirror.test/.insteadOf', 'https://fetch.test/');
  let destination = await f.repository.getPushDestination(f.env);
  assert.deepEqual(destination.targets.map((target) => target.url), [
    'ssh://mirror.test/acme/repo.git',
    'https://other.test/two.git'
  ]);
  await f.git('remote', 'remove', 'origin');
  await f.git('config', '--unset', 'url.ssh://mirror.test/.insteadOf');
  await f.git('remote', 'add', 'origin', 'https://fetch.test/acme/repo.git');
  await f.git('config', 'url.ssh://short.test/.insteadOf', 'https://fetch.test/');
  await f.git('config', 'url.ssh://long.test/acme/.insteadOf', 'https://fetch.test/acme/');
  destination = await f.repository.getPushDestination(f.env);
  assert.deepEqual(destination.targets.map((target) => target.url), ['ssh://long.test/acme/repo.git']);
  await f.git('config', 'url.git@push.test:.pushInsteadOf', 'https://fetch.test/');
  destination = await f.repository.getPushDestination(f.env);
  assert.deepEqual(destination.targets.map((target) => target.url), ['git@push.test:acme/repo.git']);
  assert.equal(destination.targets[0].protocol, 'ssh');
  assert.equal(destination.targets[0].host, 'push.test');
  await f.git('config', 'remote.origin.pushurl', 'https://fetch.test/explicit/repo.git');
  destination = await f.repository.getPushDestination(f.env);
  assert.deepEqual(destination.targets.map((target) => target.url), ['ssh://short.test/explicit/repo.git']);
  assert.equal(destination.targets[0].protocol, 'ssh');
  await f.git('config', '--add', 'remote.origin.pushurl', 'git@second.test:acme/repo.git');
  destination = await f.repository.getPushDestination(f.env);
  assert.deepEqual(destination.targets.map((target) => target.url), [
    'ssh://short.test/explicit/repo.git',
    'git@second.test:acme/repo.git'
  ]);
  const diagnosis = await doctor(f.dependencies);
  assert.equal(diagnosis.repository.push?.targets[0].remote.url, 'ssh://short.test/explicit/repo.git');
  assert.equal(diagnosis.repository.push?.targets[1].remote.url, 'git@second.test:acme/repo.git');
  assert.deepEqual(f.calls.map((call) => call.host), ['short.test', 'second.test']);
});

test('pushInsteadOf that matches only some fetch URLs is the push destination', async (t) => {
  const f = await fixture(t);
  const bare = path.join(f.root, 'bare.git');
  await f.git('init', '--bare', '-q', bare);
  await f.git('remote', 'add', 'origin', 'https://fetch.test/one.git');
  await f.git('remote', 'set-url', '--add', 'origin', 'git@other.test:two.git');
  await f.git('config', `url.${bare}.pushInsteadOf`, 'https://fetch.test/one.git');
  const destination = await f.repository.getPushDestination(f.env);
  assert.equal(destination.message, undefined);
  assert.equal(destination.remoteName, 'origin');
  assert.deepEqual(destination.targets.map((target) => target.url), [bare]);
  const diagnosis = await doctor(f.dependencies);
  assert.equal(
    diagnosis.checks.find((check) => check.label === 'remote' && check.status === 'info')?.message,
    `default push remote origin uses unknown at ${bare}`
  );
  assert.equal(f.calls.length, 0);
  await f.git('-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'fixture');
  const hookPath = path.join(f.repo, '.git/hooks/pre-push');
  await writeFile(hookPath, '#!/bin/sh\nprintf \'%s\\n\' "$2"\nexit 0\n');
  await chmod(hookPath, 0o755);
  const pushed = await f.git('push', '--dry-run', 'origin', 'HEAD:refs/heads/main');
  assert.equal(pushed.stdout.trim(), bare);
});

test('an scp URL configured as the push destination is checked as that URL', async (t) => {
  const f = await fixture(t);
  await f.git('remote', 'add', 'gitrole-push-probe', 'git@probe.test:acme/repo.git');
  await f.git('config', 'branch.main.pushRemote', 'git@github.com:owner/repo.git');
  const destination = await f.repository.getPushDestination(f.env);
  assert.equal(destination.remoteName, 'git@github.com:owner/repo.git');
  assert.equal(destination.message, undefined);
  assert.equal(destination.targets.length, 1);
  assert.equal(destination.targets[0].url, 'git@github.com:owner/repo.git');
  assert.equal(destination.targets[0].protocol, 'ssh');
  assert.equal(destination.targets[0].host, 'github.com');
  assert.equal(destination.targets[0].user, 'git');
  assert.equal(destination.targets[0].owner, 'owner');
  assert.equal(destination.targets[0].repository, 'repo');
  const diagnosis = await doctor(f.dependencies);
  assert.equal(
    diagnosis.checks.find((check) => check.label === 'remote' && check.status === 'info')?.message,
    'default push remote git@github.com:owner/repo.git uses ssh at git@github.com:owner/repo.git'
  );
  assert.deepEqual(f.calls.map((call) => call.host), ['github.com']);
  assert.equal((await f.git('remote')).stdout, 'gitrole-push-probe\n');
});

test('an https URL push destination keeps the HTTPS pin check', async (t) => {
  const f = await fixture(t);
  await f.git('config', 'branch.main.pushRemote', 'https://github.com/owner/repo.git');
  let diagnosis = await doctor(f.dependencies);
  assert.equal(
    diagnosis.checks.find((check) => check.label === 'auth')?.message,
    'push destination uses HTTPS and no repo pin is configured'
  );
  assert.equal(diagnosis.repository.push?.targets[0].remote.url, 'https://github.com/owner/repo.git');
  assert.equal(diagnosis.repository.push?.targets[0].remote.protocol, 'https');
  assert.equal(f.calls.length, 0);
  await f.git('config', 'branch.main.pushRemote', 'https://work.test/acme/repo.git');
  await writeFile(path.join(f.repo, '.gitrole'), JSON.stringify({ version: 1, defaultRole: 'work', allowedRoles: ['work'] }));
  const status = await getStatus(f.dependencies);
  assert.equal(
    renderShortStatus(status),
    'role=work scope=local override=true commit=ok remote=ok auth=na policy=ok overall=aligned'
  );
  diagnosis = await doctor(f.dependencies);
  assert.equal(
    diagnosis.checks.find((check) => check.label === 'auth')?.message,
    'push destination uses HTTPS; SSH auth verification does not apply'
  );
});

test('a relative path push destination is the path Git pushes to', async (t) => {
  const f = await fixture(t);
  const other = path.join(f.root, 'other-repo');
  await f.git('init', '--bare', '-q', other);
  await f.git('config', 'branch.main.pushRemote', '../other-repo');
  const destination = await f.repository.getPushDestination(f.env);
  assert.equal(destination.message, undefined);
  assert.deepEqual(destination.targets.map((target) => target.url), ['../other-repo']);
  assert.equal(destination.targets[0].protocol, 'unknown');
  const diagnosis = await doctor(f.dependencies);
  assert.equal(
    diagnosis.checks.find((check) => check.label === 'remote' && check.status === 'info')?.message,
    'default push remote ../other-repo uses unknown at ../other-repo'
  );
  assert.equal(
    diagnosis.checks.find((check) => check.label === 'auth')?.message,
    'push transport is unsupported; authentication is unverified'
  );
  assert.equal(f.calls.length, 0);
  await f.git('-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'fixture');
  const hookPath = path.join(f.repo, '.git/hooks/pre-push');
  await writeFile(hookPath, '#!/bin/sh\nprintf \'%s\\n\' "$2"\nexit 0\n');
  await chmod(hookPath, 0o755);
  const pushed = await f.git('push', '--dry-run');
  assert.equal(pushed.stdout.trim(), '../other-repo');
});

test('an absolute path push destination is the path Git pushes to', async (t) => {
  const f = await fixture(t);
  const other = path.join(f.root, 'other repo.git');
  await f.git('init', '--bare', '-q', other);
  await f.git('config', 'branch.main.remote', other);
  await f.git('remote', 'add', 'origin', 'git@work.test:acme/repo.git');
  const destination = await f.repository.getPushDestination(f.env);
  assert.equal(destination.remoteName, other);
  assert.equal(destination.message, undefined);
  assert.deepEqual(destination.targets.map((target) => target.url), [other]);
  assert.equal(destination.targets[0].protocol, 'unknown');
  assert.equal(f.calls.length, 0);
  await f.git('-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'fixture');
  const hookPath = path.join(f.repo, '.git/hooks/pre-push');
  await writeFile(hookPath, '#!/bin/sh\nprintf \'%s\\n\' "$2"\nexit 0\n');
  await chmod(hookPath, 0o755);
  const pushed = await f.git('push', '--dry-run');
  assert.equal(pushed.stdout.trim(), other);
});

test('a URL push destination is rewritten with pushInsteadOf and the longest insteadOf', async (t) => {
  const f = await fixture(t);
  const bare = path.join(f.root, 'bare.git');
  await f.git('init', '--bare', '-q', bare);
  await f.git('config', `url.${bare}.pushInsteadOf`, 'https://fetch.test/acme/repo.git');
  await f.git('config', 'url.ssh://long.test/acme/.insteadOf', 'https://fetch.test/acme/');
  await f.git('config', 'url.ssh://short.test/.insteadOf', 'https://fetch.test/');
  await f.git('config', 'remote.pushDefault', 'https://fetch.test/acme/repo.git');
  let destination = await f.repository.getPushDestination(f.env);
  assert.deepEqual(destination.targets.map((target) => target.url), [bare]);
  assert.equal(f.calls.length, 0);
  await f.git('config', '--unset', `url.${bare}.pushInsteadOf`);
  f.calls.length = 0;
  destination = await f.repository.getPushDestination(f.env);
  assert.deepEqual(destination.targets.map((target) => target.url), ['ssh://long.test/acme/repo.git']);
  assert.equal(destination.targets[0].protocol, 'ssh');
  assert.equal(destination.targets[0].host, 'long.test');
  const status = await getStatus(f.dependencies, { offline: true });
  assert.equal(f.calls.length, 0);
  assert.equal(status.auth, 'na');
  assert.equal(status.remote, 'warn');
  const diagnosis = await doctor(f.dependencies);
  assert.deepEqual(f.calls.map((call) => call.host), ['long.test']);
  assert.equal(
    diagnosis.checks.find((check) => check.label === 'remote' && check.status === 'info')?.message,
    'default push remote https://fetch.test/acme/repo.git uses ssh at ssh://long.test/acme/repo.git'
  );
});

test('a named remote push destination is unchanged by URL and path resolution', async (t) => {
  const f = await fixture(t);
  await f.git('remote', 'add', 'origin', 'git@work.test:acme/repo.git');
  const destination = await f.repository.getPushDestination(f.env);
  assert.equal(destination.remoteName, 'origin');
  assert.equal(destination.message, undefined);
  assert.deepEqual(destination.targets.map((target) => target.url), ['git@work.test:acme/repo.git']);
  assert.equal(destination.targets[0].host, 'work.test');
  const status = await getStatus(f.dependencies, { offline: true });
  assert.equal(
    renderShortStatus(status),
    'role=work scope=local override=true commit=ok remote=ok auth=na policy=na overall=aligned'
  );
  assert.equal(f.calls.length, 0);
  assert.equal((await f.git('remote')).stdout, 'origin\n');
});

for (const remoteName of [' push', 'push ']) {
  test(`real Git preserves remote name whitespace: ${JSON.stringify(remoteName)}`, async (t) => {
    const f = await fixture(t);
    const bare = path.join(f.root, 'remote.git');
    await f.git('init', '--bare', '-q', bare);
    await f.git('-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'fixture');
    // Git config can contain names rejected by remote add; native push still resolves them.
    await f.git('config', `remote.${remoteName}.url`, bare);
    for (const configured of [false, true]) {
      if (configured) await f.git('config', 'branch.main.pushRemote', remoteName);
      const destination = await f.repository.getPushDestination(f.env);
      assert.equal(destination.remoteName, remoteName);
      assert.deepEqual(destination.targets.map((target) => target.url), [bare]);
      assert.match((await f.git('push', '--dry-run')).stderr, /main/);
    }
  });
}

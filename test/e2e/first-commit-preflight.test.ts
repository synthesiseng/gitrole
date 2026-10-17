/*
 * Exercises the packaged local commit workflow separately from unchanged status/doctor contracts.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { type HermeticWorkspace, createHermeticWorkspace, initRepo, mustSucceed, runCli, runGit, saveRole, setOrigin, useRole } from './harness.js';

test('fresh repository status and doctor retain their combined diagnostic contracts', async (t) => {
  const w = await createHermeticWorkspace();
  t.after(() => rm(w.rootDir, { recursive: true, force: true }));
  for (const key of Object.keys(w.env)) if (key.startsWith('GIT_')) delete w.env[key];
  w.env.GIT_CONFIG_NOSYSTEM = '1';
  w.env.GIT_CONFIG_GLOBAL = path.join(w.rootDir, 'global');
  await initRepo(w);
  await saveRole(w, { name: 'work', fullName: 'Elena', email: 'elena@example.test', githubUser: 'elena' });
  mustSucceed(useRole(w, 'work', 'local'), 'explicit local role');
  setOrigin(w, 'https://example.test/elena/tool.git');
  mustSucceed(runCli(w, ['pin', 'work']), 'HTTPS identity pin');
  const before = await readFile(path.join(w.repoDir, '.git/config'));
  const status = runCli(w, ['status', '--short']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.stdout.trim(), 'role=work scope=local override=true commit=ok remote=ok auth=na policy=ok overall=aligned');
  const doctor = runCli(w, ['doctor', '--json']);
  assert.equal(doctor.status, 2, doctor.stderr);
  const diagnosis = JSON.parse(doctor.stdout);
  assert.equal(diagnosis.overall, 'warning');
  assert.deepEqual(diagnosis.checks.filter((check: { status: string }) => check.status === 'warn').map((check: { label: string }) => check.label), ['history']);
  assert.deepEqual(await readFile(path.join(w.repoDir, '.git/config')), before);

  for (const env of [{ GIT_AUTHOR_EMAIL: 'other@example.test' }, { GIT_COMMITTER_EMAIL: 'other@example.test' }]) {
    const warning = runCli(w, ['status', '--short'], { env });
    assert.equal(warning.status, 2);
    assert.match(warning.stdout, /commit=warn/);
    assert.match(warning.stdout, /overall=warning/);
  }
  const pinPath = path.join(w.repoDir, '.gitrole');
  const pin = await readFile(pinPath);
  await rm(pinPath);
  const noPin = runCli(w, ['status', '--short']);
  assert.equal(noPin.status, 2);
  assert.match(noPin.stdout, /auth=warn/);
  await writeFile(pinPath, 'invalid policy\n');
  const badPolicy = runCli(w, ['status', '--short']);
  assert.equal(badPolicy.status, 1);
  assert.equal(badPolicy.stdout, '');
  assert.ok(badPolicy.stderr);
  await writeFile(pinPath, pin);
  await saveRole(w, { name: 'other', fullName: 'Other', email: 'other@example.test', githubUser: 'other' });
  await rm(pinPath);
  mustSucceed(runCli(w, ['pin', 'other']), 'different valid policy');
  const wrongPolicy = runCli(w, ['status', '--short']);
  assert.equal(wrongPolicy.status, 2);
  assert.match(wrongPolicy.stdout, /policy=warn/);
  await writeFile(pinPath, pin);

  const recheck = runCli(w, ['status', '--short']);
  assert.equal(recheck.status, 0);
  mustSucceed(runGit(w, ['commit', '--allow-empty', '-m', 'First fixture commit']), 'first commit');
  const identity = runGit(w, ['show', '-s', '--format=%an <%ae>%n%cn <%ce>', 'HEAD']);
  assert.equal(identity.stdout.trim(), 'Elena <elena@example.test>\nElena <elena@example.test>');
  const after = runCli(w, ['doctor', '--json']);
  assert.equal(after.status, 0, after.stdout + after.stderr);
  assert.equal(JSON.parse(after.stdout).overall, 'aligned');
});


// Exercise the actual command selected by the skill, not a second hard-coded gate.
async function agentFixture(t: TestContext): Promise<HermeticWorkspace> {
  const w = await createHermeticWorkspace();
  t.after(() => rm(w.rootDir, { recursive: true, force: true }));
  for (const key of Object.keys(w.env)) {
    if (key.startsWith('GIT_') || key.startsWith('GITROLE_') || key === 'EMAIL') delete w.env[key];
  }
  Object.assign(w.env, {
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(w.rootDir, 'global'),
    GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: '', GIT_NO_LAZY_FETCH: '1'
  });
  await writeFile(w.env.GIT_CONFIG_GLOBAL!, '[user]\nuseConfigOnly = true\n[commit]\ngpgsign = false\n');
  const marker = path.join(w.rootDir, 'external-attempt');
  // These guards cover SSH, agent/Keychain helpers and common HTTP transports.
  // Qualification can additionally deny networking at the OS boundary.
  const sentinel = `#!/bin/sh\nprintf '%s\n' "$0 $*" >> '${marker}'\nexit 97\n`;
  for (const name of ['ssh', 'ssh-add', 'security', 'curl', 'wget', 'git-remote-http', 'git-remote-https']) {
    const file = path.join(w.rootDir, name);
    await writeFile(file, sentinel); await chmod(file, 0o755);
  }
  await initRepo(w);
  await saveRole(w, { name: 'work', fullName: 'Elena', email: 'elena@example.test' });
  // Fixture setup writes only the disposable repo; do not run identity switching.
  mustSucceed(runGit(w, ['config', 'user.name', 'Elena']), 'fixture name');
  mustSucceed(runGit(w, ['config', 'user.email', 'elena@example.test']), 'fixture email');
  mustSucceed(runGit(w, ['config', 'core.hooksPath', path.join(w.rootDir, 'no-hooks')]), 'isolate hooks');
  return w;
}

async function agentGate(w: HermeticWorkspace, expected: number, env: NodeJS.ProcessEnv = {}) {
  const skill = await readFile(path.resolve('skills/gitrole/SKILL.md'), 'utf8');
  const section = skill.split('## Ordinary commits')[1]?.split('\n## ')[0];
  const command = section?.match(/```bash\n(gitrole [^\n]+)\n```/);
  assert.ok(command, 'skill must prescribe an ordinary commit command');
  const result = runCli(w, command[1].split(' ').slice(1), { env });
  assert.equal(result.status, expected, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
  if (expected === 0) assert.equal(result.stderr, '');
  else assert.notEqual(result.stderr, '');
  return result;
}

for (const remote of [undefined, 'https://example.test/elena/tool.git', 'git@unverified.example.test:tool.git']) {
  test(`agent local commit flow succeeds with ${remote ?? 'no remote'} and leaves push warnings intact`, async (t) => {
    const w = await agentFixture(t);
    if (remote) setOrigin(w, remote);
    const config = await readFile(path.join(w.repoDir, '.git/config'));
    const rolesPath = path.join(w.configHome, 'gitrole/roles.json');
    const roles = await readFile(rolesPath);
    await agentGate(w, 0);
    const diagnosis = runCli(w, ['doctor', '--offline', '--json']);
    assert.equal(diagnosis.status, 2, diagnosis.stderr);
    const data = JSON.parse(diagnosis.stdout);
    assert.equal(data.overall, 'warning');
    assert.ok(data.checks.some((c: { label: string; status: string }) => c.label === 'history' && c.status === 'warn'));
    await agentGate(w, 0);
    mustSucceed(runGit(w, ['commit', '--allow-empty', '-m', 'Agent fixture commit']), 'authorized fixture commit');
    assert.equal(runGit(w, ['show', '-s', '--format=%an <%ae>|%cn <%ce>', 'HEAD']).stdout.trim(),
      'Elena <elena@example.test>|Elena <elena@example.test>');
    assert.deepEqual(await readFile(path.join(w.repoDir, '.git/config')), config);
    assert.deepEqual(await readFile(rolesPath), roles);
    await assert.rejects(readFile(path.join(w.repoDir, '.gitrole')), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(w.rootDir, 'external-attempt')), { code: 'ENOENT' });

    // Separate push observation still warns; SSH here is a failing synthetic command.
    const push = runCli(w, ['status', '--short']);
    assert.equal(push.status, 2, push.stderr);
    assert.match(push.stdout, /overall=warning/);
    if (!remote) assert.match(push.stdout, /remote=warn/);
    else assert.match(push.stdout, /auth=warn/);
    if (remote?.startsWith('git@')) {
      assert.match(await readFile(path.join(w.rootDir, 'external-attempt'), 'utf8'), /ssh.*-G/);
    }
  });
}

test('agent gate refuses identity/policy mismatches, missing usable identity and malformed data locally', async (t) => {
  const w = await agentFixture(t);
  await agentGate(w, 0);
  for (const env of [{ GIT_AUTHOR_EMAIL: 'other@example.test' }, { GIT_COMMITTER_NAME: 'Other' }]) {
    await agentGate(w, 2, env);
  }
  const policy = path.join(w.repoDir, '.gitrole');
  await writeFile(policy, JSON.stringify({ version: 1, defaultRole: 'other', allowedRoles: ['other'] }));
  await agentGate(w, 2);
  await writeFile(policy, '{'); await agentGate(w, 1); await rm(policy);
  const store = path.join(w.configHome, 'gitrole/roles.json');
  const original = await readFile(store);
  await rm(store); await agentGate(w, 2);
  await assert.rejects(readFile(store), { code: 'ENOENT' });
  await writeFile(store, '{'); await agentGate(w, 1);
  await writeFile(store, original);
  mustSucceed(runGit(w, ['config', '--unset', 'user.email']), 'remove fixture email');
  await agentGate(w, 2);
  assert.notEqual(runGit(w, ['rev-parse', '--verify', 'HEAD']).status, 0);
  const marker = path.join(w.rootDir, 'external-attempt');
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  // Positive controls prove every external-command guard is reachable and records attempts.
  for (const command of ['ssh', 'ssh-add', 'security', 'curl', 'wget', 'git-remote-http', 'git-remote-https']) {
    const attempted = spawnSync(command, ['fixture-positive-control'], { env: w.env, encoding: 'utf8' });
    assert.equal(attempted.status, 97);
    assert.ok((await readFile(marker, 'utf8')).includes(`${command} fixture-positive-control`));
  }
});

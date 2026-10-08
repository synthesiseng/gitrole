/*
 * Walks the packaged precommit guidance through a fresh repository and real first commit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHermeticWorkspace, initRepo, mustSucceed, runCli, runGit, saveRole, setOrigin, useRole } from './harness.js';

test('fresh repository uses status before the first commit without bypassing real warnings', async (t) => {
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

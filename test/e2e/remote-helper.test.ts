/*
 * Keeps Git remote-helper destinations unverified without running helpers or SSH.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHermeticWorkspace, initRepo, mustSucceed, runCli, runGit, saveRole, setOrigin, useRole } from './harness.js';

for (const mode of ['named', 'pushurl', 'direct', 'rewrite', 'mixed']) {
  test(`remote-helper ${mode} destination warns online and offline without transport execution`, async (t) => {
    const w = await createHermeticWorkspace();
    t.after(() => rm(w.rootDir, { recursive: true, force: true }));
    for (const key of Object.keys(w.env)) if (key.startsWith('GIT_')) delete w.env[key];
    w.env.GIT_CONFIG_NOSYSTEM = '1';
    w.env.GIT_CONFIG_GLOBAL = path.join(w.rootDir, 'global');
    w.env.LC_ALL = 'C'; w.env.LANG = 'C'; w.env.LANGUAGE = 'C';
    await initRepo(w);
    await saveRole(w, { name: 'work', fullName: 'Fixture', email: 'fixture@example.test', githubUser: 'fixture' });
    mustSucceed(useRole(w, 'work', 'local'), 'local role');
    mustSucceed(runCli(w, ['pin', 'work']), 'role pin');
    setOrigin(w, 'https://example.test/fixture/repo.git');
    // Valid commit and policy evidence ensure the regression cannot pass via an unrelated warning.
    const control = runCli(w, ['status', '--short', '--offline']);
    assert.equal(control.status, 0, control.stderr);
    assert.match(control.stdout, /commit=ok remote=ok auth=na policy=ok overall=aligned/);
    const helper = mode === 'named' ? 'ext::/bin/false' : 'helper::address';
    const helperName = helper.split('::')[0];
    const marker = path.join(w.rootDir, 'transport-calls');
    for (const name of ['ssh', 'git-remote-helper', 'git-remote-ext']) {
      const file = path.join(w.rootDir, name);
      await writeFile(file, '#!/bin/sh\nprintf "called\\n" >> "$TRANSPORT_MARKER"\nexit 99\n');
      await chmod(file, 0o755);
    }
    w.env.TRANSPORT_MARKER = marker;
    // Git's native dispatch oracle rejects the protocol before starting any helper.
    const oracle = runGit(w, ['ls-remote', helper], { env: { GIT_ALLOW_PROTOCOL: 'file' } });
    assert.notEqual(oracle.status, 0);
    assert.match(oracle.stderr, new RegExp(`transport '${helperName}' not allowed`));
    if (mode === 'named') mustSucceed(runGit(w, ['remote', 'set-url', 'origin', helper]), 'helper origin');
    if (mode === 'pushurl') mustSucceed(runGit(w, ['config', 'remote.origin.pushurl', helper]), 'helper pushurl');
    if (mode === 'direct') mustSucceed(runGit(w, ['config', 'branch.main.pushRemote', helper]), 'direct helper');
    if (mode === 'rewrite') {
      mustSucceed(runGit(w, ['config', `url.${helper}.pushInsteadOf`, 'alias:repo']), 'helper rewrite');
      mustSucceed(runGit(w, ['config', 'branch.main.pushRemote', 'alias:repo']), 'direct alias');
    }
    if (mode === 'mixed') {
      mustSucceed(runGit(w, ['config', '--add', 'remote.origin.pushurl', 'https://example.test/fixture/repo.git']), 'HTTPS pushurl');
      mustSucceed(runGit(w, ['config', '--add', 'remote.origin.pushurl', helper]), 'helper pushurl');
    }
    const before = await readFile(path.join(w.repoDir, '.git/config'));
    for (const offline of [true, false]) {
      const flags = offline ? ['--offline'] : [];
      const status = runCli(w, ['status', '--short', ...flags]);
      assert.equal(status.status, 2, status.stdout + status.stderr);
      assert.match(status.stdout, /commit=ok remote=warn/);
      assert.match(status.stdout, /policy=ok overall=warning/);
      assert.match(status.stdout, offline ? /auth=na/ : /auth=warn/);
      if (offline) continue; // doctor has no offline CLI mode.
      const doctor = runCli(w, ['doctor', '--json']);
      assert.equal(doctor.status, 2, doctor.stdout + doctor.stderr);
      const diagnosis = JSON.parse(doctor.stdout);
      assert.equal(diagnosis.overall, 'warning');
      assert.ok(diagnosis.repository.push.targets.some((target: { remote: { url: string; protocol: string } }) => target.remote.url === helper && target.remote.protocol === 'unknown'));
      assert.ok(diagnosis.checks.some((check: { status: string; label: string }) => check.status === 'warn' && check.label === 'auth'));
    }
    assert.deepEqual(await readFile(path.join(w.repoDir, '.git/config')), before);
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
  });
}

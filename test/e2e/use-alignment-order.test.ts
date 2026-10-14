/* Reproduces first-use feedback with stateful synthetic SSH executables and real Git. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createHermeticWorkspace, initRepo, commitEmpty, setOrigin, saveRole, runCli, runGit, mustSucceed } from './harness.js';

for (const scope of ['global', 'local'] as const) {
  test(`e2e use ${scope} reports the account observed after synthetic key loading`, async t => {
    const f = await createHermeticWorkspace();
    t.after(() => rm(f.rootDir, { recursive: true, force: true }));
    // Do not inherit Git overrides, personal agent sockets or executable substitutions.
    for (const key of Object.keys(f.env)) {
      if (/^(GIT_|SSH_|GITROLE_)/.test(key)) delete f.env[key];
    }
    Object.assign(f.env, { GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
      SSH_AUTH_SOCK: path.join(f.rootDir, 'absent-agent'), GITROLE_SSH_ADD_BIN: f.sshAddStubPath });
    await initRepo(f);
    commitEmpty(f, { message: 'synthetic history', name: 'Alex Developer', email: 'alex@work.example' });
    setOrigin(f, 'git@fixture.invalid:example/service.git');
    await saveRole(f, { name: 'work', fullName: 'Alex Developer', email: 'alex@work.example',
      sshKeyPath: '/fixture/work-key', githubUser: 'alex-dev', githubHost: 'fixture.invalid' });
    const state = path.join(f.rootDir, 'loaded');
    const trace = path.join(f.rootDir, 'trace');
    await writeFile(f.sshAddStubPath, `#!${process.execPath}
import fs from 'node:fs';
import assert from 'node:assert/strict';
assert.deepEqual(process.argv.slice(2), ['--', '/fixture/work-key']);
fs.appendFileSync(${JSON.stringify(trace)}, 'load\\n');
fs.writeFileSync(${JSON.stringify(state)}, 'loaded');
`);
    await writeFile(f.sshStubPath, `#!${process.execPath}
const fs = require('node:fs');
if (process.argv.includes('-G')) {
  console.log('hostname fixture.invalid\\nuser git\\nport 22\\nidentityfile /fixture/work-key\\nidentitiesonly yes\\nbatchmode yes\\npasswordauthentication no\\nkbdinteractiveauthentication no\\npubkeyauthentication yes\\npreferredauthentications publickey\\nremotecommand none');
} else {
  fs.appendFileSync(${JSON.stringify(trace)}, 'probe\\n');
  console.error(fs.existsSync(${JSON.stringify(state)})
    ? "Hi alex-dev! You've successfully authenticated, but GitHub does not provide shell access."
    : 'Permission denied (publickey).');
  process.exitCode = fs.existsSync(${JSON.stringify(state)}) ? 1 : 255;
}
`);
    const used = runCli(f, ['use', 'work', ...(scope === 'local' ? ['--local'] : [])]);
    mustSucceed(used, 'use failed');
    const status = runCli(f, ['status', '--short']);
    mustSucceed(status, 'immediate status failed');
    assert.equal(status.stdout, `role=work scope=${scope} override=${scope === 'local'} commit=ok remote=ok auth=ok policy=na overall=aligned\n`);
    assert.doesNotMatch(used.stdout, /repo note:/, `use should agree with immediate status: ${status.stdout}`);
    assert.equal(used.stderr, '');
    assert.equal(status.stderr, '');
    assert.equal(await readFile(trace, 'utf8'), 'load\nprobe\nprobe\n');
    for (const [key, expected] of [['user.name', 'Alex Developer'], ['user.email', 'alex@work.example']]) {
      const value = runGit(f, ['config', `--${scope}`, '--get', key]);
      mustSucceed(value, `missing ${key}`);
      assert.equal(value.stdout.trim(), expected);
    }
  });
}

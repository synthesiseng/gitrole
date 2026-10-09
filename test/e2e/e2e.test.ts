/*
 * Exercises representative end-to-end CLI workflows in hermetic repositories.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  freshRepoNoLocalRole,
  httpsNoIdentityPin,
  httpsPinAligned,
  httpsPinMismatch,
  sshAuthMatch,
  sshAuthMismatch,
  statusShortBaseline,
  statusShortPolicyOk,
  statusShortPolicyWarn
} from '../fixtures/status-short.js';
import {
  assertNoWarnChecks,
  commitEmpty,
  createHermeticWorkspace,
  getLocalConfigValue,
  getOriginUrl,
  initRepo,
  mustSucceed,
  parseJsonOutput,
  runCli,
  runGit,
  saveRole,
  setGlobalIdentity,
  setLocalIdentity,
  setOrigin,
  writeRepoPolicy
} from './harness.js';

test('e2e status --short is exact for an aligned local override on an org remote', async () => {
  const workspace = await createHermeticWorkspace({
    sshUsersByHost: {
      'github.com-acme-dev': 'alex-dev'
    }
  });

  await initRepo(workspace);
  setGlobalIdentity(workspace, {
    name: 'Pat Person',
    email: 'pat@personal.example'
  });
  commitEmpty(workspace, {
    message: 'feat: initial aligned work commit',
    name: 'Alex Developer',
    email: 'alex@work.example'
  });
  setOrigin(workspace, 'git@github.com-acme-dev:acme-corp/service.git');
  await saveRole(workspace, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'alex-dev',
    githubHost: 'github.com-acme-dev'
  });

  const useResult = runCli(workspace, ['use', 'work', '--local']);
  mustSucceed(useResult, 'gitrole use work --local failed');
  assert.match(useResult.stdout, /scope\s+local/);
  assert.doesNotMatch(useResult.stdout, /repo note:/);

  const statusResult = runCli(workspace, ['status', '--short']);
  mustSucceed(statusResult, 'gitrole status --short failed');
  assert.equal(statusResult.stdout.trim(), statusShortBaseline.line, statusShortBaseline.id);
  assert.equal(getLocalConfigValue(workspace, 'user.name'), 'Alex Developer');
  assert.equal(getLocalConfigValue(workspace, 'user.email'), 'alex@work.example');
});

test('e2e doctor --json keeps org ownership as context, not a warning', async () => {
  const workspace = await createHermeticWorkspace({
    sshUsersByHost: {
      'github.com-acme-dev': 'alex-dev'
    }
  });

  await initRepo(workspace);
  setGlobalIdentity(workspace, {
    name: 'Alex Developer',
    email: 'alex@work.example'
  });
  commitEmpty(workspace, {
    message: 'feat: org remote check'
  });
  setOrigin(workspace, 'git@github.com-acme-dev:acme-corp/service.git');
  await saveRole(workspace, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'alex-dev',
    githubHost: 'github.com-acme-dev'
  });

  const doctorResult = runCli(workspace, ['doctor', '--json']);
  mustSucceed(doctorResult, 'gitrole doctor --json failed');
  const parsed = JSON.parse(doctorResult.stdout) as {
    overall: string;
    repository: {
      remote?: {
        owner?: string;
        repository?: string;
      };
    };
    checks: Array<{ status: string; label: string }>;
  };

  assert.equal(parsed.overall, 'aligned');
  assert.equal(parsed.repository.remote?.owner, 'acme-corp');
  assert.equal(parsed.repository.remote?.repository, 'service');
  assertNoWarnChecks(parsed);
  assert.equal(parsed.checks.some((check) => check.label === 'owner'), false);
});

test('e2e https-pin-aligned: status and doctor reach aligned on an HTTPS origin', async () => {
  const workspace = await createHermeticWorkspace();

  await initRepo(workspace);
  setGlobalIdentity(workspace, {
    name: 'Pat Person',
    email: 'pat@personal.example'
  });
  await saveRole(workspace, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'alex-dev',
    githubHost: 'github.com'
  });
  mustSucceed(runCli(workspace, ['use', 'work', '--local']), 'gitrole use work --local failed');
  commitEmpty(workspace, {
    message: 'feat: https pin aligned'
  });
  setOrigin(workspace, 'https://github.com/acme-corp/service.git');
  mustSucceed(runCli(workspace, ['pin', 'work']), 'gitrole pin work failed');

  const statusResult = runCli(workspace, ['status', '--short']);
  mustSucceed(statusResult, `${httpsPinAligned.id}: gitrole status --short failed`);
  assert.equal(statusResult.stdout.trim(), httpsPinAligned.line, httpsPinAligned.id);

  const doctorResult = runCli(workspace, ['doctor', '--json']);
  mustSucceed(doctorResult, `${httpsPinAligned.id}: gitrole doctor --json failed`);
  const doctor = JSON.parse(doctorResult.stdout) as {
    overall: string;
    checks: Array<{ label: string; status: string; message: string }>;
  };

  assert.equal(doctor.overall, 'aligned');
  assert.equal(
    doctor.checks.some(
      (check) =>
        check.label === 'auth' &&
        check.status === 'info' &&
        check.message.includes('SSH auth verification does not apply')
    ),
    true
  );
  assertNoWarnChecks(doctor);
});

test('e2e https-no-identity-pin: HTTPS without an identity pin warns', async () => {
  const workspace = await createHermeticWorkspace();

  await initRepo(workspace);
  setGlobalIdentity(workspace, {
    name: 'Pat Person',
    email: 'pat@personal.example'
  });
  await saveRole(workspace, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example'
  });
  mustSucceed(runCli(workspace, ['use', 'work', '--local']), 'gitrole use work --local failed');
  commitEmpty(workspace, {
    message: 'feat: https no identity pin'
  });
  setOrigin(workspace, 'https://github.com/acme-corp/service.git');

  const statusResult = runCli(workspace, ['status', '--short']);
  assert.equal(statusResult.status, 2, statusResult.stderr);
  assert.equal(statusResult.stdout.trim(), httpsNoIdentityPin.line, httpsNoIdentityPin.id);

  const humanStatus = runCli(workspace, ['status']);
  assert.equal(humanStatus.status, 2, humanStatus.stderr);
  assert.match(humanStatus.stdout, /warning/);
  assert.match(humanStatus.stdout, /HTTPS \(no identity pin\)/);

  const doctorResult = runCli(workspace, ['doctor', '--json']);
  assert.equal(doctorResult.status, 2, doctorResult.stderr);
  const doctor = JSON.parse(doctorResult.stdout) as {
    overall: string;
    checks: Array<{ label: string; status: string; message: string }>;
  };
  const authCheck = doctor.checks.find((check) => check.label === 'auth');

  assert.equal(doctor.overall, 'warning');
  assert.equal(authCheck?.status, 'warn');
  assert.equal(authCheck?.message, httpsNoIdentityPin.doctorAuth);

  const doctorText = runCli(workspace, ['doctor']);
  assert.equal(doctorText.status, 2, doctorText.stderr);
  assert.match(doctorText.stdout, /warn auth\s+push destination uses HTTPS and no identity pin is configured/);
});

test('e2e https-pin-mismatch: HTTPS pin with the wrong github user warns', async () => {
  const workspace = await createHermeticWorkspace();

  await initRepo(workspace);
  setGlobalIdentity(workspace, {
    name: 'Pat Person',
    email: 'pat@personal.example'
  });
  await saveRole(workspace, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'alex-dev'
  });
  await saveRole(workspace, {
    name: 'personal',
    fullName: 'Pat Person',
    email: 'pat@personal.example',
    githubUser: 'thisyearearth'
  });
  mustSucceed(runCli(workspace, ['use', 'personal', '--local']), 'gitrole use personal --local failed');
  commitEmpty(workspace, {
    message: 'feat: https pin mismatch'
  });
  setOrigin(workspace, 'https://github.com/acme-corp/service.git');
  mustSucceed(runCli(workspace, ['pin', 'work']), 'gitrole pin work failed');

  const statusResult = runCli(workspace, ['status', '--short']);
  assert.equal(statusResult.status, 2, statusResult.stderr);
  assert.equal(statusResult.stdout.trim(), httpsPinMismatch.line, httpsPinMismatch.id);

  const humanStatus = runCli(workspace, ['status']);
  assert.equal(humanStatus.status, 2, humanStatus.stderr);
  assert.match(humanStatus.stdout, /warning/);
  assert.match(humanStatus.stdout, /HTTPS \(github user does not match pin\)/);

  const doctorResult = runCli(workspace, ['doctor', '--json']);
  assert.equal(doctorResult.status, 2, doctorResult.stderr);
  const doctor = JSON.parse(doctorResult.stdout) as {
    overall: string;
    checks: Array<{ label: string; status: string; message: string }>;
  };
  const authCheck = doctor.checks.find((check) => check.label === 'auth');

  assert.equal(doctor.overall, 'warning');
  assert.equal(authCheck?.status, 'warn');
  assert.equal(authCheck?.message, httpsPinMismatch.doctorAuth);

  const doctorText = runCli(workspace, ['doctor']);
  assert.equal(doctorText.status, 2, doctorText.stderr);
  assert.match(
    doctorText.stdout,
    /warn auth\s+push destination uses HTTPS; github user thisyearearth does not match pin alex-dev/
  );
});

test('e2e ssh-auth-match: SSH githubUser match stays auth=ok', async () => {
  const workspace = await createHermeticWorkspace({
    sshUsersByHost: {
      'github.com-acme-dev': 'alex-dev'
    }
  });

  await initRepo(workspace);
  setGlobalIdentity(workspace, {
    name: 'Alex Developer',
    email: 'alex@work.example'
  });
  await saveRole(workspace, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'alex-dev',
    githubHost: 'github.com-acme-dev'
  });
  commitEmpty(workspace, {
    message: 'feat: ssh auth match'
  });
  setOrigin(workspace, 'git@github.com-acme-dev:acme-corp/service.git');

  const statusResult = runCli(workspace, ['status', '--short']);
  mustSucceed(statusResult, `${sshAuthMatch.id}: gitrole status --short failed`);
  assert.equal(statusResult.stdout.trim(), sshAuthMatch.line, sshAuthMatch.id);

  const doctor = parseJsonOutput<{
    overall: string;
    checks: Array<{ label: string; status: string }>;
  }>(runCli(workspace, ['doctor', '--json']), `${sshAuthMatch.id}: gitrole doctor --json failed`);
  assert.equal(doctor.overall, 'aligned');
  assert.equal(
    doctor.checks.some((check) => check.label === 'auth' && check.status === 'ok'),
    true
  );
});

test('e2e ssh-auth-mismatch: SSH githubUser mismatch stays auth=warn', async () => {
  const workspace = await createHermeticWorkspace({
    sshUsersByHost: {
      'github.com-acme-dev': 'someone-else'
    }
  });

  await initRepo(workspace);
  setGlobalIdentity(workspace, {
    name: 'Alex Developer',
    email: 'alex@work.example'
  });
  await saveRole(workspace, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'alex-dev',
    githubHost: 'github.com-acme-dev'
  });
  commitEmpty(workspace, {
    message: 'feat: ssh auth mismatch'
  });
  setOrigin(workspace, 'git@github.com-acme-dev:acme-corp/service.git');

  const statusResult = runCli(workspace, ['status', '--short']);
  assert.equal(statusResult.status, 2, statusResult.stderr);
  assert.equal(statusResult.stdout.trim(), sshAuthMismatch.line, sshAuthMismatch.id);

  const doctorResult = runCli(workspace, ['doctor', '--json']);
  assert.equal(doctorResult.status, 2);
  const doctor = JSON.parse(doctorResult.stdout) as {
    overall: string;
    checks: Array<{ label: string; status: string; message: string }>;
  };
  assert.equal(doctor.overall, 'warning');
  assert.equal(
    doctor.checks.some(
      (check) =>
        check.label === 'auth' &&
        check.status === 'warn' &&
        check.message.includes('expected alex-dev')
    ),
    true
  );
});

test('e2e status-short-policy-warn: short line exposes a policy violation separately from auth', async () => {
  const workspace = await createHermeticWorkspace({
    sshUsersByHost: {
      'github.com-client-acme': 'acme-dev'
    }
  });

  await initRepo(workspace);
  setGlobalIdentity(workspace, {
    name: 'Pat Person',
    email: 'pat@personal.example'
  });
  await saveRole(workspace, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'alex-dev',
    githubHost: 'github.com-work'
  });
  await saveRole(workspace, {
    name: 'client-acme',
    fullName: 'Sara Loera',
    email: 'sara@consulting.example',
    githubUser: 'acme-dev',
    githubHost: 'github.com-client-acme'
  });
  mustSucceed(
    runCli(workspace, ['use', 'client-acme', '--local']),
    'gitrole use client-acme --local failed'
  );
  commitEmpty(workspace, {
    message: 'feat: policy violation'
  });
  setOrigin(workspace, 'git@github.com-client-acme:acme-platform/client-portal.git');
  await writeRepoPolicy(workspace, {
    defaultRole: 'work',
    allowedRoles: ['work']
  });

  const statusResult = runCli(workspace, ['status', '--short']);
  assert.equal(statusResult.status, 2, statusResult.stderr);
  assert.equal(statusResult.stdout.trim(), statusShortPolicyWarn.line, statusShortPolicyWarn.id);
  assert.match(statusResult.stdout, /auth=ok/);
  assert.match(statusResult.stdout, /policy=warn/);
  assert.match(statusResult.stdout, /overall=warning/);
});

test('e2e status-short-policy-ok: short line reports policy=ok when the pin allows the role', async () => {
  const workspace = await createHermeticWorkspace({
    sshUsersByHost: {
      'github.com-acme-dev': 'alex-dev'
    }
  });

  await initRepo(workspace);
  setGlobalIdentity(workspace, {
    name: 'Pat Person',
    email: 'pat@personal.example'
  });
  await saveRole(workspace, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'alex-dev',
    githubHost: 'github.com-acme-dev'
  });
  mustSucceed(runCli(workspace, ['use', 'work', '--local']), 'gitrole use work --local failed');
  commitEmpty(workspace, {
    message: 'feat: policy ok'
  });
  setOrigin(workspace, 'git@github.com-acme-dev:acme-corp/service.git');
  mustSucceed(runCli(workspace, ['pin', 'work']), 'gitrole pin work failed');

  const statusResult = runCli(workspace, ['status', '--short']);
  mustSucceed(statusResult, `${statusShortPolicyOk.id}: gitrole status --short failed`);
  assert.equal(statusResult.stdout.trim(), statusShortPolicyOk.line, statusShortPolicyOk.id);
});

test('e2e status --short warns when no default push destination exists', async () => {
  const workspace = await createHermeticWorkspace();

  await initRepo(workspace);
  setGlobalIdentity(workspace, {
    name: 'Alex Developer',
    email: 'alex@work.example'
  });
  commitEmpty(workspace, {
    message: 'feat: no origin configured'
  });
  await saveRole(workspace, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example'
  });

  const statusResult = runCli(workspace, ['status', '--short']);

  assert.equal(statusResult.status, 2);
  assert.equal(
    statusResult.stdout.trim(),
    'role=work scope=global override=false commit=ok remote=warn auth=warn policy=na overall=warning'
  );
});

test('e2e status --short warns on a new repo with no commits yet', async () => {
  const workspace = await createHermeticWorkspace({
    sshUsersByHost: {
      'github.com-acme-dev': 'alex-dev'
    }
  });

  await initRepo(workspace);
  setGlobalIdentity(workspace, {
    name: 'Alex Developer',
    email: 'alex@work.example'
  });
  setOrigin(workspace, 'git@github.com-acme-dev:acme-corp/service.git');
  await saveRole(workspace, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'alex-dev',
    githubHost: 'github.com-acme-dev'
  });

  const statusResult = runCli(workspace, ['status', '--short']);

  assert.equal(statusResult.status, 2);
  assert.equal(statusResult.stdout.trim(), freshRepoNoLocalRole.line, freshRepoNoLocalRole.id);

  const doctorResult = runCli(workspace, ['doctor', '--json']);
  assert.equal(doctorResult.status, 2, doctorResult.stderr);
  const doctor = JSON.parse(doctorResult.stdout) as {
    checks: Array<{ label: string; status: string; message: string }>;
  };
  assert.equal(
    doctor.checks.some(
      (check) =>
        check.label === 'commit' &&
        check.status === 'warn' &&
        check.message === freshRepoNoLocalRole.doctorCommit
    ),
    true
  );
});

test('e2e fresh repo with a local role keeps commit=ok', async () => {
  const workspace = await createHermeticWorkspace({
    sshUsersByHost: {
      'github.com-acme-dev': 'alex-dev'
    }
  });

  await initRepo(workspace);
  setGlobalIdentity(workspace, {
    name: 'Pat Person',
    email: 'pat@personal.example'
  });
  await saveRole(workspace, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'alex-dev',
    githubHost: 'github.com-acme-dev'
  });
  mustSucceed(runCli(workspace, ['use', 'work', '--local']), 'gitrole use work --local failed');
  setOrigin(workspace, 'git@github.com-acme-dev:acme-corp/service.git');

  const statusResult = runCli(workspace, ['status', '--short']);
  assert.equal(statusResult.status, 0, statusResult.stderr);
  assert.equal(
    statusResult.stdout.trim(),
    'role=work scope=local override=true commit=ok remote=ok auth=ok policy=na overall=aligned'
  );

  const doctorResult = runCli(workspace, ['doctor', '--json']);
  const doctor = JSON.parse(doctorResult.stdout) as {
    checks: Array<{ message: string }>;
  };
  assert.equal(
    doctor.checks.some((check) => check.message.includes('no local role before the first commit')),
    false
  );
});

test('e2e GIT_AUTHOR_EMAIL overrides config and status does not stay green', async () => {
  const workspace = await createHermeticWorkspace({
    sshUsersByHost: {
      'github.com-acme-dev': 'alex-dev'
    }
  });

  await initRepo(workspace);
  setGlobalIdentity(workspace, {
    name: 'Alex Developer',
    email: 'alex@work.example'
  });
  await saveRole(workspace, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'alex-dev',
    githubHost: 'github.com-acme-dev'
  });
  commitEmpty(workspace, {
    message: 'feat: env override'
  });
  setOrigin(workspace, 'git@github.com-acme-dev:acme-corp/service.git');

  const statusResult = runCli(workspace, ['status', '--short'], {
    env: {
      GIT_AUTHOR_EMAIL: 'other@example.com'
    }
  });
  assert.equal(statusResult.status, 2, statusResult.stderr);
  assert.equal(
    statusResult.stdout.trim(),
    'role=no-role scope=global override=false commit=warn remote=ok auth=ok policy=na overall=warning'
  );

  const humanStatus = runCli(workspace, ['status'], {
    env: {
      GIT_AUTHOR_EMAIL: 'other@example.com'
    }
  });
  assert.match(humanStatus.stdout, /other@example.com/);
  assert.match(humanStatus.stdout, /GIT_AUTHOR_EMAIL other@example.com/);

  const doctorResult = runCli(workspace, ['doctor', '--json'], {
    env: {
      GIT_AUTHOR_EMAIL: 'other@example.com'
    }
  });
  assert.equal(doctorResult.status, 2, doctorResult.stderr);
  const doctor = JSON.parse(doctorResult.stdout) as {
    commitIdentity: { email: { value?: string; source: string } };
    checks: Array<{ status: string; message: string }>;
  };
  assert.equal(doctor.commitIdentity.email.value, 'other@example.com');
  assert.equal(doctor.commitIdentity.email.source, 'env');
  assert.equal(
    doctor.checks.some(
      (check) =>
        check.status === 'warn' &&
        check.message === 'GIT_AUTHOR_EMAIL other@example.com overrides the configured commit email'
    ),
    true
  );
});

test('e2e GIT_COMMITTER_EMAIL warns when the committer is not the author', async () => {
  const workspace = await createHermeticWorkspace({
    sshUsersByHost: {
      'github.com-acme-dev': 'alex-dev'
    }
  });

  await initRepo(workspace);
  setGlobalIdentity(workspace, {
    name: 'Alex Developer',
    email: 'alex@work.example'
  });
  await saveRole(workspace, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'alex-dev',
    githubHost: 'github.com-acme-dev'
  });
  commitEmpty(workspace, {
    message: 'feat: committer override'
  });
  setOrigin(workspace, 'git@github.com-acme-dev:acme-corp/service.git');

  const statusResult = runCli(workspace, ['status', '--short'], {
    env: {
      GIT_COMMITTER_EMAIL: 'other@example.com'
    }
  });
  assert.equal(statusResult.status, 2, statusResult.stderr);
  assert.equal(
    statusResult.stdout.trim(),
    'role=work scope=global override=false commit=warn remote=ok auth=ok policy=na overall=warning'
  );

  const doctorResult = runCli(workspace, ['doctor', '--json'], {
    env: {
      GIT_COMMITTER_EMAIL: 'other@example.com'
    }
  });
  const doctor = JSON.parse(doctorResult.stdout) as {
    overall: string;
    checks: Array<{ status: string; message: string }>;
  };
  assert.equal(doctor.overall, 'warning');
  assert.equal(
    doctor.checks.some(
      (check) =>
        check.status === 'warn' &&
        check.message === 'GIT_COMMITTER_EMAIL other@example.com overrides the committer email'
    ),
    true
  );
});

test('e2e optional pre-commit hook runs check commit and refuses unsafe local identity', async () => {
  const hookSource = await readFile(path.resolve('hooks/pre-commit'), 'utf8');
  assert.match(hookSource, /gitrole check commit/);
  assert.doesNotMatch(hookSource, /gitrole use/);

  const workspace = await createHermeticWorkspace({
    sshUsersByHost: {
      'github.com-acme-dev': 'alex-dev'
    }
  });
  await initRepo(workspace);
  setGlobalIdentity(workspace, {
    name: 'Alex Developer',
    email: 'alex@work.example'
  });
  await saveRole(workspace, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'alex-dev',
    githubHost: 'github.com-acme-dev'
  });
  setOrigin(workspace, 'git@github.com-acme-dev:acme-corp/service.git');

  const binDir = path.join(workspace.rootDir, 'bin');
  const hookPath = path.join(workspace.rootDir, 'pre-commit');
  await mkdir(binDir);
  await writeFile(
    path.join(binDir, 'gitrole'),
    `#!/bin/sh\nexec "${process.execPath}" "${path.resolve('dist/cli/index.js')}" "$@"\n`
  );
  await chmod(path.join(binDir, 'gitrole'), 0o755);
  await writeFile(hookPath, hookSource);
  await chmod(hookPath, 0o755);

  const warned = spawnSync(hookPath, {
    cwd: workspace.repoDir,
    encoding: 'utf8',
    env: {
      ...workspace.env,
      PATH: `${binDir}:${workspace.env.PATH ?? ''}`
    }
  });
  assert.notEqual(warned.status, 0);
  assert.equal(warned.stdout, '');
  assert.match(warned.stderr, /--no-verify/);

  commitEmpty(workspace, {
    message: 'feat: local role committed'
  });
  mustSucceed(runCli(workspace, ['use', 'work', '--local']), 'gitrole use work --local failed');
  const aligned = spawnSync(hookPath, {
    cwd: workspace.repoDir,
    encoding: 'utf8',
    env: {
      ...workspace.env,
      PATH: `${binDir}:${workspace.env.PATH ?? ''}`
    }
  });
  assert.equal(aligned.status, 0, aligned.stderr);
  assert.equal(aligned.stdout, '');
  assert.equal(aligned.stderr, '');
});

test('e2e remote set preserves owner and repository while rewriting the host alias', async () => {
  const workspace = await createHermeticWorkspace();

  await initRepo(workspace);
  setOrigin(workspace, 'git@github.com:acme-corp/service.git');
  await saveRole(workspace, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubHost: 'github.com-acme-dev'
  });

  const remoteSetResult = runCli(workspace, ['remote', 'set', 'work']);
  mustSucceed(remoteSetResult, 'gitrole remote set work failed');
  assert.match(remoteSetResult.stdout, /updated remote\s+origin/);
  assert.equal(
    getOriginUrl(workspace),
    'git@github.com-acme-dev:acme-corp/service.git'
  );
});

test('e2e import current saves the effective local identity and current resolves it', async () => {
  const workspace = await createHermeticWorkspace();

  await initRepo(workspace);
  setGlobalIdentity(workspace, {
    name: 'Pat Person',
    email: 'pat@personal.example'
  });
  setLocalIdentity(workspace, {
    name: 'Alex Developer',
    email: 'alex@work.example'
  });
  commitEmpty(workspace, {
    message: 'feat: import current identity'
  });

  const importResult = runCli(workspace, ['import', 'current', '--name', 'work']);
  mustSucceed(importResult, 'gitrole import current --name work failed');
  assert.match(importResult.stdout, /imported current identity as\s+work/);
  assert.match(importResult.stdout, /commit\s+Alex Developer <alex@work.example>/);
  assert.match(importResult.stdout, /scope\s+local/);

  const currentResult = runCli(workspace, ['current']);
  mustSucceed(currentResult, 'gitrole current failed after import');
  assert.match(currentResult.stdout, /current role\s+work/);
  assert.match(currentResult.stdout, /commit\s+Alex Developer <alex@work.example>/);
});

test('e2e shared org repo stays aligned when the effective role is allowed but not default', async () => {
  const workspace = await createHermeticWorkspace({
    sshUsersByHost: {
      'github.com-saraeloop': 'saraeloop'
    }
  });

  await initRepo(workspace);
  setGlobalIdentity(workspace, {
    name: 'Sara Loera',
    email: 'saraeloop@gmail.com'
  });
  await saveRole(workspace, {
    name: 'saraeloop',
    fullName: 'Sara Loera',
    email: 'saraeloop@gmail.com',
    githubUser: 'saraeloop',
    githubHost: 'github.com-saraeloop'
  });
  commitEmpty(workspace, {
    message: 'docs: shared repo policy check'
  });
  setOrigin(workspace, 'git@github.com-saraeloop:open-source-org/gitrole.git');
  await writeRepoPolicy(workspace, {
    defaultRole: 'acmedeploy',
    allowedRoles: ['acmedeploy', 'saraeloop']
  });

  const statusResult = runCli(workspace, ['status']);
  mustSucceed(statusResult, 'gitrole status failed for shared org repo');
  assert.match(statusResult.stdout, /policy\s+allowed role saraeloop \(default: acmedeploy\)/);
  assert.doesNotMatch(statusResult.stdout, /\bwarning\b/);

  const statusShortResult = runCli(workspace, ['status', '--short']);
  mustSucceed(statusShortResult, 'gitrole status --short failed for shared org repo');
  assert.equal(
    statusShortResult.stdout.trim(),
    'role=saraeloop scope=global override=false commit=ok remote=ok auth=ok policy=ok overall=aligned'
  );

  const doctorResult = runCli(workspace, ['doctor']);
  mustSucceed(doctorResult, 'gitrole doctor failed for shared org repo');
  assert.match(doctorResult.stdout, /policy\s+\.gitrole \(v1\)/);
  assert.match(doctorResult.stdout, /default\s+acmedeploy/);
  assert.match(doctorResult.stdout, /allowed\s+acmedeploy, saraeloop/);
  assert.match(doctorResult.stdout, /\n\s*info policy\s+effective role saraeloop is allowed here, but repo defaultRole is acmedeploy/);
  assert.doesNotMatch(doctorResult.stdout, /\n\s*warn policy\s+/);

  const doctorJson = parseJsonOutput<{
    overall: string;
    repoPolicy?: {
      version: number;
      defaultRole: string;
      allowedRoles: string[];
      effectiveRole?: string;
      status: string;
    };
    checks: Array<{ label: string; status: string }>;
  }>(runCli(workspace, ['doctor', '--json']), 'gitrole doctor --json failed for shared org repo');

  assert.equal(doctorJson.overall, 'aligned');
  assert.deepEqual(doctorJson.repoPolicy, {
    version: 1,
    defaultRole: 'acmedeploy',
    allowedRoles: ['acmedeploy', 'saraeloop'],
    effectiveRole: 'saraeloop',
    status: 'allowed'
  });
  assert.equal(
    doctorJson.checks.some((check) => check.label === 'policy' && check.status === 'info'),
    true
  );
});

test('e2e pin creates repo policy that resolve, status, and doctor all observe', async () => {
  const workspace = await createHermeticWorkspace({
    sshUsersByHost: {
      'github.com-acme-dev': 'alex-dev'
    }
  });

  await initRepo(workspace);
  setGlobalIdentity(workspace, {
    name: 'Alex Developer',
    email: 'alex@work.example'
  });
  await saveRole(workspace, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'alex-dev',
    githubHost: 'github.com-acme-dev'
  });
  commitEmpty(workspace, {
    message: 'feat: pin repo policy flow'
  });
  setOrigin(workspace, 'git@github.com-acme-dev:acme-corp/service.git');

  const pinResult = runCli(workspace, ['pin', 'work']);
  mustSucceed(pinResult, 'gitrole pin work failed');
  assert.match(pinResult.stdout, /pinned role\s+work/);

  const resolveResult = runCli(workspace, ['resolve']);
  mustSucceed(resolveResult, 'gitrole resolve failed after pin');
  assert.equal(resolveResult.stdout.trim(), 'work');

  const resolveJson = parseJsonOutput<{
    version: number;
    defaultRole: string;
    allowedRoles: string[];
  }>(runCli(workspace, ['resolve', '--json']), 'gitrole resolve --json failed after pin');
  assert.deepEqual(resolveJson, {
    version: 1,
    defaultRole: 'work',
    allowedRoles: ['work']
  });

  const statusResult = runCli(workspace, ['status']);
  mustSucceed(statusResult, 'gitrole status failed after pin');
  assert.match(statusResult.stdout, /policy\s+default role work/);

  const doctorJson = parseJsonOutput<{
    overall: string;
    repoPolicy?: {
      version: number;
      defaultRole: string;
      allowedRoles: string[];
      effectiveRole?: string;
      status: string;
    };
  }>(runCli(workspace, ['doctor', '--json']), 'gitrole doctor --json failed after pin');
  assert.equal(doctorJson.overall, 'aligned');
  assert.deepEqual(doctorJson.repoPolicy, {
    version: 1,
    defaultRole: 'work',
    allowedRoles: ['work'],
    effectiveRole: 'work',
    status: 'default'
  });
});

for (const scope of ['global', 'local'] as const) {
  test(`e2e blank identities cannot replace working roles or ${scope} Git config`, async () => {
    const workspace = await createHermeticWorkspace();
    // Remove inherited identity/config overrides so an ordinary commit tests the fixture config.
    for (const key of Object.keys(workspace.env)) {
      if (key.startsWith('GIT_')) delete workspace.env[key];
    }
    workspace.env.GIT_CONFIG_NOSYSTEM = '1';
    workspace.env.GIT_CONFIG_GLOBAL = path.join(workspace.homeDir, '.gitconfig');
    workspace.env.GIT_CONFIG_SYSTEM = '/dev/null';
    await initRepo(workspace);
    await saveRole(workspace, { name: 'work', fullName: 'Maya Example', email: 'maya@example.test' });
    mustSucceed(runCli(workspace, ['use', 'work', `--${scope}`]), 'apply working role');
    const rolesPath = path.join(workspace.configHome, 'gitrole', 'roles.json');
    const configPath = scope === 'global'
      ? path.join(workspace.homeDir, '.gitconfig') : path.join(workspace.repoDir, '.git', 'config');
    const rolesBefore = await readFile(rolesPath, 'utf8');
    const configBefore = await readFile(configPath, 'utf8');
    const valid = { name: 'work', fullName: 'Maya Example', email: 'maya@example.test' };
    const invalid = [
      { ...valid, name: 'empty-name', fullName: '' },
      { ...valid, name: 'blank-name', fullName: ' \t\u00a0' },
      { ...valid, name: 'empty-email', email: '' },
      { ...valid, name: 'blank-email', email: ' \n\u2003' },
      { ...valid, name: 'both-blank', fullName: '   ', email: '' }
    ];
    for (const role of invalid) {
      for (const roleName of ['work', role.name]) {
        const result = runCli(workspace, ['add', roleName, '--name', role.fullName, '--email', role.email]);
        assert.equal(result.status, 1, result.stderr);
        assert.equal(result.stdout, '');
        assert.match(result.stderr, /must not be empty or whitespace-only/);
        assert.equal(await readFile(rolesPath, 'utf8'), rolesBefore);
        assert.equal(await readFile(configPath, 'utf8'), configBefore);
      }
    }
    // Seed pre-fix records directly: corrected add must never create them.
    const legacyRaw = JSON.stringify({ roles: [valid, ...invalid] });
    await writeFile(rolesPath, legacyRaw);
    for (const role of invalid) {
      const result = runCli(workspace, ['use', role.name, `--${scope}`]);
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /must not be empty or whitespace-only/);
      assert.equal(await readFile(configPath, 'utf8'), configBefore);
      assert.equal(await readFile(rolesPath, 'utf8'), legacyRaw);
    }
    mustSucceed(runGit(workspace, [
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
      'commit', '--allow-empty', '-m', 'identity preservation fixture'
    ]), 'next ordinary commit after rejected operations');
    const identity = runGit(workspace, ['log', '-1', '--format=%an <%ae>|%cn <%ce>']);
    mustSucceed(identity, 'inspect next commit attribution');
    assert.equal(identity.stdout.trim(), 'Maya Example <maya@example.test>|Maya Example <maya@example.test>');

    const diagnosis = runCli(workspace, ['doctor', '--json']);
    assert.equal(diagnosis.status, 2);
    const parsed = JSON.parse(diagnosis.stdout) as {
      role?: { name: string };
      checks: Array<{ status: string; label: string; message: string }>;
    };
    assert.equal(parsed.role?.name, 'work');
    for (const role of invalid) {
      assert.ok(parsed.checks.some((check) => check.status === 'warn' && check.label === 'role' &&
        check.message.includes(`"${role.name}"`)), `missing legacy warning for ${role.name}`);
    }
    assert.equal(await readFile(rolesPath, 'utf8'), legacyRaw);
    assert.equal(await readFile(configPath, 'utf8'), configBefore);
  });
}

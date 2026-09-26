/*
 * Exercises representative end-to-end CLI workflows in hermetic repositories.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  httpsPinAligned,
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

test('e2e status --short warns when origin is missing', async () => {
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
    'role=work scope=global override=false commit=ok remote=warn auth=na policy=na overall=warning'
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
  assert.equal(
    statusResult.stdout.trim(),
    'role=work scope=global override=false commit=ok remote=warn auth=ok policy=na overall=warning'
  );
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

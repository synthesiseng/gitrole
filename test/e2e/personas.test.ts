/*
 * Exercises multi-persona repository workflows that depend on saved role switching.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { SavedRoleInput } from './harness.js';
import {
  assertNoWarnChecks,
  commitEmpty,
  createHermeticWorkspace,
  initRepo,
  mustSucceed,
  parseJsonOutput,
  runCli,
  saveRole,
  setOrigin,
  setGlobalIdentity,
  useRole
} from './harness.js';

interface PersonaScenario {
  title: string;
  role: SavedRoleInput;
  scope: 'global' | 'local';
  initialGlobalIdentity?: {
    name: string;
    email: string;
  };
  remoteOwner: string;
  remoteRepository: string;
  commitMessage: string;
  expectedStatusShort: string;
  expectOwnerToDifferFromAuth: boolean;
}

interface DoctorJsonResult {
  role?: { name: string };
  overall: string;
  commitIdentity: {
    fullName: { value?: string; source: string };
    email: { value?: string; source: string };
  };
  scope: {
    effective: string;
    hasLocalOverride: boolean;
  };
  repository: {
    remote?: {
      host?: string;
      owner?: string;
      repository?: string;
    };
  };
  sshAuth?: {
    ok: boolean;
    host: string;
    githubUser?: string;
  };
  checks: Array<{ status: string; label: string; message: string }>;
}

function buildSshRemote(host: string, owner: string, repository: string): string {
  return `git@${host}:${owner}/${repository}.git`;
}

async function verifyAlignedPersonaScenario(scenario: PersonaScenario): Promise<void> {
  const githubHost = scenario.role.githubHost;
  const githubUser = scenario.role.githubUser;

  assert.ok(githubHost, `${scenario.title}: githubHost is required`);
  assert.ok(githubUser, `${scenario.title}: githubUser is required`);

  const workspace = await createHermeticWorkspace({
    repoName: scenario.role.name,
    sshUsersByHost: {
      [githubHost]: githubUser
    }
  });

  await initRepo(workspace);

  if (scenario.initialGlobalIdentity) {
    setGlobalIdentity(workspace, scenario.initialGlobalIdentity);
  }

  await saveRole(workspace, scenario.role);
  mustSucceed(
    useRole(workspace, scenario.role.name, scenario.scope),
    `${scenario.title}: failed to apply role`
  );
  setOrigin(
    workspace,
    buildSshRemote(githubHost, scenario.remoteOwner, scenario.remoteRepository)
  );
  commitEmpty(workspace, {
    message: scenario.commitMessage
  });

  const currentResult = runCli(workspace, ['current']);
  mustSucceed(currentResult, `${scenario.title}: gitrole current failed`);
  assert.match(currentResult.stdout, new RegExp(`current role\\s+${escapeRegex(scenario.role.name)}`));
  assert.match(
    currentResult.stdout,
    new RegExp(`commit\\s+${escapeRegex(`${scenario.role.fullName} <${scenario.role.email}>`)}`)
  );
  assert.match(
    currentResult.stdout,
    new RegExp(`push\\s+${escapeRegex(`${githubUser} via ${githubHost}`)}`)
  );

  const statusResult = runCli(workspace, ['status']);
  mustSucceed(statusResult, `${scenario.title}: gitrole status failed`);
  assert.match(statusResult.stdout, new RegExp(`^${escapeRegex(scenario.role.name)}\\s+aligned`, 'm'));
  assert.match(
    statusResult.stdout,
    new RegExp(`commit\\s+${escapeRegex(`${scenario.role.fullName} <${scenario.role.email}>`)}`)
  );
  assert.match(
    statusResult.stdout,
    new RegExp(`push\\s+${escapeRegex(`${githubUser} via ${githubHost}`)}`)
  );
  assert.match(
    statusResult.stdout,
    new RegExp(`scope\\s+${escapeRegex(scenario.scope === 'local' ? 'local override' : 'global')}`)
  );
  assert.doesNotMatch(statusResult.stdout, /\bwarning\b/);

  const statusShortResult = runCli(workspace, ['status', '--short']);
  mustSucceed(statusShortResult, `${scenario.title}: gitrole status --short failed`);
  assert.equal(statusShortResult.stdout.trim(), scenario.expectedStatusShort);

  const doctorResult = runCli(workspace, ['doctor']);
  mustSucceed(doctorResult, `${scenario.title}: gitrole doctor failed`);
  assert.match(doctorResult.stdout, /^doctor/m);
  assert.match(doctorResult.stdout, new RegExp(`role\\s+${escapeRegex(scenario.role.name)}`));
  assert.match(
    doctorResult.stdout,
    new RegExp(`scope\\s+${escapeRegex(scenario.scope)}`)
  );
  assert.match(
    doctorResult.stdout,
    new RegExp(`local\\s+${escapeRegex(scenario.scope === 'local' ? 'active' : 'inactive')}`)
  );
  assert.match(
    doctorResult.stdout,
    new RegExp(`rhost\\s+${escapeRegex(githubHost)}`)
  );
  assert.match(
    doctorResult.stdout,
    new RegExp(`rrepo\\s+${escapeRegex(`${scenario.remoteOwner}/${scenario.remoteRepository}`)}`)
  );
  assert.match(
    doctorResult.stdout,
    new RegExp(`push\\s+${escapeRegex(`${githubUser} via ${githubHost}`)}`)
  );
  assert.match(
    doctorResult.stdout,
    new RegExp(`auth\\s+${escapeRegex(`${githubUser} via ${githubHost}`)}`)
  );
  assert.doesNotMatch(doctorResult.stdout, /\n\s*warn\s+/);
  assert.doesNotMatch(doctorResult.stdout, /\bwarn owner\b/);

  const doctorJson = parseJsonOutput<DoctorJsonResult>(
    runCli(workspace, ['doctor', '--json']),
    `${scenario.title}: gitrole doctor --json failed`
  );

  assert.equal(doctorJson.role?.name, scenario.role.name);
  assert.equal(doctorJson.overall, 'aligned');
  assert.equal(doctorJson.commitIdentity.fullName.value, scenario.role.fullName);
  assert.equal(doctorJson.commitIdentity.email.value, scenario.role.email);
  assert.equal(doctorJson.scope.effective, scenario.scope);
  assert.equal(doctorJson.scope.hasLocalOverride, scenario.scope === 'local');
  assert.equal(doctorJson.repository.remote?.host, githubHost);
  assert.equal(doctorJson.repository.remote?.owner, scenario.remoteOwner);
  assert.equal(doctorJson.repository.remote?.repository, scenario.remoteRepository);
  assert.equal(doctorJson.sshAuth?.ok, true);
  assert.equal(doctorJson.sshAuth?.host, githubHost);
  assert.equal(doctorJson.sshAuth?.githubUser, githubUser);
  assertNoWarnChecks(doctorJson);
  assert.equal(doctorJson.checks.some((check) => check.label === 'owner'), false);

  if (scenario.expectOwnerToDifferFromAuth) {
    assert.notEqual(scenario.remoteOwner, githubUser);
  } else {
    assert.equal(scenario.remoteOwner, githubUser);
  }
}

test('persona: work repo stays aligned with a local override on an org remote', async () => {
  await verifyAlignedPersonaScenario({
    title: 'work repo',
    role: {
      name: 'work',
      fullName: 'Alex Developer',
      email: 'alex@work.example',
      githubUser: 'alex-dev',
      githubHost: 'github.com-work'
    },
    scope: 'local',
    initialGlobalIdentity: {
      name: 'Alex Personal',
      email: 'alex@personal.example'
    },
    remoteOwner: 'acme-corp',
    remoteRepository: 'payments-api',
    commitMessage: 'feat: ship work repo scenario',
    expectedStatusShort:
      'role=work scope=local override=true commit=ok remote=ok auth=ok policy=na overall=aligned',
    expectOwnerToDifferFromAuth: true
  });
});

test('persona: personal repo stays aligned on the personal account', async () => {
  await verifyAlignedPersonaScenario({
    title: 'personal repo',
    role: {
      name: 'personal',
      fullName: 'Sara Loera',
      email: 'saraeloop@gmail.com',
      githubUser: 'saraeloop',
      githubHost: 'github.com-saraeloop'
    },
    scope: 'global',
    remoteOwner: 'saraeloop',
    remoteRepository: 'dotfiles',
    commitMessage: 'feat: keep personal repos aligned',
    expectedStatusShort:
      'role=personal scope=global override=false commit=ok remote=ok auth=ok policy=na overall=aligned',
    expectOwnerToDifferFromAuth: false
  });
});

test('persona: client repo stays aligned with a local override and client auth', async () => {
  await verifyAlignedPersonaScenario({
    title: 'client repo',
    role: {
      name: 'client-acme',
      fullName: 'Sara Loera',
      email: 'sara@consulting.example',
      githubUser: 'acme-dev',
      githubHost: 'github.com-client-acme'
    },
    scope: 'local',
    initialGlobalIdentity: {
      name: 'Sara Loera',
      email: 'saraeloop@gmail.com'
    },
    remoteOwner: 'acme-platform',
    remoteRepository: 'client-portal',
    commitMessage: 'feat: keep client repos isolated',
    expectedStatusShort:
      'role=client-acme scope=local override=true commit=ok remote=ok auth=ok policy=na overall=aligned',
    expectOwnerToDifferFromAuth: true
  });
});

test('persona: open-source org repo stays aligned under a personal identity', async () => {
  await verifyAlignedPersonaScenario({
    title: 'open-source repo',
    role: {
      name: 'saraeloop',
      fullName: 'Sara Loera',
      email: 'saraeloop@gmail.com',
      githubUser: 'saraeloop',
      githubHost: 'github.com-saraeloop'
    },
    scope: 'global',
    remoteOwner: 'open-source-org',
    remoteRepository: 'cli-toolkit',
    commitMessage: 'docs: contribute to an org repo safely',
    expectedStatusShort:
      'role=saraeloop scope=global override=false commit=ok remote=ok auth=ok policy=na overall=aligned',
    expectOwnerToDifferFromAuth: true
  });
});

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* Verifies that use observes settled SSH loading while preserving switch failures. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { useRole } from '../src/application/use-cases/role.js';
import type { UseRoleDependencies, UseScope } from '../src/application/contracts.js';
import { parseRemoteUrl } from '../src/adapters/git-repository.js';

function fixture() {
  const role = { name: 'work', fullName: 'Alex Developer', email: 'alex@work.example',
    sshKeyPath: '/fixture/work-key', githubUser: 'alex-dev', githubHost: 'fixture.invalid' };
  const identities = { global: { name: 'Before', email: 'before@example.test' }, local: { name: '', email: '' } };
  const effects: string[] = [];
  const state = { loaded: false, loadFails: false, account: 'alex-dev', writeFails: '', assessmentFails: false };
  const write = async (scope: UseScope, field: 'name' | 'email', value: string) => {
    effects.push(`${scope}:${field}`);
    if (state.writeFails === field) throw new Error(`${field} write failed`);
    identities[scope][field] = value;
  };
  const remote = parseRemoteUrl('origin', 'git@fixture.invalid:example/service.git');
  const dependencies: UseRoleDependencies = {
    roleStore: { get: async () => role, list: async () => [role], save: async () => {}, remove: async () => false },
    gitConfig: {
      getGlobalUserName: async () => identities.global.name,
      getGlobalUserEmail: async () => identities.global.email,
      setGlobalUserName: value => write('global', 'name', value),
      setGlobalUserEmail: value => write('global', 'email', value)
    },
    repository: {
      isInsideWorkTree: async () => true, hasCommits: async () => true,
      getLatestNonMergeCommit: async () => undefined, getTopLevelPath: async () => '/fixture/repo',
      getCurrentBranch: async () => 'main', getUpstreamBranch: async () => undefined,
      getOriginUrl: async () => remote.url, getOriginRemote: async () => remote,
      getPushDestination: async () => {
        effects.push('assess');
        if (state.assessmentFails) throw new Error('assessment failed');
        return { remoteName: 'origin', targets: [remote], transport: { supported: true } };
      },
      setOriginUrl: async () => {},
      getLocalUserName: async () => identities.local.name || undefined,
      getLocalUserEmail: async () => identities.local.email || undefined,
      setLocalUserName: value => write('local', 'name', value),
      setLocalUserEmail: value => write('local', 'email', value)
    },
    sshAgent: { loadKey: async () => {
      effects.push('load');
      state.loaded = !state.loadFails;
      return state.loaded ? { ok: true } : { ok: false, message: 'synthetic load refused' };
    } },
    sshAuthProbe: { probeGithubUser: async host => {
      effects.push('probe');
      return state.loaded ? { ok: true, host, githubUser: state.account }
        : { ok: false, host, message: 'synthetic agent has no key' };
    } }
  };
  return { role, identities, effects, state, dependencies };
}

for (const scope of ['global', 'local'] as const) {
  test(`use ${scope} waits for key loading to settle before observing alignment`, async () => {
    const f = fixture();
    let started!: () => void;
    let release!: () => void;
    const loading = new Promise<void>(resolve => { started = resolve; });
    const complete = new Promise<void>(resolve => { release = resolve; });
    f.dependencies.sshAgent.loadKey = async () => {
      f.effects.push('load');
      started();
      await complete;
      f.state.loaded = true;
      return { ok: true };
    };
    const pending = useRole(f.dependencies, 'work', scope === 'global' ? {} : { scope });
    await loading;
    try {
      assert.deepEqual(f.effects, [`${scope}:name`, `${scope}:email`, 'load']);
    } finally {
      release();
    }
    const result = await pending;
    assert.equal(result.scope, scope);
    assert.equal(result.ssh?.ok, true);
    assert.equal(result.alignment?.sshAuth?.githubUser, 'alex-dev');
    assert.deepEqual(result.alignment?.checks.filter(check => check.status === 'warn'), []);
    assert.deepEqual(f.effects, [`${scope}:name`, `${scope}:email`, 'load', 'assess', 'probe']);
    assert.deepEqual(f.identities[scope], { name: f.role.fullName, email: f.role.email });
  });

  test(`use ${scope} without a key still assesses once`, async () => {
    const f = fixture();
    f.role.sshKeyPath = '';
    f.state.loaded = true;
    const result = await useRole(f.dependencies, 'work', { scope });
    assert.equal(result.ssh, undefined);
    assert.equal(result.alignment?.sshAuth?.githubUser, 'alex-dev');
    assert.deepEqual(f.effects, [`${scope}:name`, `${scope}:email`, 'assess', 'probe']);
  });

  test(`use ${scope} retains best-effort load failure and genuine account mismatch`, async () => {
    for (const failLoad of [true, false]) {
      const f = fixture();
      f.state.loadFails = failLoad;
      f.state.account = 'different-user';
      const result = await useRole(f.dependencies, 'work', { scope });
      assert.equal(result.ssh?.ok, !failLoad);
      assert.equal(result.ssh?.message, failLoad ? 'synthetic load refused' : undefined);
      assert.ok(result.alignment?.checks.some(check => check.label === 'auth' && check.status === 'warn'));
      assert.deepEqual(f.identities[scope], { name: f.role.fullName, email: f.role.email });
      assert.deepEqual(f.effects, [`${scope}:name`, `${scope}:email`, 'load', 'assess', 'probe']);
    }
  });

  test(`use ${scope} retains a successful load when assessment fails`, async () => {
    const f = fixture();
    f.state.assessmentFails = true;
    const result = await useRole(f.dependencies, 'work', { scope });
    assert.equal(result.alignment, undefined);
    assert.equal(result.ssh?.ok, true);
    assert.deepEqual(f.effects, [`${scope}:name`, `${scope}:email`, 'load', 'assess']);
  });

  test(`use ${scope} rejects invalid identity before any effects`, async () => {
    const f = fixture();
    f.role.email = ' ';
    await assert.rejects(useRole(f.dependencies, 'work', { scope }), /email/);
    assert.deepEqual(f.effects, []);
  });

  for (const field of ['name', 'email']) {
    test(`use ${scope} stops after a ${field} write failure`, async () => {
      const f = fixture();
      f.state.writeFails = field;
      await assert.rejects(useRole(f.dependencies, 'work', { scope }), new RegExp(`${field} write failed`));
      assert.deepEqual(f.effects, field === 'name' ? [`${scope}:name`] : [`${scope}:name`, `${scope}:email`]);
      assert.equal(f.identities[scope].name, field === 'email' ? f.role.fullName : scope === 'global' ? 'Before' : '');
      assert.equal(f.identities[scope].email, scope === 'global' ? 'before@example.test' : '');
    });
  }
}

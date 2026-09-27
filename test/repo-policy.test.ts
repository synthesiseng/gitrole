/*
 * Covers repository policy loading, validation, and evaluation behavior.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  InvalidRepoPolicyError,
  RepoPolicyNotFoundError,
  evaluateRepoPolicy,
  loadOptionalRepoPolicy,
  loadRepoPolicy
} from '../src/application/repo-policy.js';

function createRepositoryStub(repoDir?: string) {
  return {
    async isInsideWorkTree() {
      return Boolean(repoDir);
    },
    async getTopLevelPath() {
      return repoDir;
    }
  };
}

async function writeRepoPolicy(prefix: string, policy: unknown): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix));

  await writeFile(path.join(tempDir, '.gitrole'), JSON.stringify(policy, null, 2), 'utf8');

  return tempDir;
}

async function assertInvalidRoleName(
  load: () => Promise<unknown>,
  field: 'defaultRole' | 'allowedRoles',
  roleName: string
) {
  await assert.rejects(load, (error: unknown) => {
    assert.ok(error instanceof InvalidRepoPolicyError);
    assert.match(error.message, new RegExp(`repo policy file \\.gitrole is invalid: ${field} `));
    assert.match(
      error.message,
      new RegExp(
        `invalid role name "${roleName}"; use lowercase letters, numbers, "-" or "_"`
      )
    );
    return true;
  });
}

test('loadRepoPolicy reads a valid v1 repo policy file', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-policy-'));

  await mkdir(tempDir, { recursive: true });
  await writeFile(
    path.join(tempDir, '.gitrole'),
    JSON.stringify(
      {
        version: 1,
        defaultRole: 'acmedeploy',
        allowedRoles: ['acmedeploy', 'saraeloop']
      },
      null,
      2
    ),
    'utf8'
  );

  const repoPolicy = await loadRepoPolicy(createRepositoryStub(tempDir));

  assert.deepEqual(repoPolicy, {
    version: 1,
    defaultRole: 'acmedeploy',
    allowedRoles: ['acmedeploy', 'saraeloop']
  });
});

test('loadOptionalRepoPolicy returns undefined when .gitrole is absent', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-policy-missing-'));
  const repoPolicy = await loadOptionalRepoPolicy(createRepositoryStub(tempDir));

  assert.equal(repoPolicy, undefined);
});

test('loadRepoPolicy fails on invalid JSON', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-policy-json-'));

  await writeFile(path.join(tempDir, '.gitrole'), '{not-json', 'utf8');

  await assert.rejects(
    () => loadRepoPolicy(createRepositoryStub(tempDir)),
    InvalidRepoPolicyError
  );
});

test('loadRepoPolicy accepts fixture valid-role-names', async () => {
  const tempDir = await writeRepoPolicy('gitrole-policy-valid-role-names-', {
    version: 1,
    defaultRole: 'client-acme',
    allowedRoles: ['client-acme', 'agent_bot']
  });

  const repoPolicy = await loadRepoPolicy(createRepositoryStub(tempDir));

  assert.deepEqual(repoPolicy, {
    version: 1,
    defaultRole: 'client-acme',
    allowedRoles: ['client-acme', 'agent_bot']
  });
});

test('loadRepoPolicy rejects the reserved role name no-role', async () => {
  const tempDir = await writeRepoPolicy('gitrole-policy-reserved-role-', {
    version: 1,
    defaultRole: 'no-role',
    allowedRoles: ['no-role']
  });

  await assert.rejects(() => loadRepoPolicy(createRepositoryStub(tempDir)), (error: unknown) => {
    assert.ok(error instanceof InvalidRepoPolicyError);
    assert.match(
      error.message,
      /repo policy file \.gitrole is invalid: defaultRole role name "no-role" is reserved/
    );
    assert.doesNotMatch(error.message, /use lowercase letters/);
    return true;
  });
});

test('loadRepoPolicy rejects fixture invalid-default-role-spaces', async () => {
  const tempDir = await writeRepoPolicy('gitrole-policy-invalid-default-role-spaces-', {
    version: 1,
    defaultRole: 'client acme',
    allowedRoles: ['client acme']
  });

  await assertInvalidRoleName(
    () => loadRepoPolicy(createRepositoryStub(tempDir)),
    'defaultRole',
    'client acme'
  );
});

test('loadRepoPolicy rejects fixture invalid-default-role-uppercase', async () => {
  const tempDir = await writeRepoPolicy('gitrole-policy-invalid-default-role-uppercase-', {
    version: 1,
    defaultRole: 'Work',
    allowedRoles: ['Work']
  });

  await assertInvalidRoleName(
    () => loadRepoPolicy(createRepositoryStub(tempDir)),
    'defaultRole',
    'Work'
  );
});

test('loadRepoPolicy rejects fixture invalid-allowed-role-uppercase', async () => {
  const tempDir = await writeRepoPolicy('gitrole-policy-invalid-allowed-role-uppercase-', {
    version: 1,
    defaultRole: 'work',
    allowedRoles: ['work', 'Client']
  });

  await assertInvalidRoleName(
    () => loadRepoPolicy(createRepositoryStub(tempDir)),
    'allowedRoles',
    'Client'
  );
});

test('loadRepoPolicy rejects fixture invalid-allowed-role-spaces', async () => {
  const tempDir = await writeRepoPolicy('gitrole-policy-invalid-allowed-role-spaces-', {
    version: 1,
    defaultRole: 'work',
    allowedRoles: ['work', 'client acme']
  });

  await assertInvalidRoleName(
    () => loadRepoPolicy(createRepositoryStub(tempDir)),
    'allowedRoles',
    'client acme'
  );
});

test('loadOptionalRepoPolicy rejects fixture invalid-default-role-spaces', async () => {
  const tempDir = await writeRepoPolicy('gitrole-policy-optional-invalid-default-role-spaces-', {
    version: 1,
    defaultRole: 'client acme',
    allowedRoles: ['client acme']
  });

  await assertInvalidRoleName(
    () => loadOptionalRepoPolicy(createRepositoryStub(tempDir)),
    'defaultRole',
    'client acme'
  );
});

test('loadOptionalRepoPolicy rejects fixture invalid-allowed-role-uppercase', async () => {
  const tempDir = await writeRepoPolicy('gitrole-policy-optional-invalid-allowed-role-uppercase-', {
    version: 1,
    defaultRole: 'work',
    allowedRoles: ['work', 'Client']
  });

  await assertInvalidRoleName(
    () => loadOptionalRepoPolicy(createRepositoryStub(tempDir)),
    'allowedRoles',
    'Client'
  );
});

test('loadRepoPolicy fails when defaultRole is not in allowedRoles', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-policy-schema-'));

  await writeFile(
    path.join(tempDir, '.gitrole'),
    JSON.stringify(
      {
        version: 1,
        defaultRole: 'acmedeploy',
        allowedRoles: ['saraeloop']
      },
      null,
      2
    ),
    'utf8'
  );

  await assert.rejects(
    () => loadRepoPolicy(createRepositoryStub(tempDir)),
    InvalidRepoPolicyError
  );
});

test('loadRepoPolicy fails when .gitrole is missing', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-policy-no-file-'));

  await assert.rejects(
    () => loadRepoPolicy(createRepositoryStub(tempDir)),
    RepoPolicyNotFoundError
  );
});

test('evaluateRepoPolicy distinguishes default, allowed, and notAllowed roles', () => {
  const repoPolicy = {
    version: 1 as const,
    defaultRole: 'acmedeploy',
    allowedRoles: ['acmedeploy', 'saraeloop']
  };

  assert.equal(evaluateRepoPolicy(repoPolicy, 'acmedeploy').status, 'default');
  assert.equal(evaluateRepoPolicy(repoPolicy, 'saraeloop').status, 'allowed');
  assert.equal(evaluateRepoPolicy(repoPolicy, 'client-acme').status, 'notAllowed');
});

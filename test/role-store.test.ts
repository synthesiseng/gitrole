/*
 * Verifies role persistence, normalization, and config-path resolution behavior.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  FileRoleStore,
  InvalidSavedRoleDataError,
  resolveRolesFilePath
} from '../src/adapters/role-store.js';

test('role store adds, lists, gets, and removes roles', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-role-store-'));
  const store = new FileRoleStore({
    configFilePath: path.join(tempDir, 'gitrole', 'roles.json')
  });

  await store.save({
    name: 'sara',
    fullName: 'Sara Loera',
    email: 'sara@example.com',
    sshKeyPath: '/tmp/id_sara',
    githubUser: 'acmedeploy',
    githubHost: 'github.com-acmedeploy'
  });

  const saved = await store.get('sara');
  const listed = await store.list();

  assert.equal(saved?.name, 'sara');
  assert.equal(saved?.fullName, 'Sara Loera');
  assert.equal(saved?.githubUser, 'acmedeploy');
  assert.equal(saved?.githubHost, 'github.com-acmedeploy');
  assert.equal(listed.length, 1);

  const removed = await store.remove('sara');
  const afterRemove = await store.list();

  assert.equal(removed, true);
  assert.deepEqual(afterRemove, []);
});

test('role store creates a human-readable config file on first use', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-role-store-first-use-'));
  const configFilePath = path.join(tempDir, 'gitrole', 'roles.json');
  const store = new FileRoleStore({ configFilePath });

  const roles = await store.list();
  const raw = await readFile(configFilePath, 'utf8');

  assert.deepEqual(roles, []);
  assert.match(raw, /"roles": \[\]/);
});

test('role store writes through a temp file and leaves only the target config behind', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-role-store-atomic-'));
  const configDirectory = path.join(tempDir, 'gitrole');
  const configFilePath = path.join(configDirectory, 'roles.json');
  const store = new FileRoleStore({ configFilePath });

  await store.save({
    name: 'sara',
    fullName: 'Sara Loera',
    email: 'sara@example.com'
  });

  const raw = await readFile(configFilePath, 'utf8');
  const entries = await readdir(configDirectory);

  assert.match(raw, /"name": "sara"/);
  assert.deepEqual(entries.sort(), ['roles.json']);
});

test('role store resolves the XDG path', () => {
  const rolesFilePath = resolveRolesFilePath({
    HOME: '/Users/example',
    XDG_CONFIG_HOME: '/tmp/config-home'
  });

  assert.equal(rolesFilePath, '/tmp/config-home/gitrole/roles.json');
});

test('role store rejects invalid JSON in the persisted roles file', async () => {
  const store = await createStoreWithRawRolesFile('{not valid json');

  await assert.rejects(() => store.list(), {
    name: 'InvalidSavedRoleDataError',
    message: 'saved role data is invalid; fix or recreate the roles file'
  });
});

test('role store rejects the wrong top-level shape', async () => {
  const store = await createStoreWithRawRolesFile(
    JSON.stringify([{ name: 'work', fullName: 'Alex Developer', email: 'alex@work.example' }])
  );

  await assert.rejects(() => store.list(), InvalidSavedRoleDataError);
});

test('role store rejects invalid role entry shapes', async () => {
  const store = await createStoreWithRawRolesFile(
    JSON.stringify({
      roles: [{ name: 'work', fullName: 'Alex Developer' }]
    })
  );

  await assert.rejects(() => store.list(), InvalidSavedRoleDataError);
});

test('role store rejects invalid persisted role names', async () => {
  const store = await createStoreWithRawRolesFile(
    JSON.stringify({
      roles: [{ name: 'client acme', fullName: 'Alex Developer', email: 'alex@work.example' }]
    })
  );

  await assert.rejects(() => store.list(), InvalidSavedRoleDataError);
});

test('role store rejects mixed valid and invalid persisted roles', async () => {
  const store = await createStoreWithRawRolesFile(
    JSON.stringify({
      roles: [
        { name: 'work', fullName: 'Alex Developer', email: 'alex@work.example' },
        { name: 'client acme', fullName: 'Pat Person', email: 'pat@example.com' }
      ]
    })
  );

  await assert.rejects(() => store.list(), InvalidSavedRoleDataError);
});

async function createStoreWithRawRolesFile(raw: string): Promise<FileRoleStore> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-role-store-invalid-'));
  const configFilePath = path.join(tempDir, 'gitrole', 'roles.json');

  await mkdir(path.dirname(configFilePath), { recursive: true });
  await writeFile(configFilePath, raw, 'utf8');

  return new FileRoleStore({ configFilePath });
}

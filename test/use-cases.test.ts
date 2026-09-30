/*
 * Covers the application use cases that coordinate roles, status, and diagnosis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  addRole,
  doctor,
  getCurrentRole,
  getStatus,
  importCurrentRole,
  IncompleteCurrentIdentityError,
  NotInGitRepositoryError,
  pinRepoPolicy,
  PinRepoPolicyRepositoryContextError,
  removeRole,
  useRemoteForRole,
  useRole
} from '../src/application/use-cases/index.js';
import type { AppDependencies, DoctorDependencies } from '../src/application/contracts.js';
import { summarizeAlignment } from '../src/application/alignment.js';
import { RepoPolicyAlreadyExistsError } from '../src/application/repo-policy.js';
import { parseRemoteUrl } from '../src/adapters/git-repository.js';
import { InvalidRoleNameError, ReservedRoleNameError, type Role } from '../src/domain/role.js';

function getOriginRemote(url?: string) {
  return url ? parseRemoteUrl('origin', url) : undefined;
}

function createDependencies(role: Role): {
  dependencies: AppDependencies;
  calls: { names: string[]; emails: string[]; localNames: string[]; localEmails: string[]; ssh: string[] };
} {
  const calls = {
    names: [] as string[],
    emails: [] as string[],
    localNames: [] as string[],
    localEmails: [] as string[],
    ssh: [] as string[]
  };

  return {
    dependencies: {
      roleStore: {
        async list() {
          return [role];
        },
        async get(name: string) {
          return name === role.name ? role : undefined;
        },
        async save() {
          return undefined;
        },
        async remove() {
          return true;
        }
      },
      gitConfig: {
        async getGlobalUserName() {
          return role.fullName;
        },
        async getGlobalUserEmail() {
          return role.email;
        },
        async setGlobalUserName(name: string) {
          calls.names.push(name);
        },
        async setGlobalUserEmail(email: string) {
          calls.emails.push(email);
        }
      },
      sshAgent: {
        async loadKey(path: string) {
          calls.ssh.push(path);
          return { ok: true };
        }
      }
    },
    calls
  };
}

function createDoctorDependencies(role: Role, options: {
  topLevelPath?: string;
  remoteUrl?: string;
  globalIdentity?: { fullName?: string; email?: string };
  localIdentity?: { fullName?: string; email?: string };
  latestCommit?: {
    sha: string;
    authorName: string;
    authorEmail: string;
    subject: string;
  };
  sshAuth?: { ok: boolean; host: string; githubUser?: string; message?: string };
  roles?: Role[];
} = {}): DoctorDependencies {
  const roles = options.roles ?? [role];

  return {
    roleStore: {
      async list() {
        return roles;
      },
      async get(name: string) {
        return roles.find((candidate) => candidate.name === name);
      },
      async save() {
        return undefined;
      },
      async remove() {
        return true;
      }
    },
    gitConfig: {
      async getGlobalUserName() {
        return options.globalIdentity?.fullName ?? role.fullName;
      },
      async getGlobalUserEmail() {
        return options.globalIdentity?.email ?? role.email;
      },
      async setGlobalUserName() {
        return undefined;
      },
      async setGlobalUserEmail() {
        return undefined;
      }
    },
    repository: {
      async isInsideWorkTree() {
        return true;
      },
      async hasCommits() {
        return true;
      },
      async getLatestNonMergeCommit() {
        return options.latestCommit ?? {
          sha: 'abc123',
          authorName: options.localIdentity?.fullName ?? role.fullName,
          authorEmail: options.localIdentity?.email ?? role.email,
          subject: 'feat: aligned repo policy'
        };
      },
      async getTopLevelPath() {
        return options.topLevelPath ?? '/tmp/gitrole';
      },
      async getCurrentBranch() {
        return 'main';
      },
      async getUpstreamBranch() {
        return 'origin/main';
      },
      async getOriginUrl() {
        return options.remoteUrl ?? 'git@github.com-acmedeploy:acmedeploy/gitrole.git';
      },
      async getPushDestination() {
        const remote = await this.getOriginRemote();
        return { remoteName: 'origin', targets: remote ? [remote] : [], transport: { supported: true } };
      },
      async getOriginRemote() {
        return getOriginRemote(
          options.remoteUrl ?? 'git@github.com-acmedeploy:acmedeploy/gitrole.git'
        );
      },
      async setOriginUrl() {
        return undefined;
      },
      async getLocalUserName() {
        return options.localIdentity?.fullName;
      },
      async getLocalUserEmail() {
        return options.localIdentity?.email;
      },
      async setLocalUserName() {
        return undefined;
      },
      async setLocalUserEmail() {
        return undefined;
      }
    },
    sshAuthProbe: {
      async probeGithubUser() {
        return options.sshAuth ?? {
          ok: true,
          host: role.githubHost ?? 'github.com-acmedeploy',
          githubUser: role.githubUser
        };
      }
    }
  };
}

test('use-role applies the selected git identity', async () => {
  const role: Role = {
    name: 'sara',
    fullName: 'Sara Loera',
    email: 'sara@example.com',
    sshKeyPath: '/tmp/id_sara'
  };
  const { dependencies, calls } = createDependencies(role);

  const result = await useRole(dependencies, 'sara');

  assert.equal(result.role.name, 'sara');
  assert.equal(result.scope, 'global');
  assert.deepEqual(calls.names, ['Sara Loera']);
  assert.deepEqual(calls.emails, ['sara@example.com']);
  assert.deepEqual(calls.localNames, []);
  assert.deepEqual(calls.localEmails, []);
  assert.deepEqual(calls.ssh, ['/tmp/id_sara']);
});

test('add-role accepts contract-safe role names', async () => {
  const saved: Role[] = [];
  const dependencies: AppDependencies = {
    roleStore: {
      async list() {
        return saved;
      },
      async get(name: string) {
        return saved.find((role) => role.name === name);
      },
      async save(role: Role) {
        saved.push(role);
      },
      async remove() {
        return true;
      }
    },
    gitConfig: {
      async getGlobalUserName() {
        return undefined;
      },
      async getGlobalUserEmail() {
        return undefined;
      },
      async setGlobalUserName() {
        return undefined;
      },
      async setGlobalUserEmail() {
        return undefined;
      }
    },
    sshAgent: {
      async loadKey() {
        return { ok: true };
      }
    }
  };

  for (const name of ['work', 'client-acme', 'agent_bot', 'no_role', 'norole']) {
    const role = await addRole(dependencies, {
      name,
      fullName: 'Alex Developer',
      email: 'alex@work.example'
    });

    assert.equal(role.name, name);
  }

  assert.deepEqual(
    saved.map((role) => role.name),
    ['work', 'client-acme', 'agent_bot', 'no_role', 'norole']
  );
});

test('add-role rejects the reserved sentinel name no-role', async () => {
  let saved = false;
  const { dependencies } = createDependencies({
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example'
  });
  dependencies.roleStore.save = async () => {
    saved = true;
  };

  await assert.rejects(
    () =>
      addRole(dependencies, {
        name: 'no-role',
        fullName: 'Alex Developer',
        email: 'alex@work.example'
      }),
    (error: unknown) => {
      assert.ok(error instanceof ReservedRoleNameError);
      assert.equal(
        error.message,
        'role name "no-role" is reserved for the status and prompt sentinel when no saved role matches; choose a different name'
      );
      assert.doesNotMatch(error.message, /use lowercase letters/);
      return true;
    }
  );
  assert.equal(saved, false);
});

test('add-role rejects invalid role names', async () => {
  const { dependencies } = createDependencies({
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example'
  });

  for (const name of ['client acme', 'work/main', 'my@role', '', ' work', 'work ', 'role:prod']) {
    await assert.rejects(
      () =>
        addRole(dependencies, {
          name,
          fullName: 'Alex Developer',
          email: 'alex@work.example'
        }),
      InvalidRoleNameError
    );
  }
});

test('use-role succeeds when post-switch alignment assessment throws', async () => {
  const role: Role = {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example'
  };
  const { dependencies, calls } = createDependencies(role);

  const result = await useRole(
    {
      ...dependencies,
      repository: {
        async isInsideWorkTree() {
          return true;
        },
        async hasCommits() {
          return true;
        },
        async getLatestNonMergeCommit() {
          return undefined;
        },
        async getTopLevelPath() {
          return '/tmp/gitrole';
        },
        async getCurrentBranch() {
          return 'main';
        },
        async getUpstreamBranch() {
          return 'origin/main';
        },
        async getOriginUrl() {
          return 'git@github.com-acme-dev:acme-dev/gitrole.git';
        },
        async getPushDestination() {
        const remote = await this.getOriginRemote();
        return { remoteName: 'origin', targets: remote ? [remote] : [], transport: { supported: true } };
      },
      async getOriginRemote() {
          return getOriginRemote('git@github.com-acme-dev:acme-dev/gitrole.git');
        },
        async setOriginUrl() {
          return undefined;
        },
        async getLocalUserName() {
          throw new Error('alignment probe failed');
        },
        async getLocalUserEmail() {
          return undefined;
        },
        async setLocalUserName() {
          return undefined;
        },
        async setLocalUserEmail() {
          return undefined;
        }
      },
      sshAuthProbe: {
        async probeGithubUser() {
          return {
            ok: true,
            host: 'github.com-acme-dev',
            githubUser: 'acme-dev'
          };
        }
      }
    },
    'work'
  );

  assert.equal(result.role.name, 'work');
  assert.equal(result.scope, 'global');
  assert.equal(result.alignment, undefined);
  assert.deepEqual(calls.names, ['Alex Developer']);
  assert.deepEqual(calls.emails, ['alex@work.example']);
});

test('use-role can apply the selected git identity to local repository config', async () => {
  const role: Role = {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example'
  };
  const { dependencies, calls } = createDependencies(role);

  const result = await useRole(
    {
      ...dependencies,
      repository: {
        async isInsideWorkTree() {
          return true;
        },
        async hasCommits() {
          return true;
        },
        async getLatestNonMergeCommit() {
          return {
            sha: 'abc123',
            authorName: 'Alex Developer',
            authorEmail: 'alex@work.example',
            subject: 'feat: test local scope'
          };
        },
        async getTopLevelPath() {
          return '/tmp/gitrole';
        },
        async getCurrentBranch() {
          return 'main';
        },
        async getUpstreamBranch() {
          return 'origin/main';
        },
        async getOriginUrl() {
          return 'git@github.com-acme-dev:acme-dev/gitrole.git';
        },
        async getPushDestination() {
        const remote = await this.getOriginRemote();
        return { remoteName: 'origin', targets: remote ? [remote] : [], transport: { supported: true } };
      },
      async getOriginRemote() {
          return getOriginRemote('git@github.com-acme-dev:acme-dev/gitrole.git');
        },
        async setOriginUrl() {
          return undefined;
        },
        async getLocalUserName() {
          return role.fullName;
        },
        async getLocalUserEmail() {
          return role.email;
        },
        async setLocalUserName(name: string) {
          calls.localNames.push(name);
        },
        async setLocalUserEmail(email: string) {
          calls.localEmails.push(email);
        }
      },
      sshAuthProbe: {
        async probeGithubUser() {
          return {
            ok: true,
            host: 'github.com-acme-dev',
            githubUser: 'acme-dev'
          };
        }
      }
    },
    'work',
    { scope: 'local' }
  );

  assert.equal(result.scope, 'local');
  assert.deepEqual(calls.names, []);
  assert.deepEqual(calls.emails, []);
  assert.deepEqual(calls.localNames, ['Alex Developer']);
  assert.deepEqual(calls.localEmails, ['alex@work.example']);
});

test('import current saves the effective current identity as a role', async () => {
  const saved: Role[] = [];

  const result = await importCurrentRole(
    {
      roleStore: {
        async list() {
          return [];
        },
        async get() {
          return undefined;
        },
        async save(role: Role) {
          saved.push(role);
        },
        async remove() {
          return true;
        }
      },
      gitConfig: {
        async getGlobalUserName() {
          return 'Alex Developer';
        },
        async getGlobalUserEmail() {
          return 'alex@work.example';
        },
        async setGlobalUserName() {
          return undefined;
        },
        async setGlobalUserEmail() {
          return undefined;
        }
      },
      sshAgent: {
        async loadKey() {
          return { ok: true };
        }
      },
      repository: {
        async getLocalUserName() {
          return undefined;
        },
        async getLocalUserEmail() {
          return undefined;
        }
      }
    },
    'work'
  );

  assert.equal(result.scope, 'global');
  assert.deepEqual(result.role, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    sshKeyPath: undefined,
    githubUser: undefined,
    githubHost: undefined
  });
  assert.deepEqual(saved, [result.role]);
});

test('import current prefers the effective local identity when a repo-local override is active', async () => {
  const saved: Role[] = [];

  const result = await importCurrentRole(
    {
      roleStore: {
        async list() {
          return [];
        },
        async get() {
          return undefined;
        },
        async save(role: Role) {
          saved.push(role);
        },
        async remove() {
          return true;
        }
      },
      gitConfig: {
        async getGlobalUserName() {
          return 'Pat Person';
        },
        async getGlobalUserEmail() {
          return 'pat@personal.example';
        },
        async setGlobalUserName() {
          return undefined;
        },
        async setGlobalUserEmail() {
          return undefined;
        }
      },
      sshAgent: {
        async loadKey() {
          return { ok: true };
        }
      },
      repository: {
        async getLocalUserName() {
          return 'Alex Developer';
        },
        async getLocalUserEmail() {
          return 'alex@work.example';
        }
      }
    },
    'work'
  );

  assert.equal(result.scope, 'local');
  assert.deepEqual(saved, [
    {
      name: 'work',
      fullName: 'Alex Developer',
      email: 'alex@work.example',
      sshKeyPath: undefined,
      githubUser: undefined,
      githubHost: undefined
    }
  ]);
});

test('import current updates an existing role with the effective commit identity only', async () => {
  const saved: Role[] = [];

  const result = await importCurrentRole(
    {
      roleStore: {
        async list() {
          return [
            {
              name: 'work',
              fullName: 'Old Name',
              email: 'old@work.example',
              sshKeyPath: '~/.ssh/id_old',
              githubUser: 'old-user',
              githubHost: 'github.com-old'
            }
          ];
        },
        async get() {
          return {
            name: 'work',
            fullName: 'Old Name',
            email: 'old@work.example',
            sshKeyPath: '~/.ssh/id_old',
            githubUser: 'old-user',
            githubHost: 'github.com-old'
          };
        },
        async save(role: Role) {
          saved.push(role);
        },
        async remove() {
          return true;
        }
      },
      gitConfig: {
        async getGlobalUserName() {
          return 'Alex Developer';
        },
        async getGlobalUserEmail() {
          return 'alex@work.example';
        },
        async setGlobalUserName() {
          return undefined;
        },
        async setGlobalUserEmail() {
          return undefined;
        }
      },
      sshAgent: {
        async loadKey() {
          return { ok: true };
        }
      },
      repository: {
        async getLocalUserName() {
          return undefined;
        },
        async getLocalUserEmail() {
          return undefined;
        }
      }
    },
    'work'
  );

  assert.deepEqual(result.role, {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    sshKeyPath: undefined,
    githubUser: undefined,
    githubHost: undefined
  });
  assert.deepEqual(saved, [result.role]);
});

test('import current fails when the current identity is incomplete', async () => {
  await assert.rejects(
    () =>
      importCurrentRole(
        {
          roleStore: {
            async list() {
              return [];
            },
            async get() {
              return undefined;
            },
            async save() {
              return undefined;
            },
            async remove() {
              return true;
            }
          },
          gitConfig: {
            async getGlobalUserName() {
              return 'Alex Developer';
            },
            async getGlobalUserEmail() {
              return undefined;
            },
            async setGlobalUserName() {
              return undefined;
            },
            async setGlobalUserEmail() {
              return undefined;
            }
          },
          sshAgent: {
            async loadKey() {
              return { ok: true };
            }
          },
          repository: {
            async getLocalUserName() {
              return undefined;
            },
            async getLocalUserEmail() {
              return undefined;
            }
          }
        },
        'work'
      ),
    IncompleteCurrentIdentityError
  );
});

test('import current rejects invalid role names before saving', async () => {
  await assert.rejects(
    () =>
      importCurrentRole(
        {
          roleStore: {
            async list() {
              return [];
            },
            async get() {
              return undefined;
            },
            async save() {
              return undefined;
            },
            async remove() {
              return true;
            }
          },
          gitConfig: {
            async getGlobalUserName() {
              return 'Alex Developer';
            },
            async getGlobalUserEmail() {
              return 'alex@work.example';
            },
            async setGlobalUserName() {
              return undefined;
            },
            async setGlobalUserEmail() {
              return undefined;
            }
          },
          sshAgent: {
            async loadKey() {
              return { ok: true };
            }
          },
          repository: {
            async getLocalUserName() {
              return undefined;
            },
            async getLocalUserEmail() {
              return undefined;
            }
          }
        },
        'client acme'
      ),
    InvalidRoleNameError
  );
});

test('import current rejects the reserved sentinel name no-role before saving', async () => {
  let saved = false;

  await assert.rejects(
    () =>
      importCurrentRole(
        {
          roleStore: {
            async list() {
              return [];
            },
            async get() {
              return undefined;
            },
            async save() {
              saved = true;
            },
            async remove() {
              return true;
            }
          },
          gitConfig: {
            async getGlobalUserName() {
              return 'Alex Developer';
            },
            async getGlobalUserEmail() {
              return 'alex@work.example';
            },
            async setGlobalUserName() {
              return undefined;
            },
            async setGlobalUserEmail() {
              return undefined;
            }
          },
          sshAgent: {
            async loadKey() {
              return { ok: true };
            }
          },
          repository: {
            async getLocalUserName() {
              return undefined;
            },
            async getLocalUserEmail() {
              return undefined;
            }
          }
        },
        'no-role'
      ),
    (error: unknown) => {
      assert.ok(error instanceof ReservedRoleNameError);
      assert.match(error.message, /role name "no-role" is reserved/);
      return true;
    }
  );
  assert.equal(saved, false);
});

test('remove-role still deletes a legacy saved role named no-role', async () => {
  const role: Role = {
    name: 'no-role',
    fullName: 'Alex Developer',
    email: 'alex@work.example'
  };
  const { dependencies } = createDependencies(role);

  const removed = await removeRole(dependencies, 'no-role');

  assert.equal(removed.name, 'no-role');
  assert.equal(removed.email, 'alex@work.example');
});

test('role-referencing commands reject invalid role names consistently', async () => {
  const role: Role = {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubHost: 'github.com-work'
  };
  const { dependencies } = createDependencies(role);

  await assert.rejects(() => useRole(dependencies, 'client acme'), InvalidRoleNameError);
  await assert.rejects(() => useRole(dependencies, 'no-role'), ReservedRoleNameError);
  await assert.rejects(() => removeRole(dependencies, 'client acme'), InvalidRoleNameError);
  await assert.rejects(
    () =>
      pinRepoPolicy(
        {
          roleStore: dependencies.roleStore,
          repository: {
            async isInsideWorkTree() {
              return true;
            },
            async getTopLevelPath() {
              return '/tmp/gitrole';
            }
          }
        },
        'client acme'
      ),
    InvalidRoleNameError
  );
  await assert.rejects(
    () =>
      pinRepoPolicy(
        {
          roleStore: dependencies.roleStore,
          repository: {
            async isInsideWorkTree() {
              return true;
            },
            async getTopLevelPath() {
              return '/tmp/gitrole';
            }
          }
        },
        'no-role'
      ),
    ReservedRoleNameError
  );
  await assert.rejects(
    () =>
      useRemoteForRole(
        {
          roleStore: dependencies.roleStore,
          repository: {
            async isInsideWorkTree() {
              return true;
            },
            async hasCommits() {
              return true;
            },
            async getLatestNonMergeCommit() {
              return undefined;
            },
            async getTopLevelPath() {
              return '/tmp/gitrole';
            },
            async getCurrentBranch() {
              return 'main';
            },
            async getUpstreamBranch() {
              return 'origin/main';
            },
            async getOriginUrl() {
              return 'git@github.com-work:acme/service.git';
            },
            async getPushDestination() {
        const remote = await this.getOriginRemote();
        return { remoteName: 'origin', targets: remote ? [remote] : [], transport: { supported: true } };
      },
      async getOriginRemote() {
              return getOriginRemote('git@github.com-work:acme/service.git');
            },
            async setOriginUrl() {
              return undefined;
            },
            async getLocalUserName() {
              return undefined;
            },
            async getLocalUserEmail() {
              return undefined;
            },
            async setLocalUserName() {
              return undefined;
            },
            async setLocalUserEmail() {
              return undefined;
            }
          }
        },
        'client acme'
      ),
    InvalidRoleNameError
  );
});

test('pin creates a strict repo-local policy with the selected role only', async () => {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-pin-use-case-'));
  const role: Role = {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example'
  };

  const result = await pinRepoPolicy(
    {
      roleStore: {
        async list() {
          return [role];
        },
        async get(name: string) {
          return name === role.name ? role : undefined;
        },
        async save() {
          return undefined;
        },
        async remove() {
          return true;
        }
      },
      repository: {
        async isInsideWorkTree() {
          return true;
        },
        async getTopLevelPath() {
          return repoDir;
        }
      }
    },
    'work'
  );

  assert.equal(result.role.name, 'work');
  assert.deepEqual(result.repoPolicy, {
    version: 1,
    defaultRole: 'work',
    allowedRoles: ['work']
  });
  assert.equal(
    await readFile(path.join(repoDir, '.gitrole'), 'utf8'),
    '{\n  "version": 1,\n  "defaultRole": "work",\n  "allowedRoles": [\n    "work"\n  ]\n}\n'
  );
});

test('pin fails outside a git repository', async () => {
  const role: Role = {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example'
  };

  await assert.rejects(
    () =>
      pinRepoPolicy(
        {
          roleStore: {
            async list() {
              return [role];
            },
            async get(name: string) {
              return name === role.name ? role : undefined;
            },
            async save() {
              return undefined;
            },
            async remove() {
              return true;
            }
          },
          repository: {
            async isInsideWorkTree() {
              return false;
            },
            async getTopLevelPath() {
              return undefined;
            }
          }
        },
        'work'
      ),
    PinRepoPolicyRepositoryContextError
  );
});

test('pin fails when the repo already has policy and does not overwrite it', async () => {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-pin-existing-'));
  const existingPolicy = JSON.stringify(
    {
      version: 1,
      defaultRole: 'personal',
      allowedRoles: ['personal', 'work']
    },
    null,
    2
  );
  await writeFile(path.join(repoDir, '.gitrole'), `${existingPolicy}\n`, 'utf8');

  const role: Role = {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example'
  };

  await assert.rejects(
    () =>
      pinRepoPolicy(
        {
          roleStore: {
            async list() {
              return [role];
            },
            async get(name: string) {
              return name === role.name ? role : undefined;
            },
            async save() {
              return undefined;
            },
            async remove() {
              return true;
            }
          },
          repository: {
            async isInsideWorkTree() {
              return true;
            },
            async getTopLevelPath() {
              return repoDir;
            }
          }
        },
        'work'
      ),
    RepoPolicyAlreadyExistsError
  );
  assert.equal(await readFile(path.join(repoDir, '.gitrole'), 'utf8'), `${existingPolicy}\n`);
});

test('use-role rejects local scope outside a git repository', async () => {
  const role: Role = {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example'
  };
  const { dependencies } = createDependencies(role);

  await assert.rejects(
    () =>
      useRole(
        {
          ...dependencies,
          repository: {
            async isInsideWorkTree() {
              return false;
            },
        async hasCommits() {
          return false;
        },
        async getLatestNonMergeCommit() {
          return undefined;
        },
        async getTopLevelPath() {
          return undefined;
            },
            async getCurrentBranch() {
              return undefined;
            },
            async getUpstreamBranch() {
              return undefined;
            },
            async getOriginUrl() {
              return undefined;
            },
            async getPushDestination() {
        const remote = await this.getOriginRemote();
        return { remoteName: 'origin', targets: remote ? [remote] : [], transport: { supported: true } };
      },
      async getOriginRemote() {
              return undefined;
            },
            async setOriginUrl() {
              return undefined;
            },
            async getLocalUserName() {
              return undefined;
            },
            async getLocalUserEmail() {
              return undefined;
            },
            async setLocalUserName() {
              return undefined;
            },
            async setLocalUserEmail() {
              return undefined;
            }
          }
        },
        'work',
        { scope: 'local' }
      ),
    NotInGitRepositoryError
  );
});

test('use-role returns repo-aware warnings when the selected role does not match the repo path', async () => {
  const role: Role = {
    name: 'work',
    fullName: 'Sara Loera',
    email: 'sara@acme.example',
    githubUser: 'acmedeploy',
    githubHost: 'github.com-acmedeploy'
  };
  const { dependencies } = createDependencies(role);

  const result = await useRole(
    {
      ...dependencies,
      repository: {
        async isInsideWorkTree() {
          return true;
        },
        async hasCommits() {
          return true;
        },
        async getLatestNonMergeCommit() {
          return undefined;
        },
        async getTopLevelPath() {
          return '/tmp/gitrole';
        },
        async getCurrentBranch() {
          return 'main';
        },
        async getUpstreamBranch() {
          return 'origin/main';
        },
        async getOriginUrl() {
          return 'git@github.com-saraeloop:acmedeploy/gitrole.git';
        },
        async getPushDestination() {
        const remote = await this.getOriginRemote();
        return { remoteName: 'origin', targets: remote ? [remote] : [], transport: { supported: true } };
      },
      async getOriginRemote() {
          return getOriginRemote('git@github.com-saraeloop:acmedeploy/gitrole.git');
        },
        async setOriginUrl() {
          return undefined;
        },
        async getLocalUserName() {
          return undefined;
        },
        async getLocalUserEmail() {
          return undefined;
        },
        async setLocalUserName() {
          return undefined;
        },
        async setLocalUserEmail() {
          return undefined;
        }
      },
      sshAuthProbe: {
        async probeGithubUser() {
          return {
            ok: true,
            host: 'github.com-saraeloop',
            githubUser: 'saraeloop'
          };
        }
      }
    },
    'work'
  );

  assert.equal(result.alignment?.checks.some((check) => check.status === 'warn'), true);
  assert.equal(
    result.alignment?.checks.some(
      (check) =>
        check.label === 'host' &&
        check.message.includes('does not match role githubHost')
    ),
    true
  );
  assert.equal(
    result.alignment?.checks.some(
      (check) =>
        check.label === 'auth' && check.message.includes('expected acmedeploy')
    ),
    true
  );
});

test('current-role matches the active identity against saved roles', async () => {
  const role: Role = {
    name: 'sara',
    fullName: 'Sara Loera',
    email: 'sara@example.com'
  };
  const { dependencies } = createDependencies(role);

  const result = await getCurrentRole(dependencies);

  assert.equal(result.role?.name, 'sara');
  assert.equal(result.identity.fullName, 'Sara Loera');
  assert.equal(result.identity.email, 'sara@example.com');
});

test('current-role prefers the effective local identity when a repo-local override is active', async () => {
  const globalRole: Role = {
    name: 'personal',
    fullName: 'Sara Personal',
    email: 'sara@personal.example'
  };
  const localRole: Role = {
    name: 'work',
    fullName: 'Acme Examples',
    email: 'dev@acme-examples.test'
  };
  const { dependencies } = createDependencies(globalRole);

  const result = await getCurrentRole({
    ...dependencies,
    roleStore: {
      async list() {
        return [globalRole, localRole];
      },
      async get(name: string) {
        return [globalRole, localRole].find((role) => role.name === name);
      },
      async save() {
        return undefined;
      },
      async remove() {
        return true;
      }
    },
    repository: {
      async getLocalUserName() {
        return localRole.fullName;
      },
      async getLocalUserEmail() {
        return localRole.email;
      }
    }
  });

  assert.equal(result.role?.name, 'work');
  assert.equal(result.identity.fullName, 'Acme Examples');
  assert.equal(result.identity.email, 'dev@acme-examples.test');
});

test('doctor aligns commit identity, remote metadata, and SSH auth', async () => {
  const role: Role = {
    name: 'work',
    fullName: 'Sara Loera',
    email: 'sara@acme.example',
    sshKeyPath: '~/.ssh/id_ed25519_acmedeploy',
    githubUser: 'acmedeploy',
    githubHost: 'github.com-acmedeploy'
  };
  const dependencies: DoctorDependencies = {
    roleStore: {
      async list() {
        return [role];
      },
      async get() {
        return role;
      },
      async save() {
        return undefined;
      },
      async remove() {
        return true;
      }
    },
    gitConfig: {
      async getGlobalUserName() {
        return role.fullName;
      },
      async getGlobalUserEmail() {
        return role.email;
      },
      async setGlobalUserName() {
        return undefined;
      },
      async setGlobalUserEmail() {
        return undefined;
      }
    },
    repository: {
      async isInsideWorkTree() {
        return true;
      },
      async hasCommits() {
        return true;
      },
      async getLatestNonMergeCommit() {
        return {
          sha: 'abc123',
          authorName: 'Sara Loera',
          authorEmail: 'sara@acme.example',
          subject: 'feat: align identity'
        };
      },
      async getTopLevelPath() {
        return '/tmp/gitrole';
      },
      async getCurrentBranch() {
        return 'main';
      },
      async getUpstreamBranch() {
        return 'origin/main';
      },
      async getOriginUrl() {
        return 'git@github.com-acmedeploy:acmedeploy/gitrole.git';
      },
      async getPushDestination() {
        const remote = await this.getOriginRemote();
        return { remoteName: 'origin', targets: remote ? [remote] : [], transport: { supported: true } };
      },
      async getOriginRemote() {
        return getOriginRemote('git@github.com-acmedeploy:acmedeploy/gitrole.git');
      },
      async setOriginUrl() {
        return undefined;
      },
      async getLocalUserName() {
        return undefined;
      },
      async getLocalUserEmail() {
        return undefined;
      },
      async setLocalUserName() {
        return undefined;
      },
      async setLocalUserEmail() {
        return undefined;
      }
    },
    sshAuthProbe: {
      async probeGithubUser(host: string) {
        assert.equal(host, 'github.com-acmedeploy');
        return {
          ok: true,
          host,
          githubUser: 'acmedeploy'
        };
      }
    }
  };

  const result = await doctor(dependencies);

  assert.equal(result.role?.name, 'work');
  assert.equal(result.overall, 'aligned');
  assert.equal(result.commitIdentity.fullName.source, 'global');
  assert.equal(result.repository.remote?.owner, 'acmedeploy');
  assert.equal(result.sshAuth?.githubUser, 'acmedeploy');
  assert.equal(result.checks.some((check) => check.status === 'warn'), false);
  assert.equal(result.checks.some((check) => check.label === 'identity'), false);

  const status = await getStatus(dependencies);
  assert.equal(status.roleName, 'work');
  assert.equal(status.commitIdentity, 'Sara Loera <sara@acme.example>');
  assert.equal(status.pushAuth, 'acmedeploy via github.com-acmedeploy');
  assert.equal(status.scope, 'global');
  assert.equal(status.localOverride, false);
  assert.deepEqual(status.lastNonMergeCommit, {
    sha: 'abc123',
    authorName: 'Sara Loera',
    authorEmail: 'sara@acme.example',
    subject: 'feat: align identity'
  });
  assert.equal(status.historyNote, undefined);
  assert.equal(status.overall, 'aligned');
  assert.equal(status.commit, 'ok');
  assert.equal(status.remote, 'ok');
  assert.equal(status.auth, 'ok');
  assert.equal(status.policy, 'na');

});

test('doctor reports local scope when repo-local identity overrides are active', async () => {
  const role: Role = {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'acme-dev',
    githubHost: 'github.com-acme-dev'
  };
  const dependencies: DoctorDependencies = {
    roleStore: {
      async list() {
        return [role];
      },
      async get() {
        return role;
      },
      async save() {
        return undefined;
      },
      async remove() {
        return true;
      }
    },
    gitConfig: {
      async getGlobalUserName() {
        return 'Pat Person';
      },
      async getGlobalUserEmail() {
        return 'pat@personal.example';
      },
      async setGlobalUserName() {
        return undefined;
      },
      async setGlobalUserEmail() {
        return undefined;
      }
    },
    repository: {
      async isInsideWorkTree() {
        return true;
      },
      async hasCommits() {
        return true;
      },
      async getLatestNonMergeCommit() {
        return {
          sha: 'abc123',
          authorName: 'Alex Developer',
          authorEmail: 'alex@work.example',
          subject: 'feat: local alignment'
        };
      },
      async getTopLevelPath() {
        return '/tmp/gitrole';
      },
      async getCurrentBranch() {
        return 'main';
      },
      async getUpstreamBranch() {
        return 'origin/main';
      },
      async getOriginUrl() {
        return 'git@github.com-acme-dev:acme-dev/gitrole.git';
      },
      async getPushDestination() {
        const remote = await this.getOriginRemote();
        return { remoteName: 'origin', targets: remote ? [remote] : [], transport: { supported: true } };
      },
      async getOriginRemote() {
        return getOriginRemote('git@github.com-acme-dev:acme-dev/gitrole.git');
      },
      async setOriginUrl() {
        return undefined;
      },
      async getLocalUserName() {
        return role.fullName;
      },
      async getLocalUserEmail() {
        return role.email;
      },
      async setLocalUserName() {
        return undefined;
      },
      async setLocalUserEmail() {
        return undefined;
      }
    },
    sshAuthProbe: {
      async probeGithubUser() {
        return {
          ok: true,
          host: 'github.com-acme-dev',
          githubUser: 'acme-dev'
        };
      }
    }
  };

  const result = await doctor(dependencies);
  const status = await getStatus(dependencies);

  assert.equal(result.overall, 'aligned');
  assert.equal(result.scope.effective, 'local');
  assert.equal(result.scope.hasLocalOverride, true);
  assert.equal(
    result.checks.some(
      (check) =>
        check.label === 'scope' &&
        check.message.includes('selected role work is applied via local config')
    ),
    true
  );
  assert.equal(status.scope, 'local');
  assert.equal(status.localOverride, true);
  assert.equal(status.lastNonMergeCommit?.authorName, 'Alex Developer');
  assert.equal(status.historyNote, undefined);
  assert.equal(status.overall, 'aligned');
});

test('doctor stays aligned for org remotes when auth and host match the role', async () => {
  const role: Role = {
    name: 'personal',
    fullName: 'Alex Developer',
    email: 'alex@personal.example',
    githubUser: 'alex-dev',
    githubHost: 'github.com-personal'
  };
  const dependencies: DoctorDependencies = {
    roleStore: {
      async list() {
        return [role];
      },
      async get() {
        return role;
      },
      async save() {
        return undefined;
      },
      async remove() {
        return true;
      }
    },
    gitConfig: {
      async getGlobalUserName() {
        return role.fullName;
      },
      async getGlobalUserEmail() {
        return role.email;
      },
      async setGlobalUserName() {
        return undefined;
      },
      async setGlobalUserEmail() {
        return undefined;
      }
    },
    repository: {
      async isInsideWorkTree() {
        return true;
      },
      async hasCommits() {
        return true;
      },
      async getLatestNonMergeCommit() {
        return {
          sha: 'abc123',
          authorName: 'Alex Developer',
          authorEmail: 'alex@personal.example',
          subject: 'feat: aligned personal commit'
        };
      },
      async getTopLevelPath() {
        return '/tmp/gitrole';
      },
      async getCurrentBranch() {
        return 'main';
      },
      async getUpstreamBranch() {
        return 'origin/main';
      },
      async getOriginUrl() {
        return 'git@github.com-personal:acme-org/gitrole.git';
      },
      async getPushDestination() {
        const remote = await this.getOriginRemote();
        return { remoteName: 'origin', targets: remote ? [remote] : [], transport: { supported: true } };
      },
      async getOriginRemote() {
        return getOriginRemote('git@github.com-personal:acme-org/gitrole.git');
      },
      async setOriginUrl() {
        return undefined;
      },
      async getLocalUserName() {
        return undefined;
      },
      async getLocalUserEmail() {
        return undefined;
      },
      async setLocalUserName() {
        return undefined;
      },
      async setLocalUserEmail() {
        return undefined;
      }
    },
    sshAuthProbe: {
      async probeGithubUser() {
        return {
          ok: true,
          host: 'github.com-personal',
          githubUser: 'alex-dev'
        };
      }
    }
  };

  const result = await doctor(dependencies);
  const status = await getStatus(dependencies);
  assert.equal(result.repository.remote?.owner, 'acme-org');
  assert.equal(result.overall, 'aligned');
  assert.equal(result.checks.some((check) => check.label === 'owner'), false);
  assert.equal(result.checks.some((check) => check.status === 'warn'), false);
  assert.equal(status.overall, 'aligned');
});

test('status stays aligned when current identity is correct but the last commit used an older identity', async () => {
  const role: Role = {
    name: 'acmedeploy',
    fullName: 'acme-examples',
    email: 'acmedeploy@gmail.com',
    githubUser: 'acmedeploy',
    githubHost: 'github.com-acmedeploy'
  };

  const status = await getStatus(
    createDoctorDependencies(role, {
      localIdentity: {
        fullName: role.fullName,
        email: role.email
      },
      latestCommit: {
        sha: 'abc123',
        authorName: 'acme-examples',
        authorEmail: 'sara@acme.example',
        subject: 'docs: previous account commit'
      },
      sshAuth: {
        ok: true,
        host: 'github.com-acmedeploy',
        githubUser: 'acmedeploy'
      }
    })
  );

  assert.equal(status.overall, 'aligned');
  assert.equal(status.commit, 'ok');
  assert.equal(status.auth, 'ok');
  assert.equal(
    status.historyNote,
    'last non-merge commit used acme-examples <sara@acme.example>'
  );
});

test('status stays aligned when the effective role matches repo defaultRole', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-policy-default-'));
  const role: Role = {
    name: 'acmedeploy',
    fullName: 'Acme Examples',
    email: 'dev@acme-examples.test',
    githubUser: 'acmedeploy',
    githubHost: 'github.com-acmedeploy'
  };

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

  const result = await doctor(
    createDoctorDependencies(role, {
      topLevelPath: tempDir
    })
  );
  const status = await getStatus(
    createDoctorDependencies(role, {
      topLevelPath: tempDir
    })
  );

  assert.equal(result.repoPolicy?.status, 'default');
  assert.equal(
    result.checks.some(
      (check) =>
        check.label === 'policy' &&
        check.status === 'ok' &&
        check.message.includes('matches repo defaultRole')
    ),
    true
  );
  assert.equal(result.overall, 'aligned');
  assert.equal(status.repoPolicy?.status, 'default');
  assert.equal(status.policy, 'ok');
  assert.equal(status.overall, 'aligned');
});

test('status stays aligned when the effective role is allowed but not default', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-policy-allowed-'));
  const role: Role = {
    name: 'saraeloop',
    fullName: 'Sara Loera',
    email: 'saraeloop@gmail.com',
    githubUser: 'saraeloop',
    githubHost: 'github.com-saraeloop'
  };

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

  const result = await doctor(
    createDoctorDependencies(role, {
      topLevelPath: tempDir,
      remoteUrl: 'git@github.com-saraeloop:open-source-org/gitrole.git'
    })
  );
  const status = await getStatus(
    createDoctorDependencies(role, {
      topLevelPath: tempDir,
      remoteUrl: 'git@github.com-saraeloop:open-source-org/gitrole.git'
    })
  );

  assert.equal(result.repoPolicy?.status, 'allowed');
  assert.equal(
    result.checks.some(
      (check) =>
        check.label === 'policy' &&
        check.status === 'info' &&
        check.message.includes('allowed here, but repo defaultRole is acmedeploy')
    ),
    true
  );
  assert.equal(result.overall, 'aligned');
  assert.equal(status.repoPolicy?.status, 'allowed');
  assert.equal(status.policy, 'ok');
  assert.equal(status.overall, 'aligned');
});

test('status warns when the effective role is not allowed by repo policy', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-policy-warn-'));
  const role: Role = {
    name: 'client-acme',
    fullName: 'Sara Loera',
    email: 'sara@client.example',
    githubUser: 'client-acme-dev',
    githubHost: 'github.com-client-acme'
  };

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

  const result = await doctor(
    createDoctorDependencies(role, {
      topLevelPath: tempDir,
      remoteUrl: 'git@github.com-client-acme:acme-platform/client-portal.git'
    })
  );
  const status = await getStatus(
    createDoctorDependencies(role, {
      topLevelPath: tempDir,
      remoteUrl: 'git@github.com-client-acme:acme-platform/client-portal.git'
    })
  );

  assert.equal(result.repoPolicy?.status, 'notAllowed');
  assert.equal(
    result.checks.some(
      (check) =>
        check.label === 'policy' &&
        check.status === 'warn' &&
        check.message.includes('client-acme is not allowed here')
    ),
    true
  );
  assert.equal(result.overall, 'warning');
  assert.equal(status.repoPolicy?.status, 'notAllowed');
  assert.equal(status.policy, 'warn');
  assert.equal(status.auth, 'ok');
  assert.equal(status.overall, 'warning');
});

test('status summary evaluation derives warnings from observed state, not diagnosis labels', () => {
  const role: Role = {
    name: 'acmedeploy',
    fullName: 'acme-examples',
    email: 'acmedeploy@gmail.com',
    githubUser: 'acmedeploy',
    githubHost: 'github.com-acmedeploy'
  };

  const summary = summarizeAlignment({
    role,
    observedState: {
      commitIdentity: {
        fullName: { value: role.fullName, source: 'local' },
        email: { value: role.email, source: 'local' }
      },
      configuredIdentity: {
        local: { fullName: role.fullName, email: role.email },
        global: {}
      },
      commitEnv: {},
      scope: {
        effective: 'local',
        hasLocalOverride: true
      },
      repository: {
        isInsideWorkTree: true,
        hasCommits: true,
        push: { targets: [{ remote: parseRemoteUrl('origin', 'git@github.com-saraeloop:acmedeploy/gitrole.git'),
          sshAuth: { ok: true, host: 'github.com-saraeloop', githubUser: 'saraeloop' } }] },
        remote: parseRemoteUrl(
          'origin',
          'git@github.com-saraeloop:acmedeploy/gitrole.git'
        )
      },
      sshAuth: {
        ok: true,
        host: 'github.com-saraeloop',
        githubUser: 'saraeloop'
      }
    }
  });

  assert.deepEqual(summary, {
    overall: 'warning',
    commit: 'warn',
    remote: 'warn',
    auth: 'warn',
    policy: 'na'
  });
});

test('status summary evaluation warns outside a git repository without relying on doctor checks', () => {
  const role: Role = {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example'
  };

  const summary = summarizeAlignment({
    role,
    observedState: {
      commitIdentity: {
        fullName: { value: role.fullName, source: 'global' },
        email: { value: role.email, source: 'global' }
      },
      configuredIdentity: {
        local: {},
        global: { fullName: role.fullName, email: role.email }
      },
      commitEnv: {},
      scope: {
        effective: 'global',
        hasLocalOverride: false
      },
      repository: {
        isInsideWorkTree: false
      }
    }
  });

  assert.deepEqual(summary, {
    overall: 'warning',
    commit: 'ok',
    remote: 'na',
    auth: 'na',
    policy: 'na'
  });
});

test('doctor warns on HTTPS with no repo pin and still warns when history is missing', async () => {
  const role: Role = {
    name: 'work',
    fullName: 'Sara Loera',
    email: 'sara@acme.example',
    githubUser: 'acmedeploy'
  };
  const dependencies: DoctorDependencies = {
    roleStore: {
      async list() {
        return [role];
      },
      async get() {
        return role;
      },
      async save() {
        return undefined;
      },
      async remove() {
        return true;
      }
    },
    gitConfig: {
      async getGlobalUserName() {
        return role.fullName;
      },
      async getGlobalUserEmail() {
        return role.email;
      },
      async setGlobalUserName() {
        return undefined;
      },
      async setGlobalUserEmail() {
        return undefined;
      }
    },
    repository: {
      async isInsideWorkTree() {
        return true;
      },
      async hasCommits() {
        return false;
      },
      async getLatestNonMergeCommit() {
        return undefined;
      },
      async getTopLevelPath() {
        return '/tmp/gitrole';
      },
      async getCurrentBranch() {
        return 'main';
      },
      async getUpstreamBranch() {
        return 'origin/main';
      },
      async getOriginUrl() {
        return 'https://github.com/acmedeploy/gitrole.git';
      },
      async getPushDestination() {
        const remote = await this.getOriginRemote();
        return { remoteName: 'origin', targets: remote ? [remote] : [], transport: { supported: true } };
      },
      async getOriginRemote() {
        return getOriginRemote('https://github.com/acmedeploy/gitrole.git');
      },
      async setOriginUrl() {
        return undefined;
      },
      async getLocalUserName() {
        return undefined;
      },
      async getLocalUserEmail() {
        return undefined;
      },
      async setLocalUserName() {
        return undefined;
      },
      async setLocalUserEmail() {
        return undefined;
      }
    },
    sshAuthProbe: {
      async probeGithubUser() {
        throw new Error('should not probe ssh for https remotes');
      }
    }
  };

  const result = await doctor(dependencies);
  const status = await getStatus(dependencies);

  assert.equal(result.repository.remote?.protocol, 'https');
  assert.equal(result.overall, 'warning');
  assert.equal(
    result.checks.some(
      (check) =>
        check.label === 'auth' &&
        check.status === 'warn' &&
        check.message === 'push destination uses HTTPS and no repo pin is configured'
    ),
    true
  );
  assert.equal(result.checks.some((check) => check.label === 'auth' && check.status === 'info'), false);
  assert.equal(status.auth, 'warn');
  assert.equal(status.policy, 'na');
  assert.equal(status.pushAuth, 'HTTPS (no repo pin)');
  assert.equal(
    result.checks.some(
      (check) =>
        check.label === 'history' &&
        check.message.includes('repository has no commits yet')
    ),
    true
  );
});

test('doctor and status stay aligned on HTTPS when identity and repo policy match', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-https-aligned-'));
  const role: Role = {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'alex-dev',
    githubHost: 'github.com'
  };

  await writeFile(
    path.join(tempDir, '.gitrole'),
    JSON.stringify(
      {
        version: 1,
        defaultRole: 'work',
        allowedRoles: ['work']
      },
      null,
      2
    ),
    'utf8'
  );

  const dependencies = createDoctorDependencies(role, {
    topLevelPath: tempDir,
    remoteUrl: 'https://github.com/acme-corp/service.git',
    localIdentity: {
      fullName: role.fullName,
      email: role.email
    }
  });
  dependencies.sshAuthProbe = {
    async probeGithubUser() {
      throw new Error('SSH auth must not be probed for HTTPS origins');
    }
  };

  const result = await doctor(dependencies);
  const status = await getStatus(dependencies);

  assert.equal(result.overall, 'aligned');
  assert.equal(result.checks.some((check) => check.status === 'warn'), false);
  assert.equal(
    result.checks.some((check) => check.label === 'auth' && check.status === 'info'),
    true
  );
  assert.equal(status.overall, 'aligned');
  assert.equal(status.auth, 'na');
  assert.equal(status.policy, 'ok');
  assert.equal(status.commit, 'ok');
  assert.equal(status.remote, 'ok');
  assert.equal(status.pushAuth, 'HTTPS (SSH auth not applicable)');
});

test('HTTPS with no identity pin warns instead of auth=na', async () => {
  const role: Role = {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example'
  };
  const dependencies = createDoctorDependencies(role, {
    remoteUrl: 'https://github.com/acme-corp/service.git',
    localIdentity: {
      fullName: role.fullName,
      email: role.email
    }
  });
  dependencies.sshAuthProbe = {
    async probeGithubUser() {
      throw new Error('SSH auth must not be probed for HTTPS origins');
    }
  };

  const result = await doctor(dependencies);
  const status = await getStatus(dependencies);
  const authCheck = result.checks.find((check) => check.label === 'auth');

  assert.equal(status.auth, 'warn');
  assert.equal(status.policy, 'na');
  assert.equal(status.commit, 'ok');
  assert.equal(status.remote, 'ok');
  assert.equal(status.overall, 'warning');
  assert.equal(status.pushAuth, 'HTTPS (no identity pin)');
  assert.equal(result.overall, 'warning');
  assert.equal(authCheck?.status, 'warn');
  assert.equal(authCheck?.message, 'push destination uses HTTPS and no identity pin is configured');
});

test('HTTPS pin mismatch warns when the active github user is not the pin', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-https-mismatch-'));
  const work: Role = {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'alex-dev'
  };
  const personal: Role = {
    name: 'personal',
    fullName: 'Pat Person',
    email: 'pat@personal.example',
    githubUser: 'thisyearearth'
  };

  await writeFile(
    path.join(tempDir, '.gitrole'),
    JSON.stringify(
      {
        version: 1,
        defaultRole: 'work',
        allowedRoles: ['work']
      },
      null,
      2
    ),
    'utf8'
  );

  const dependencies = createDoctorDependencies(personal, {
    topLevelPath: tempDir,
    remoteUrl: 'https://github.com/acme-corp/service.git',
    roles: [work, personal],
    globalIdentity: {
      fullName: personal.fullName,
      email: personal.email
    }
  });
  dependencies.sshAuthProbe = {
    async probeGithubUser() {
      throw new Error('SSH auth must not be probed for HTTPS origins');
    }
  };

  const result = await doctor(dependencies);
  const status = await getStatus(dependencies);
  const authCheck = result.checks.find((check) => check.label === 'auth');

  assert.equal(status.roleName, 'personal');
  assert.equal(status.auth, 'warn');
  assert.equal(status.policy, 'warn');
  assert.equal(status.commit, 'ok');
  assert.equal(status.remote, 'ok');
  assert.equal(status.overall, 'warning');
  assert.equal(status.pushAuth, 'HTTPS (github user does not match pin)');
  assert.equal(result.overall, 'warning');
  assert.equal(authCheck?.status, 'warn');
  assert.equal(
    authCheck?.message,
    'push destination uses HTTPS; github user thisyearearth does not match pin alex-dev'
  );
});

test('GIT_AUTHOR_EMAIL overrides the configured identity and warns when it matches no role', async () => {
  const role: Role = {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example'
  };
  const dependencies = createDoctorDependencies(role, {
    remoteUrl: 'git@github.com:acme-corp/service.git'
  });
  dependencies.env = {
    GIT_AUTHOR_EMAIL: 'other@example.com'
  };

  const status = await getStatus(dependencies);
  const result = await doctor(dependencies);

  assert.equal(status.roleName, 'no-role');
  assert.equal(status.commit, 'warn');
  assert.equal(status.overall, 'warning');
  assert.match(status.commitIdentity ?? '', /other@example.com/);
  assert.match(status.envNote ?? '', /GIT_AUTHOR_EMAIL other@example.com/);
  assert.equal(result.commitIdentity.email.source, 'env');
  assert.equal(result.commitIdentity.email.value, 'other@example.com');
  assert.equal(
    result.checks.some(
      (check) =>
        check.status === 'warn' &&
        check.message === 'GIT_AUTHOR_EMAIL other@example.com overrides the configured commit email'
    ),
    true
  );
});

test('GIT_COMMITTER_EMAIL warns while the configured author still matches the role', async () => {
  const role: Role = {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example'
  };
  const dependencies = createDoctorDependencies(role, {
    remoteUrl: 'git@github.com:acme-corp/service.git'
  });
  dependencies.env = {
    GIT_COMMITTER_EMAIL: 'other@example.com'
  };

  const status = await getStatus(dependencies);
  const result = await doctor(dependencies);

  assert.equal(status.roleName, 'work');
  assert.equal(status.commit, 'warn');
  assert.equal(status.overall, 'warning');
  assert.match(status.envNote ?? '', /GIT_COMMITTER_EMAIL other@example.com/);
  assert.equal(
    result.checks.some(
      (check) =>
        check.status === 'warn' &&
        check.message === 'GIT_COMMITTER_EMAIL other@example.com overrides the committer email'
    ),
    true
  );
});

test('GIT_AUTHOR_EMAIL that matches the saved role stays aligned and is visible', async () => {
  const role: Role = {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example'
  };
  const dependencies = createDoctorDependencies(role, {
    remoteUrl: 'git@github.com:acme-corp/service.git',
    sshAuth: { ok: true, host: 'github.com', githubUser: 'observed-account' }
  });
  dependencies.env = {
    GIT_AUTHOR_EMAIL: role.email
  };

  const status = await getStatus(dependencies);
  const result = await doctor(dependencies);

  assert.equal(status.roleName, 'work');
  assert.equal(status.commit, 'ok');
  assert.equal(status.overall, 'aligned');
  assert.equal(result.commitIdentity.email.source, 'env');
  assert.equal(
    result.checks.some(
      (check) =>
        check.status === 'info' &&
        check.message === `GIT_AUTHOR_EMAIL ${role.email} sets the commit email`
    ),
    true
  );
  assert.equal(result.checks.some((check) => check.status === 'warn'), false);
});

test('SSH auth stays ok on a match and warn on a githubUser mismatch', async () => {
  const role: Role = {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'alex-dev',
    githubHost: 'github.com-acme-dev'
  };
  const remoteUrl = 'git@github.com-acme-dev:acme-corp/service.git';
  const matched = await getStatus(
    createDoctorDependencies(role, {
      remoteUrl,
      sshAuth: {
        ok: true,
        host: 'github.com-acme-dev',
        githubUser: 'alex-dev'
      }
    })
  );
  const mismatched = await doctor(
    createDoctorDependencies(role, {
      remoteUrl,
      sshAuth: {
        ok: true,
        host: 'github.com-acme-dev',
        githubUser: 'someone-else'
      }
    })
  );
  const mismatchedStatus = await getStatus(
    createDoctorDependencies(role, {
      remoteUrl,
      sshAuth: {
        ok: true,
        host: 'github.com-acme-dev',
        githubUser: 'someone-else'
      }
    })
  );

  assert.equal(matched.auth, 'ok');
  assert.equal(matched.overall, 'aligned');
  assert.equal(matched.policy, 'na');
  assert.equal(mismatched.overall, 'warning');
  assert.equal(
    mismatched.checks.some(
      (check) =>
        check.label === 'auth' &&
        check.status === 'warn' &&
        check.message.includes('expected alex-dev')
    ),
    true
  );
  assert.equal(mismatchedStatus.auth, 'warn');
  assert.equal(mismatchedStatus.overall, 'warning');
});

test('useRemoteForRole rewrites origin to the role host alias', async () => {
  const role: Role = {
    name: 'work',
    fullName: 'Sara Loera',
    email: 'sara@acme.example',
    githubHost: 'github.com-acmedeploy'
  };
  const calls: string[] = [];

  const result = await useRemoteForRole(
    {
      roleStore: {
        async list() {
          return [role];
        },
        async get(name: string) {
          return name === role.name ? role : undefined;
        },
        async save() {
          return undefined;
        },
        async remove() {
          return true;
        }
      },
      repository: {
        async isInsideWorkTree() {
          return true;
        },
        async hasCommits() {
          return true;
        },
        async getLatestNonMergeCommit() {
          return undefined;
        },
        async getTopLevelPath() {
          return '/tmp/gitrole';
        },
        async getCurrentBranch() {
          return 'main';
        },
        async getUpstreamBranch() {
          return 'origin/main';
        },
        async getOriginUrl() {
          return 'git@github.com:acmedeploy/gitrole.git';
        },
        async getPushDestination() {
        const remote = await this.getOriginRemote();
        return { remoteName: 'origin', targets: remote ? [remote] : [], transport: { supported: true } };
      },
      async getOriginRemote() {
          return getOriginRemote('git@github.com:acmedeploy/gitrole.git');
        },
        async setOriginUrl(url: string) {
          calls.push(url);
        },
        async getLocalUserName() {
          return undefined;
        },
        async getLocalUserEmail() {
          return undefined;
        },
        async setLocalUserName() {
          return undefined;
        },
        async setLocalUserEmail() {
          return undefined;
        }
      }
    },
    'work'
  );

  assert.equal(result.nextUrl, 'git@github.com-acmedeploy:acmedeploy/gitrole.git');
  assert.deepEqual(calls, ['git@github.com-acmedeploy:acmedeploy/gitrole.git']);
});

test('doctor adds a fix hint when no saved role matches the active commit identity', async () => {
  const role: Role = {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example',
    githubUser: 'acme-dev'
  };
  const dependencies: DoctorDependencies = {
    roleStore: {
      async list() {
        return [role];
      },
      async get() {
        return role;
      },
      async save() {
        return undefined;
      },
      async remove() {
        return true;
      }
    },
    gitConfig: {
      async getGlobalUserName() {
        return 'Pat Person';
      },
      async getGlobalUserEmail() {
        return 'pat@personal.example';
      },
      async setGlobalUserName() {
        return undefined;
      },
      async setGlobalUserEmail() {
        return undefined;
      }
    },
    repository: {
      async isInsideWorkTree() {
        return true;
      },
      async hasCommits() {
        return true;
      },
      async getLatestNonMergeCommit() {
        return {
          sha: 'abc123',
          authorName: 'Pat Person',
          authorEmail: 'pat@personal.example',
          subject: 'feat: previous personal commit'
        };
      },
      async getTopLevelPath() {
        return '/tmp/gitrole';
      },
      async getCurrentBranch() {
        return 'main';
      },
      async getUpstreamBranch() {
        return 'origin/main';
      },
      async getOriginUrl() {
        return 'git@github.com-acme-dev:acme-dev/gitrole.git';
      },
      async getPushDestination() {
        const remote = await this.getOriginRemote();
        return { remoteName: 'origin', targets: remote ? [remote] : [], transport: { supported: true } };
      },
      async getOriginRemote() {
        return getOriginRemote('git@github.com-acme-dev:acme-dev/gitrole.git');
      },
      async setOriginUrl() {
        return undefined;
      },
      async getLocalUserName() {
        return undefined;
      },
      async getLocalUserEmail() {
        return undefined;
      },
      async setLocalUserName() {
        return undefined;
      },
      async setLocalUserEmail() {
        return undefined;
      }
    },
    sshAuthProbe: {
      async probeGithubUser() {
        return {
          ok: true,
          host: 'github.com-acme-dev',
          githubUser: 'acme-dev'
        };
      }
    }
  };

  const result = await doctor(dependencies);

  assert.equal(result.role, undefined);
  assert.equal(result.overall, 'warning');
  assert.equal(
    result.checks.some(
      (check) =>
        check.label === 'identity' &&
        check.message.includes('SSH auth resolves to acme-dev')
    ),
    true
  );
  assert.equal(
    result.checks.some(
      (check) =>
        check.label === 'fix' &&
        check.message.includes('switch to the intended saved role before committing')
    ),
    true
  );

  const status = await getStatus(dependencies);
  assert.equal(status.roleName, 'no-role');
  assert.equal(status.scope, 'global');
  assert.equal(status.localOverride, false);
  assert.equal(status.lastNonMergeCommit?.authorName, 'Pat Person');
  assert.equal(status.historyNote, undefined);
  assert.equal(status.overall, 'warning');
  assert.equal(status.commit, 'warn');
  assert.equal(status.remote, 'ok');
  assert.equal(status.auth, 'ok');
  assert.equal(
    result.checks.some((check) => check.message.includes('reserved for the status and prompt sentinel')),
    false
  );
});

test('doctor flags a legacy saved role named no-role and still reports status', async () => {
  const role: Role = {
    name: 'no-role',
    fullName: 'Alex Developer',
    email: 'alex@work.example'
  };
  const dependencies = createDoctorDependencies(role);
  const result = await doctor(dependencies);

  assert.equal(result.role?.name, 'no-role');
  assert.equal(result.overall, 'warning');
  assert.equal(
    result.checks.some(
      (check) =>
        check.status === 'warn' &&
        check.label === 'role' &&
        check.message === 'saved role "no-role" is reserved for the status and prompt sentinel'
    ),
    true
  );
  assert.equal(
    result.checks.some(
      (check) =>
        check.status === 'info' &&
        check.label === 'fix' &&
        check.message ===
          'rename saved role "no-role" (Alex Developer <alex@work.example>): gitrole add <name> --name "Alex Developer" --email "alex@work.example", then gitrole remove no-role'
    ),
    true
  );

  const status = await getStatus(dependencies);
  assert.equal(status.roleName, 'no-role');
  assert.equal(status.commit, 'ok');
});

test('doctor flags a stored no-role role that is not the active identity', async () => {
  const reserved: Role = {
    name: 'no-role',
    fullName: 'Old Name',
    email: 'old@example.com'
  };
  const active: Role = {
    name: 'work',
    fullName: 'Alex Developer',
    email: 'alex@work.example'
  };
  const result = await doctor(
    createDoctorDependencies(active, {
      roles: [active, reserved]
    })
  );

  assert.equal(result.role?.name, 'work');
  assert.equal(result.overall, 'warning');
  assert.equal(
    result.checks.some(
      (check) =>
        check.status === 'warn' &&
        check.message === 'saved role "no-role" is reserved for the status and prompt sentinel'
    ),
    true
  );
  assert.equal(
    result.checks.some((check) => check.message.includes('gitrole remove no-role')),
    true
  );
});

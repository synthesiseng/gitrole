#!/usr/bin/env node

/*
 * Defines the gitrole CLI commands and wires them to the application layer.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import { getDoctorExitCode } from './exit-codes.js';
import {
  addRole,
  doctor,
  getStatus,
  getCurrentRole,
  GitNotInstalledError,
  importCurrentRole,
  IncompleteCurrentIdentityError,
  listRoles,
  NotInGitRepositoryError,
  OriginRemoteNotConfiguredError,
  pinRepoPolicy,
  PinRepoPolicyRepositoryContextError,
  ProfileNotFoundError,
  removeRole,
  RoleMissingGithubHostError,
  resolveRepoPolicy,
  UnsupportedRemoteRewriteError,
  useRemoteForRole,
  useRole
} from '../application/use-cases/index.js';
import type { AppDependencies, DoctorDependencies } from '../application/contracts.js';
import {
  RepoPolicyAlreadyExistsError,
  InvalidRepoPolicyError,
  RepoPolicyNotFoundError,
  RepoPolicyRepositoryContextError
} from '../application/repo-policy.js';
import { SystemGitConfig } from '../adapters/git-config.js';
import { SystemGitRepository } from '../adapters/git-repository.js';
import { FileRoleStore } from '../adapters/role-store.js';
import { SystemSshAgent } from '../adapters/ssh-agent.js';
import { SystemSshAuthProbe } from '../adapters/ssh-auth.js';
import {
  renderCurrentRole,
  renderDoctor,
  renderError,
  renderImportedCurrentRole,
  renderPinnedRepoPolicy,
  renderRepoNote,
  renderRemovedRole,
  renderRemoteUse,
  renderRoleList,
  renderSavedRole,
  renderSshNote,
  renderShortStatus,
  renderStatus,
  renderUsedRole
} from '../interface/renderer.js';

interface Output {
  stdout(message: string): void;
  stderr(message: string): void;
}

const output: Output = {
  stdout(message) {
    process.stdout.write(`${message}\n`);
  },
  stderr(message) {
    process.stderr.write(`${message}\n`);
  }
};

/**
 * Creates the concrete runtime dependencies used by the CLI.
 *
 * @remarks
 * The dependency boundary keeps the command layer small and makes the
 * application behavior testable without touching the real filesystem,
 * Git config, or SSH agent.
 */
export function createDependencies(): AppDependencies {
  return {
    roleStore: new FileRoleStore(),
    gitConfig: new SystemGitConfig(),
    sshAgent: new SystemSshAgent()
  };
}

type CliDependencies = AppDependencies & {
  repository: DoctorDependencies['repository'];
  sshAuthProbe: DoctorDependencies['sshAuthProbe'];
};

function createCliDependencies(): CliDependencies {
  return {
    ...createDependencies(),
    repository: new SystemGitRepository(),
    sshAuthProbe: new SystemSshAuthProbe()
  };
}

/**
 * Builds the Commander program and wires each command to its application use case.
 */
export function createProgram(
  dependencies: CliDependencies = createCliDependencies(),
  io: Output = output
): Command {
  const program = new Command();
  let commandExitCode = 0;

  program
    .name('gitrole')
    .description('Manage named git identities and diagnose repo alignment.')
    .version(getPackageVersion())
    .addHelpText(
      'after',
      `

Examples:
  $ gitrole add work --name "Alex Developer" --email "alex@work.example"
  $ gitrole import current --name work
  $ gitrole use work
  $ gitrole use work --local
  $ gitrole pin work
  $ gitrole resolve
  $ gitrole resolve --json
  $ gitrole current
  $ gitrole status
  $ gitrole doctor
  $ gitrole remote set work
`
    );

  program
    .command('add')
    .description('save or update a named role')
    .argument('<name>', 'saved role name')
    .requiredOption('--name <fullName>', 'git user.name value for this role')
    .requiredOption('--email <email>', 'git user.email value for this role')
    .option('--ssh <path>', 'SSH private key to load with ssh-add')
    .option('--github-user <githubUser>', 'expected GitHub user for SSH pushes')
    .option('--github-host <githubHost>', 'expected GitHub SSH host or host alias')
    .addHelpText(
      'after',
      `

Examples:
  $ gitrole add work --name "Alex Developer" --email "alex@work.example"
  $ gitrole add work --name "Alex Developer" --email "alex@work.example" --ssh ~/.ssh/id_work
`
    )
    .action(async (
      name: string,
      options: {
        name: string;
        email: string;
        ssh?: string;
        githubUser?: string;
        githubHost?: string;
      }
    ) => {
      const role = await addRole(dependencies, {
        name,
        fullName: options.name,
        email: options.email,
        sshKeyPath: options.ssh,
        githubUser: options.githubUser,
        githubHost: options.githubHost
      });

      io.stdout(renderSavedRole(role));
    });

  program
    .command('use')
    .description('apply a saved role globally or to the current repo')
    .argument('<name>', 'saved role name')
    .option('--global', 'apply the role to global Git config (default)')
    .option('--local', 'apply the role to repository-local Git config')
    .addHelpText(
      'after',
      `

Scope:
  no flag / --global  apply the role to global Git config
  --local             apply the role only to the current repository; requires a git repo

Notes:
  If the role defines an SSH key, gitrole still loads it with ssh-add.
  If repo alignment issues are detected after the switch, gitrole prints a repo note.

Examples:
  $ gitrole use work
  $ gitrole use work --global
  $ gitrole use work --local
`
    )
    .action(async (name: string, options: { global?: boolean; local?: boolean }) => {
      if (options.global && options.local) {
        throw new Error('choose only one of --global or --local');
      }

      const scope = options.local ? 'local' : 'global';
      const result = await useRole(dependencies, name, { scope });
      io.stdout(renderUsedRole(result));

      if (result.ssh && !result.ssh.ok && result.ssh.message) {
        io.stdout(renderSshNote(result.ssh.message));
      }

      if (result.alignment?.checks.some((check) => check.status === 'warn')) {
        io.stdout(renderRepoNote());
      }
    });

  const importCommand = program
    .command('import')
    .description('import a role from the current effective Git identity')
    .addHelpText(
      'after',
      `

Examples:
  $ gitrole import current --name work
`
    );

  importCommand
    .command('current')
    .description('save the effective current commit identity as a named role')
    .requiredOption('--name <role>', 'saved role name')
    .addHelpText(
      'after',
      `

Behavior:
  - reads the effective current commit identity
  - uses repo-local identity when a local override is active
  - otherwise uses the global identity
  - saves only name and email; it does not infer SSH or GitHub settings

Example:
  $ gitrole import current --name work
`
    )
    .action(async (options: { name: string }) => {
      const result = await importCurrentRole(dependencies, options.name);
      io.stdout(renderImportedCurrentRole(result));
    });

  program
    .command('pin')
    .description('create a strict repo-local .gitrole policy for one role')
    .argument('<role>', 'saved role name')
    .addHelpText(
      'after',
      `

Behavior:
  - creates a new ${'.gitrole'} file in the repository root
  - sets defaultRole and allowedRoles to the selected role only
  - fails if ${'.gitrole'} already exists; it does not merge or overwrite policy

Examples:
  $ gitrole pin work
`
    )
    .action(async (role: string) => {
      const result = await pinRepoPolicy({
        roleStore: dependencies.roleStore,
        repository: dependencies.repository
      }, role);
      io.stdout(renderPinnedRepoPolicy(result));
    });

  program
    .command('resolve')
    .description('print the repo-local default role from .gitrole')
    .option('--json', 'write the repo policy as JSON')
    .addHelpText(
      'after',
      `

Repo policy:
  Reads the repository-local ${'.gitrole'} file and prints the configured defaultRole.
  This is identity policy only. It does not switch roles or enforce hooks.

Example:
  $ gitrole resolve
  $ gitrole resolve --json
`
    )
    .action(async (options: { json?: boolean }) => {
      const repoPolicy = await resolveRepoPolicy({
        repository: dependencies.repository
      });
      io.stdout(options.json ? JSON.stringify(repoPolicy, null, 2) : repoPolicy.defaultRole);
    });

  program
    .command('current')
    .description('show which saved role matches the active commit identity')
    .addHelpText(
      'after',
      `

Use this when you want to know which saved role is active here.
Use 'gitrole status' when you want to know whether the repo is ready to commit or push.

Examples:
  $ gitrole current
`
    )
    .action(async () => {
      const result = await getCurrentRole(dependencies);
      io.stdout(renderCurrentRole(result));
    });

  program.command('list').description('list saved roles and mark the active one').action(async () => {
    const result = await listRoles(dependencies);
    io.stdout(renderRoleList(result));
  });

  program
    .command('status')
    .description('check whether the current repo is aligned for commit and push')
    .option('--short', 'show machine-friendly one-line status output')
    .option('--offline', 'skip the live SSH githubUser probe and use local checks only')
    .addHelpText(
      'after',
      `

Views:
  default   compact human-readable summary
  --short    stable one-line format for scripts, prompts, and automation
  --offline  skip the live SSH githubUser probe

--short fields, in order:
  role scope override commit remote auth policy overall

--offline keeps local checks: commit identity, env overrides, fresh-repo state,
remote host, the HTTPS pin check, and .gitrole policy.
SSH auth is na. That na does not by itself set overall=warning.
HTTPS auth is unchanged, because it uses the saved role and .gitrole, not the network.

Use this when you want to know whether the repo looks ready to commit or push.
Use 'gitrole current' when you only want to know which saved role matches the active commit identity.
Use 'gitrole status --short --offline' for a shell prompt. It does not open SSH.

Policy:
  status warns only on actionable mismatches.
  Observed context alone does not degrade the overall result.
  policy is ok, warn, or na. na means no .gitrole file is present.
  HTTPS origins report auth=na only when a repo pin allows the active role and that role has a githubUser.
  No pin or a github user mismatch is auth=warn.
  SSH githubUser checks apply only to SSH remotes, and only without --offline.

Examples:
  $ gitrole status
  $ gitrole status --short
  $ gitrole status --short --offline

Shell prompt:
  Snippets run 'gitrole status --short --offline' and print a segment. There is no auth cache.
  gitrole:<role> ✓ means commit and policy are ok and auth was not checked.
  It does not mean network auth was verified. auth=na is a skipped SSH probe, not a green auth check.
  gitrole:<role> ⚠ means a local offline field is warn.
  It is opt-in. It does not switch roles.
`
    )
    .action(async (options: { short?: boolean; offline?: boolean }) => {
      const result = await getStatus(dependencies, { offline: options.offline === true });
      io.stdout(options.short ? renderShortStatus(result) : renderStatus(result));
      commandExitCode = result.overall === 'aligned' ? 0 : 2;
    });

  program
    .command('doctor')
    .description('diagnose identity, remote, and SSH auth alignment')
    .option('--json', 'write the diagnostic result as JSON')
    .addHelpText(
      'after',
      `

Checks:
  - effective git identity
  - repository context and branch
  - origin remote configuration
  - SSH auth alignment for SSH remotes

Policy:
  gitrole warns on violated expectations, not assumptions.
  githubUser checks SSH auth. githubHost checks the remote host.
  Remote owner/repository is context, not a warning by default.
  HTTPS origins record auth as info only when a repo pin allows the active role and that role has a githubUser.
  No pin or a github user mismatch warns.

Example:
  $ gitrole doctor
  $ gitrole doctor --json
`
    )
    .action(async (options: { json?: boolean }) => {
      const result = await doctor(dependencies);
      io.stdout(options.json ? JSON.stringify(result, null, 2) : renderDoctor(result));
      commandExitCode = getDoctorExitCode(result);
    });

  const remoteCommand = program
    .command('remote')
    .description('manage repository remotes for a selected role')
    .addHelpText(
      'after',
      `

Use 'gitrole remote set <role>' when the current origin host alias is wrong
for the selected role.
`
    );

  remoteCommand
    .command('set')
    .description("rewrite origin to the role's GitHub host alias")
    .argument('<name>', 'saved role name')
    .addHelpText(
      'after',
      `

Behavior:
  - rewrites the origin host to the role's configured GitHub host alias
  - preserves the observed owner/repository slug
  - intended for SSH remotes

Example:
  $ gitrole remote set work
`
    )
    .action(async (name: string) => {
      const result = await useRemoteForRole(dependencies, name);
      io.stdout(renderRemoteUse(result));
    });

  program
    .command('remove')
    .description('remove a saved role')
    .argument('<name>', 'saved role name')
    .action(async (name: string) => {
      const role = await removeRole(dependencies, name);
      io.stdout(renderRemovedRole(role));
    });

  Reflect.set(program, '__gitroleExitCode', () => commandExitCode);

  return program;
}

function getPackageVersion(): string {
  for (const relativePath of ['../../package.json', '../../../package.json']) {
    try {
      const packageJson = JSON.parse(
        readFileSync(new URL(relativePath, import.meta.url), 'utf8')
      ) as { version?: string };

      if (packageJson.version) {
        return packageJson.version;
      }
    } catch {
      continue;
    }
  }

  return '0.0.0';
}

/**
 * Runs the CLI against the provided argv vector and returns a process exit code.
 *
 * @remarks
 * Success paths return `0`. Operational failures print a user-facing error to
 * stderr and return `1`.
 */
export async function run(argv = process.argv): Promise<number> {
  const program = createProgram();

  try {
    await program.parseAsync(argv);
    const getExitCode = Reflect.get(program, '__gitroleExitCode') as (() => number) | undefined;
    return getExitCode ? getExitCode() : 0;
  } catch (error) {
    output.stderr(renderError(formatError(error)));
    return 1;
  }
}

function formatError(error: unknown): string {
  if (
    error instanceof ProfileNotFoundError ||
    error instanceof GitNotInstalledError ||
    error instanceof IncompleteCurrentIdentityError ||
    error instanceof NotInGitRepositoryError ||
    error instanceof PinRepoPolicyRepositoryContextError ||
    error instanceof RepoPolicyRepositoryContextError ||
    error instanceof RepoPolicyNotFoundError ||
    error instanceof RepoPolicyAlreadyExistsError ||
    error instanceof InvalidRepoPolicyError ||
    error instanceof RoleMissingGithubHostError ||
    error instanceof OriginRemoteNotConfiguredError ||
    error instanceof UnsupportedRemoteRewriteError
  ) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'unknown error';
}

const isEntrypoint = isDirectExecution(import.meta.url, process.argv[1]);

if (isEntrypoint) {
  run().then((code) => {
    process.exitCode = code;
  });
}

function isDirectExecution(moduleUrl: string, argvEntry?: string): boolean {
  if (!argvEntry) {
    return false;
  }

  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvEntry);
  } catch {
    return false;
  }
}

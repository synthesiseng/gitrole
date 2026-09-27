/*
 * Exercises the CLI surface, help text, and process behavior end to end.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.NO_COLOR = '1';
process.env.FORCE_COLOR = '0';

const cliPath = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));
const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));
const readmePath = fileURLToPath(new URL('../../README.md', import.meta.url));

function runGit(args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 0, result.stderr);
}

async function initRealRepo(prefix: string): Promise<string> {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const initResult = spawnSync('git', ['init', '-b', 'main'], {
    cwd: repoDir,
    encoding: 'utf8'
  });

  if (initResult.status !== 0) {
    runGit(['init'], repoDir);
    runGit(['branch', '-M', 'main'], repoDir);
  }

  return repoDir;
}

async function writeRepoPolicy(repoDir: string, policy: unknown): Promise<void> {
  await writeFile(
    path.join(repoDir, '.gitrole'),
    `${JSON.stringify(policy, null, 2)}\n`,
    'utf8'
  );
}

function assertPolicyRoleNameFailure(
  result: { status: number | null; stdout: string; stderr: string },
  field: 'defaultRole' | 'allowedRoles',
  roleName: string
) {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    new RegExp(`error: repo policy file \\.gitrole is invalid: ${field} `)
  );
  assert.match(
    result.stderr,
    new RegExp(`invalid role name "${roleName}"; use lowercase letters, numbers, "-" or "_"`)
  );
}

async function assertPolicyCommandsRejectRoleName(
  repoDir: string,
  env: NodeJS.ProcessEnv,
  field: 'defaultRole' | 'allowedRoles',
  roleName: string
) {
  for (const args of [
    ['resolve'],
    ['resolve', '--json'],
    ['status'],
    ['doctor'],
    ['doctor', '--json']
  ] as const) {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      cwd: repoDir,
      encoding: 'utf8',
      env
    });

    assertPolicyRoleNameFailure(result, field, roleName);
  }
}

test('cli help text includes the primary commands', () => {
  const result = spawnSync(process.execPath, [cliPath, '--help'], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /add \[options\] <name>/);
  assert.match(result.stdout, /current\s+show which saved role matches the active commit identity/);
  assert.match(result.stdout, /doctor/);
  assert.match(result.stdout, /resolve/);
  assert.match(result.stdout, /remote/);
  assert.match(result.stdout, /status/);
  assert.match(result.stdout, /use \[options\] <name>/);
  assert.doesNotMatch(result.stdout, /\bverify\b/);
  assert.match(result.stdout, /gitrole remote set work/);
  assert.doesNotMatch(result.stdout, /current --verbose/);
  assert.equal(result.stderr, '');
});

test('cli version output matches package metadata', async () => {
  const result = spawnSync(process.execPath, [cliPath, '--version'], {
    encoding: 'utf8'
  });
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version: string };

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), packageJson.version);
  assert.equal(result.stderr, '');
});

test('readme command surface matches the implemented CLI surface', async () => {
  const readme = await readFile(readmePath, 'utf8');

  assert.match(readme, /`gitrole import current --name <role>`/);
  assert.match(readme, /`gitrole pin <role>`/);
  assert.match(readme, /`gitrole current`/);
  assert.match(readme, /`gitrole resolve`/);
  assert.match(readme, /`gitrole resolve --json`/);
  assert.match(readme, /`gitrole status --short`/);
  assert.match(readme, /`gitrole doctor --json`/);
  assert.match(readme, /`gitrole remote set <name>`/);
  assert.match(readme, /warns on violated expectations, not assumptions/i);
  assert.doesNotMatch(readme, /`gitrole current --verbose`/);
  assert.doesNotMatch(readme, /`gitrole verify`/);
  assert.doesNotMatch(readme, /`gitrole remote use <name>`/);
});

test('cli remote help exposes set and removes use', () => {
  const result = spawnSync(process.execPath, [cliPath, 'remote', '--help'], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /set <name>/);
  assert.doesNotMatch(result.stdout, /\buse <name>\b/);
  assert.equal(result.stderr, '');
});

test('cli import help exposes current', () => {
  const result = spawnSync(process.execPath, [cliPath, 'import', '--help'], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /current/);
  assert.equal(result.stderr, '');
});

test('cli import current saves the effective identity as a role and reports scope', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-import-current-'));
  const configHome = path.join(tempDir, 'config');
  const repoDir = await initRealRepo('gitrole-cli-import-current-repo-');
  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome
  };

  runGit(['config', '--global', 'user.name', 'Pat Person'], repoDir, env);
  runGit(['config', '--global', 'user.email', 'pat@personal.example'], repoDir, env);
  runGit(['config', '--local', 'user.name', 'Alex Developer'], repoDir, env);
  runGit(['config', '--local', 'user.email', 'alex@work.example'], repoDir, env);

  const result = spawnSync(
    process.execPath,
    [cliPath, 'import', 'current', '--name', 'work'],
    {
      cwd: repoDir,
      encoding: 'utf8',
      env
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /imported current identity as\s+work/);
  assert.match(result.stdout, /commit\s+Alex Developer <alex@work.example>/);
  assert.match(result.stdout, /scope\s+local/);
  assert.equal(result.stderr, '');

  const listResult = spawnSync(process.execPath, [cliPath, 'list'], {
    cwd: repoDir,
    encoding: 'utf8',
    env
  });
  assert.equal(listResult.status, 0);
  assert.match(listResult.stdout, /work/);
  assert.match(listResult.stdout, /Alex Developer <alex@work.example>/);
});

test('cli import current uses the effective global identity when no local override exists', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-import-global-'));
  const configHome = path.join(tempDir, 'config');
  const repoDir = await initRealRepo('gitrole-cli-import-global-repo-');
  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome
  };

  runGit(['config', '--global', 'user.name', 'Alex Developer'], repoDir, env);
  runGit(['config', '--global', 'user.email', 'alex@work.example'], repoDir, env);

  const result = spawnSync(
    process.execPath,
    [cliPath, 'import', 'current', '--name', 'work'],
    {
      cwd: repoDir,
      encoding: 'utf8',
      env
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /scope\s+global/);
  assert.equal(result.stderr, '');
});

test('cli import current fails when the current identity is incomplete', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-import-incomplete-'));
  const configHome = path.join(tempDir, 'config');
  const repoDir = await initRealRepo('gitrole-cli-import-incomplete-repo-');
  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome
  };

  runGit(['config', '--global', 'user.name', 'Alex Developer'], repoDir, env);

  const result = spawnSync(
    process.execPath,
    [cliPath, 'import', 'current', '--name', 'work'],
    {
      cwd: repoDir,
      encoding: 'utf8',
      env
    }
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /error: current commit identity is incomplete; user\.name and user\.email must both be configured/
  );
});

test('cli add rejects invalid role names with a clear error', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-add-invalid-role-'));
  const configHome = path.join(tempDir, 'config');
  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome
  };

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      'add',
      'client acme',
      '--name',
      'Alex Developer',
      '--email',
      'alex@work.example'
    ],
    {
      encoding: 'utf8',
      env
    }
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /error: invalid role name "client acme"; use lowercase letters, numbers, "-" or "_"/
  );
});

test('cli import current rejects invalid role names with the same clear error', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-import-invalid-role-'));
  const configHome = path.join(tempDir, 'config');
  const repoDir = await initRealRepo('gitrole-cli-import-invalid-role-repo-');
  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome
  };

  runGit(['config', '--global', 'user.name', 'Alex Developer'], repoDir, env);
  runGit(['config', '--global', 'user.email', 'alex@work.example'], repoDir, env);

  const result = spawnSync(
    process.execPath,
    [cliPath, 'import', 'current', '--name', 'client acme'],
    {
      cwd: repoDir,
      encoding: 'utf8',
      env
    }
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /error: invalid role name "client acme"; use lowercase letters, numbers, "-" or "_"/
  );
});

test('cli add rejects the reserved role name no-role and leaves a legacy role in place', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-add-reserved-role-'));
  const configHome = path.join(tempDir, 'config');
  const rolesFile = path.join(configHome, 'gitrole', 'roles.json');
  const legacy = `${JSON.stringify(
    {
      roles: [
        {
          name: 'no-role',
          fullName: 'Alex Developer',
          email: 'alex@work.example'
        }
      ]
    },
    null,
    2
  )}\n`;
  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome
  };

  await mkdir(path.dirname(rolesFile), { recursive: true });
  await writeFile(rolesFile, legacy, 'utf8');

  const result = spawnSync(
    process.execPath,
    [cliPath, 'add', 'no-role', '--name', 'Alex Developer', '--email', 'alex@work.example'],
    {
      encoding: 'utf8',
      env
    }
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /error: role name "no-role" is reserved for the status and prompt sentinel when no saved role matches; choose a different name/
  );
  assert.doesNotMatch(result.stderr, /invalid role name/);
  assert.equal(await readFile(rolesFile, 'utf8'), legacy);
});

test('cli import current rejects the reserved role name no-role', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-import-reserved-role-'));
  const configHome = path.join(tempDir, 'config');
  const repoDir = await initRealRepo('gitrole-cli-import-reserved-role-repo-');
  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome
  };

  runGit(['config', '--global', 'user.name', 'Alex Developer'], repoDir, env);
  runGit(['config', '--global', 'user.email', 'alex@work.example'], repoDir, env);

  const result = spawnSync(
    process.execPath,
    [cliPath, 'import', 'current', '--name', 'no-role'],
    {
      cwd: repoDir,
      encoding: 'utf8',
      env
    }
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /error: role name "no-role" is reserved for the status and prompt sentinel when no saved role matches; choose a different name/
  );
  await assert.rejects(() => readFile(path.join(configHome, 'gitrole', 'roles.json'), 'utf8'));
});

test('cli doctor flags a legacy saved role named no-role and status still prints', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-doctor-reserved-role-'));
  const configHome = path.join(tempDir, 'config');
  const repoDir = await initRealRepo('gitrole-cli-doctor-reserved-role-repo-');
  const rolesFile = path.join(configHome, 'gitrole', 'roles.json');
  const legacy = `${JSON.stringify(
    {
      roles: [
        {
          name: 'no-role',
          fullName: 'Alex Developer',
          email: 'alex@work.example'
        }
      ]
    },
    null,
    2
  )}\n`;
  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome
  };

  await mkdir(path.dirname(rolesFile), { recursive: true });
  await writeFile(rolesFile, legacy, 'utf8');
  runGit(['config', '--global', 'user.name', 'Alex Developer'], repoDir, env);
  runGit(['config', '--global', 'user.email', 'alex@work.example'], repoDir, env);

  const doctorResult = spawnSync(process.execPath, [cliPath, 'doctor', '--json'], {
    cwd: repoDir,
    encoding: 'utf8',
    env
  });
  const diagnosis = JSON.parse(doctorResult.stdout) as {
    overall: string;
    role?: { name: string };
    checks: Array<{ status: string; label: string; message: string }>;
  };

  assert.equal(doctorResult.status, 2);
  assert.equal(doctorResult.stderr, '');
  assert.equal(diagnosis.overall, 'warning');
  assert.equal(diagnosis.role?.name, 'no-role');
  assert.equal(
    diagnosis.checks.some(
      (check) =>
        check.status === 'warn' &&
        check.label === 'role' &&
        check.message === 'saved role "no-role" is reserved for the status and prompt sentinel'
    ),
    true
  );
  assert.equal(
    diagnosis.checks.some(
      (check) => check.status === 'info' && check.label === 'fix' && check.message.includes('gitrole remove no-role')
    ),
    true
  );
  assert.equal(await readFile(rolesFile, 'utf8'), legacy);

  const statusResult = spawnSync(process.execPath, [cliPath, 'status', '--short', '--offline'], {
    cwd: repoDir,
    encoding: 'utf8',
    env
  });

  assert.notEqual(statusResult.status, 1);
  assert.equal(statusResult.stderr, '');
  assert.match(statusResult.stdout, /^role=no-role /);

  const removeResult = spawnSync(process.execPath, [cliPath, 'remove', 'no-role'], {
    cwd: repoDir,
    encoding: 'utf8',
    env
  });

  assert.equal(removeResult.status, 0);
  assert.match(removeResult.stdout, /removed\s+no-role/);
  assert.equal(removeResult.stderr, '');
  assert.doesNotMatch(await readFile(rolesFile, 'utf8'), /"name": "no-role"/);
});

test('cli pin rejects fixture invalid-role-name-spaces before writing .gitrole', async () => {
  const repoDir = await initRealRepo('gitrole-cli-pin-invalid-role-name-spaces-');
  const result = spawnSync(process.execPath, [cliPath, 'pin', 'client acme'], {
    cwd: repoDir,
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /error: invalid role name "client acme"; use lowercase letters, numbers, "-" or "_"/
  );
  await assert.rejects(() => readFile(path.join(repoDir, '.gitrole'), 'utf8'));
});

test('cli import current fails clearly when git is unavailable', () => {
  const env = {
    ...process.env,
    GITROLE_GIT_BIN: path.join(os.tmpdir(), 'does-not-exist-gitrole-git')
  };

  const result = spawnSync(
    process.execPath,
    [cliPath, 'import', 'current', '--name', 'work'],
    {
      encoding: 'utf8',
      env
    }
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /error: git is not installed or not available on PATH/);
});

test('cli doctor and status help describe the warning policy', () => {
  const doctorHelp = spawnSync(process.execPath, [cliPath, 'doctor', '--help'], {
    encoding: 'utf8'
  });
  const statusHelp = spawnSync(process.execPath, [cliPath, 'status', '--help'], {
    encoding: 'utf8'
  });

  assert.equal(doctorHelp.status, 0);
  assert.match(doctorHelp.stdout, /warns on violated expectations, not assumptions/i);
  assert.match(doctorHelp.stdout, /Remote owner\/repository is context, not a warning by default/i);
  assert.match(
    doctorHelp.stdout,
    /HTTPS origins record auth as info only when a repo pin allows the active role and that role has a githubUser/i
  );
  assert.match(doctorHelp.stdout, /No pin or a github user mismatch warns/i);

  assert.equal(statusHelp.status, 0);
  assert.match(statusHelp.stdout, /status warns only on actionable mismatches/i);
  assert.match(statusHelp.stdout, /Observed context alone does not degrade the overall result/i);
  assert.match(statusHelp.stdout, /role scope override commit remote auth policy overall/);
  assert.match(
    statusHelp.stdout,
    /HTTPS origins report auth=na only when a repo pin allows the active role and that role has a githubUser/i
  );
  assert.match(statusHelp.stdout, /No pin or a github user mismatch is auth=warn/i);
});

test('cli resolve help describes repo-local policy', () => {
  const result = spawnSync(process.execPath, [cliPath, 'resolve', '--help'], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /repository-local \.gitrole file/i);
  assert.match(result.stdout, /prints the configured defaultRole/i);
  assert.match(result.stdout, /gitrole resolve --json/);
  assert.equal(result.stderr, '');
});

test('cli pin help describes strict repo-local policy creation', () => {
  const result = spawnSync(process.execPath, [cliPath, 'pin', '--help'], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /creates a new \.gitrole file/i);
  assert.match(result.stdout, /does not merge or overwrite policy/i);
  assert.equal(result.stderr, '');
});

test('cli routes add and list commands through the configured storage', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-'));
  const configHome = path.join(tempDir, 'config');
  const gitStubPath = path.join(tempDir, 'git-stub.mjs');

  await writeFile(
    gitStubPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'config' && args[2] === '--get') {
  process.exit(1);
}
process.exit(0);
`,
    'utf8'
  );
  await chmod(gitStubPath, 0o755);

  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome,
    GITROLE_GIT_BIN: gitStubPath
  };

  const addResult = spawnSync(
    process.execPath,
    [
      cliPath,
      'add',
      'sara',
      '--name',
      'Sara Loera',
      '--email',
      'sara@example.com',
      '--github-user',
      'acmedeploy',
      '--github-host',
      'github.com-acmedeploy'
    ],
    { encoding: 'utf8', env }
  );

  assert.equal(addResult.status, 0);
  assert.match(addResult.stdout, /saved/);

  const listResult = spawnSync(process.execPath, [cliPath, 'list'], {
    encoding: 'utf8',
    env
  });

  assert.equal(listResult.status, 0);
  assert.match(listResult.stdout, /sara/);

  const rolesFile = await readFile(
    path.join(configHome, 'gitrole', 'roles.json'),
    'utf8'
  );

  assert.match(rolesFile, /"name": "sara"/);
  assert.match(rolesFile, /"githubUser": "acmedeploy"/);
  assert.match(rolesFile, /"githubHost": "github.com-acmedeploy"/);
});

test('cli doctor exits with code 2 when warnings are present', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-doctor-'));
  const configHome = path.join(tempDir, 'config');
  const gitStubPath = path.join(tempDir, 'git-stub.mjs');

  await writeFile(
    gitStubPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'config' && args[2] === '--get') {
  process.exit(1);
}
if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
  process.stdout.write('false\\n');
  process.exit(0);
}
process.exit(1);
`,
    'utf8'
  );
  await chmod(gitStubPath, 0o755);

  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome,
    GITROLE_GIT_BIN: gitStubPath
  };

  const result = spawnSync(process.execPath, [cliPath, 'doctor'], {
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 2);
  assert.match(result.stdout, /doctor/);
  assert.doesNotMatch(result.stdout, /^\s*\{/);
  assert.equal(result.stderr, '');
});

test('cli doctor --json emits valid JSON and exits 0 when aligned', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-doctor-json-ok-'));
  const configHome = path.join(tempDir, 'config');
  const gitStubPath = path.join(tempDir, 'git-stub.mjs');
  const sshStubPath = path.join(tempDir, 'ssh-stub.mjs');

  await writeFile(
    gitStubPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.name') {
  process.stdout.write('Alex Developer\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.email') {
  process.stdout.write('alex@work.example\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--local' && args[2] === '--get') {
  process.exit(1);
}
if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
  process.stdout.write('true\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--verify') {
  process.stdout.write('abcdef0\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
  process.stdout.write('${tempDir.replaceAll("'", "'\\''")}\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args.includes('@{upstream}')) {
  process.stdout.write('origin/main\\n');
  process.exit(0);
}
if (args[0] === 'branch' && args[1] === '--show-current') {
  process.stdout.write('main\\n');
  process.exit(0);
}
if (args[0] === 'log' && args[1] === '--no-merges') {
  process.stdout.write('old123\\u001fPat Person\\u001fpat@personal.example\\u001fchore: previous personal commit\\n');
  process.exit(0);
}
if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
  process.stdout.write('git@github.com-acme-dev:acme-dev/gitrole.git\\n');
  process.exit(0);
}
process.exit(1);
`,
    'utf8'
  );
  await chmod(gitStubPath, 0o755);
  await writeFile(
    sshStubPath,
    `#!/usr/bin/env node
process.stderr.write("Hi acme-dev! You've successfully authenticated, but GitHub does not provide shell access.\\n");
process.exit(1);
`,
    'utf8'
  );
  await chmod(sshStubPath, 0o755);
  await mkdir(path.join(configHome, 'gitrole'), { recursive: true });
  await writeFile(
    path.join(configHome, 'gitrole', 'roles.json'),
    JSON.stringify(
      {
        roles: [
          {
            name: 'work',
            fullName: 'Alex Developer',
            email: 'alex@work.example',
            githubUser: 'acme-dev',
            githubHost: 'github.com-acme-dev'
          }
        ]
      },
      null,
      2
    ),
    'utf8'
  );

  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome,
    GITROLE_GIT_BIN: gitStubPath,
    GITROLE_SSH_BIN: sshStubPath
  };

  const result = spawnSync(process.execPath, [cliPath, 'doctor', '--json'], {
    encoding: 'utf8',
    env
  });
  const parsed = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(parsed.overall, 'aligned');
  assert.equal(parsed.role.name, 'work');
  assert.equal(parsed.repository.remote.host, 'github.com-acme-dev');
  assert.equal(parsed.sshAuth.githubUser, 'acme-dev');
});

test('cli doctor --json stays aligned when remote owner differs from the auth user', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-doctor-json-org-'));
  const configHome = path.join(tempDir, 'config');
  const gitStubPath = path.join(tempDir, 'git-stub.mjs');
  const sshStubPath = path.join(tempDir, 'ssh-stub.mjs');

  await writeFile(
    gitStubPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.name') {
  process.stdout.write('Alex Developer\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.email') {
  process.stdout.write('alex@personal.example\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--local' && args[2] === '--get') {
  process.exit(1);
}
if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
  process.stdout.write('true\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--verify') {
  process.stdout.write('abcdef0\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
  process.stdout.write('${tempDir.replaceAll("'", "'\\''")}\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args.includes('@{upstream}')) {
  process.stdout.write('origin/main\\n');
  process.exit(0);
}
if (args[0] === 'branch' && args[1] === '--show-current') {
  process.stdout.write('main\\n');
  process.exit(0);
}
if (args[0] === 'log' && args[1] === '--no-merges') {
  process.stdout.write('abc123\\u001fAlex Developer\\u001falex@personal.example\\u001ffeat: aligned personal commit\\n');
  process.exit(0);
}
if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
  process.stdout.write('git@github.com-personal:acme-org/gitrole.git\\n');
  process.exit(0);
}
process.exit(1);
`,
    'utf8'
  );
  await chmod(gitStubPath, 0o755);
  await writeFile(
    sshStubPath,
    `#!/usr/bin/env node
process.stderr.write("Hi alex-dev! You've successfully authenticated, but GitHub does not provide shell access.\\n");
process.exit(1);
`,
    'utf8'
  );
  await chmod(sshStubPath, 0o755);
  await mkdir(path.join(configHome, 'gitrole'), { recursive: true });
  await writeFile(
    path.join(configHome, 'gitrole', 'roles.json'),
    JSON.stringify(
      {
        roles: [
          {
            name: 'personal',
            fullName: 'Alex Developer',
            email: 'alex@personal.example',
            githubUser: 'alex-dev',
            githubHost: 'github.com-personal'
          }
        ]
      },
      null,
      2
    ),
    'utf8'
  );

  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome,
    GITROLE_GIT_BIN: gitStubPath,
    GITROLE_SSH_BIN: sshStubPath
  };

  const result = spawnSync(process.execPath, [cliPath, 'doctor', '--json'], {
    encoding: 'utf8',
    env
  });
  const parsed = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(parsed.overall, 'aligned');
  assert.equal(parsed.repository.remote.owner, 'acme-org');
  assert.equal(parsed.checks.some((check: { label: string }) => check.label === 'owner'), false);
  assert.equal(result.stderr, '');
});

test('cli doctor --json emits valid JSON and exits 2 when warnings are present', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-doctor-json-warn-'));
  const configHome = path.join(tempDir, 'config');
  const gitStubPath = path.join(tempDir, 'git-stub.mjs');

  await writeFile(
    gitStubPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'config' && args[2] === '--get') {
  process.exit(1);
}
if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
  process.stdout.write('false\\n');
  process.exit(0);
}
process.exit(1);
`,
    'utf8'
  );
  await chmod(gitStubPath, 0o755);

  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome,
    GITROLE_GIT_BIN: gitStubPath
  };

  const result = spawnSync(process.execPath, [cliPath, 'doctor', '--json'], {
    encoding: 'utf8',
    env
  });
  const parsed = JSON.parse(result.stdout);

  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  assert.equal(parsed.overall, 'warning');
  assert.equal(parsed.repository.isInsideWorkTree, false);
  assert.equal(Array.isArray(parsed.checks), true);
  assert.equal(parsed.checks.some((check: { status: string }) => check.status === 'warn'), true);
});

test('cli doctor --json exits 1 on operational failure and keeps stdout empty', () => {
  const env = {
    ...process.env,
    GITROLE_GIT_BIN: path.join(os.tmpdir(), 'does-not-exist-gitrole-git')
  };

  const result = spawnSync(process.execPath, [cliPath, 'doctor', '--json'], {
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /error: git is not installed or not available on PATH/);
});

test('cli resolve returns the repo default role from .gitrole', async () => {
  const repoDir = await initRealRepo('gitrole-cli-resolve-ok-');

  await writeFile(
    path.join(repoDir, '.gitrole'),
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

  const result = spawnSync(process.execPath, [cliPath, 'resolve'], {
    cwd: repoDir,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'acmedeploy');
  assert.equal(result.stderr, '');
});

test('cli resolve --json emits valid JSON matching the repo policy', async () => {
  const repoDir = await initRealRepo('gitrole-cli-resolve-json-ok-');

  await writeFile(
    path.join(repoDir, '.gitrole'),
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

  const result = spawnSync(process.execPath, [cliPath, 'resolve', '--json'], {
    cwd: repoDir,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    version: 1,
    defaultRole: 'acmedeploy',
    allowedRoles: ['acmedeploy', 'saraeloop']
  });
});

test('cli resolve fails outside a git repository', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-resolve-outside-'));
  const result = spawnSync(process.execPath, [cliPath, 'resolve'], {
    cwd: tempDir,
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /error: not inside a git repository; resolve requires a repo context/);
});

test('cli resolve fails when .gitrole is missing', async () => {
  const repoDir = await initRealRepo('gitrole-cli-resolve-missing-');
  const result = spawnSync(process.execPath, [cliPath, 'resolve'], {
    cwd: repoDir,
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /error: repo policy file \.gitrole was not found in the repository root/);
});

test('cli resolve fails when .gitrole contains invalid JSON', async () => {
  const repoDir = await initRealRepo('gitrole-cli-resolve-json-');

  await writeFile(path.join(repoDir, '.gitrole'), '{bad-json', 'utf8');

  const result = spawnSync(process.execPath, [cliPath, 'resolve'], {
    cwd: repoDir,
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /error: repo policy file \.gitrole is invalid: expected valid JSON/);
});

test('cli resolve --json fails when .gitrole is missing', async () => {
  const repoDir = await initRealRepo('gitrole-cli-resolve-json-missing-');
  const result = spawnSync(process.execPath, [cliPath, 'resolve', '--json'], {
    cwd: repoDir,
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /error: repo policy file \.gitrole was not found in the repository root/);
});

test('cli resolve --json fails when .gitrole contains invalid JSON', async () => {
  const repoDir = await initRealRepo('gitrole-cli-resolve-json-invalid-');

  await writeFile(path.join(repoDir, '.gitrole'), '{bad-json', 'utf8');

  const result = spawnSync(process.execPath, [cliPath, 'resolve', '--json'], {
    cwd: repoDir,
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /error: repo policy file \.gitrole is invalid: expected valid JSON/);
});

test('cli resolve fails when .gitrole has an invalid schema', async () => {
  const repoDir = await initRealRepo('gitrole-cli-resolve-schema-');

  await writeFile(
    path.join(repoDir, '.gitrole'),
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

  const result = spawnSync(process.execPath, [cliPath, 'resolve'], {
    cwd: repoDir,
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /error: repo policy file \.gitrole is invalid: defaultRole must appear in allowedRoles/);
});

test('cli resolve, status, and doctor succeed for fixture valid-role-names', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-valid-role-names-'));
  const configHome = path.join(tempDir, 'config');
  const repoDir = await initRealRepo('gitrole-cli-valid-role-names-repo-');
  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome
  };

  await writeRepoPolicy(repoDir, {
    version: 1,
    defaultRole: 'client-acme',
    allowedRoles: ['client-acme', 'agent_bot']
  });

  const resolveResult = spawnSync(process.execPath, [cliPath, 'resolve'], {
    cwd: repoDir,
    encoding: 'utf8',
    env
  });
  assert.equal(resolveResult.status, 0);
  assert.equal(resolveResult.stdout.trim(), 'client-acme');
  assert.equal(resolveResult.stderr, '');

  const resolveJsonResult = spawnSync(process.execPath, [cliPath, 'resolve', '--json'], {
    cwd: repoDir,
    encoding: 'utf8',
    env
  });
  assert.equal(resolveJsonResult.status, 0);
  assert.equal(resolveJsonResult.stderr, '');
  assert.deepEqual(JSON.parse(resolveJsonResult.stdout), {
    version: 1,
    defaultRole: 'client-acme',
    allowedRoles: ['client-acme', 'agent_bot']
  });

  for (const args of [['status'], ['doctor'], ['doctor', '--json']] as const) {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      cwd: repoDir,
      encoding: 'utf8',
      env
    });

    assert.ok(result.status === 0 || result.status === 2, result.stderr);
    assert.equal(result.stderr, '');
  }
});

test('cli resolve, resolve --json, status, and doctor reject fixture invalid-default-role-spaces', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-invalid-default-role-spaces-'));
  const repoDir = await initRealRepo('gitrole-cli-invalid-default-role-spaces-repo-');
  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: path.join(tempDir, 'config')
  };

  await writeRepoPolicy(repoDir, {
    version: 1,
    defaultRole: 'client acme',
    allowedRoles: ['client acme']
  });

  await assertPolicyCommandsRejectRoleName(repoDir, env, 'defaultRole', 'client acme');
});

test('cli resolve, resolve --json, status, and doctor reject fixture invalid-default-role-uppercase', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-invalid-default-role-uppercase-'));
  const repoDir = await initRealRepo('gitrole-cli-invalid-default-role-uppercase-repo-');
  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: path.join(tempDir, 'config')
  };

  await writeRepoPolicy(repoDir, {
    version: 1,
    defaultRole: 'Work',
    allowedRoles: ['Work']
  });

  await assertPolicyCommandsRejectRoleName(repoDir, env, 'defaultRole', 'Work');
});

test('cli resolve, resolve --json, status, and doctor reject fixture invalid-allowed-role-uppercase', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-invalid-allowed-role-uppercase-'));
  const repoDir = await initRealRepo('gitrole-cli-invalid-allowed-role-uppercase-repo-');
  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: path.join(tempDir, 'config')
  };

  await writeRepoPolicy(repoDir, {
    version: 1,
    defaultRole: 'work',
    allowedRoles: ['work', 'Client']
  });

  await assertPolicyCommandsRejectRoleName(repoDir, env, 'allowedRoles', 'Client');
});

test('cli resolve, resolve --json, status, and doctor reject fixture invalid-allowed-role-spaces', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-invalid-allowed-role-spaces-'));
  const repoDir = await initRealRepo('gitrole-cli-invalid-allowed-role-spaces-repo-');
  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: path.join(tempDir, 'config')
  };

  await writeRepoPolicy(repoDir, {
    version: 1,
    defaultRole: 'work',
    allowedRoles: ['work', 'client acme']
  });

  await assertPolicyCommandsRejectRoleName(repoDir, env, 'allowedRoles', 'client acme');
});

test('cli pin creates .gitrole with the expected strict policy and prints a clear summary', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-pin-ok-'));
  const configHome = path.join(tempDir, 'config');
  const repoDir = await initRealRepo('gitrole-cli-pin-repo-');
  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome
  };

  const addResult = spawnSync(
    process.execPath,
    [cliPath, 'add', 'work', '--name', 'Alex Developer', '--email', 'alex@work.example'],
    { cwd: repoDir, encoding: 'utf8', env }
  );
  assert.equal(addResult.status, 0, addResult.stderr);

  const result = spawnSync(process.execPath, [cliPath, 'pin', 'work'], {
    cwd: repoDir,
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /pinned role\s+work/);
  assert.match(result.stdout, /file\s+\.gitrole/);
  assert.match(result.stdout, /default\s+work/);
  assert.match(result.stdout, /allowed\s+work/);
  assert.equal(result.stderr, '');
  assert.equal(
    await readFile(path.join(repoDir, '.gitrole'), 'utf8'),
    '{\n  "version": 1,\n  "defaultRole": "work",\n  "allowedRoles": [\n    "work"\n  ]\n}\n'
  );

  const resolveResult = spawnSync(process.execPath, [cliPath, 'resolve', '--json'], {
    cwd: repoDir,
    encoding: 'utf8',
    env
  });
  assert.equal(resolveResult.status, 0, resolveResult.stderr);
  assert.equal(resolveResult.stderr, '');
  assert.deepEqual(JSON.parse(resolveResult.stdout), {
    version: 1,
    defaultRole: 'work',
    allowedRoles: ['work']
  });

  for (const args of [['status'], ['doctor']] as const) {
    const check = spawnSync(process.execPath, [cliPath, ...args], {
      cwd: repoDir,
      encoding: 'utf8',
      env
    });

    assert.ok(check.status === 0 || check.status === 2, check.stderr);
    assert.equal(check.stderr, '');
  }
});

test('cli pin fails outside a git repository', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-pin-outside-'));
  const configHome = path.join(tempDir, 'config');
  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome
  };

  const addResult = spawnSync(
    process.execPath,
    [cliPath, 'add', 'work', '--name', 'Alex Developer', '--email', 'alex@work.example'],
    { cwd: tempDir, encoding: 'utf8', env }
  );
  assert.equal(addResult.status, 0, addResult.stderr);

  const result = spawnSync(process.execPath, [cliPath, 'pin', 'work'], {
    cwd: tempDir,
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /error: not inside a git repository; pin requires a repo context/);
});

test('cli pin fails when the role does not exist', async () => {
  const repoDir = await initRealRepo('gitrole-cli-pin-missing-role-');

  const result = spawnSync(process.execPath, [cliPath, 'pin', 'work'], {
    cwd: repoDir,
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /error: role "work" was not found/);
});

test('cli pin fails when .gitrole already exists and does not overwrite it', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-pin-existing-'));
  const configHome = path.join(tempDir, 'config');
  const repoDir = await initRealRepo('gitrole-cli-pin-repo-existing-');
  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome
  };
  const existingPolicy = '{\n  "version": 1,\n  "defaultRole": "personal",\n  "allowedRoles": [\n    "personal",\n    "work"\n  ]\n}\n';

  await writeFile(path.join(repoDir, '.gitrole'), existingPolicy, 'utf8');

  const addResult = spawnSync(
    process.execPath,
    [cliPath, 'add', 'work', '--name', 'Alex Developer', '--email', 'alex@work.example'],
    { cwd: repoDir, encoding: 'utf8', env }
  );
  assert.equal(addResult.status, 0, addResult.stderr);

  const result = spawnSync(process.execPath, [cliPath, 'pin', 'work'], {
    cwd: repoDir,
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /error: \.gitrole already exists in this repo; gitrole pin will not overwrite or merge existing repo policy/
  );
  assert.equal(await readFile(path.join(repoDir, '.gitrole'), 'utf8'), existingPolicy);
});

test('cli doctor --json includes repo policy state when .gitrole allows the effective role', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-doctor-policy-'));
  const configHome = path.join(tempDir, 'config');
  const gitStubPath = path.join(tempDir, 'git-stub.mjs');
  const sshStubPath = path.join(tempDir, 'ssh-stub.mjs');

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
  await writeFile(
    gitStubPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.name') {
  process.stdout.write('Sara Loera\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.email') {
  process.stdout.write('saraeloop@gmail.com\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--local' && args[2] === '--get') {
  process.exit(1);
}
if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
  process.stdout.write('true\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--verify') {
  process.stdout.write('abcdef0\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
  process.stdout.write('${tempDir.replaceAll("'", "'\\''")}\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args.includes('@{upstream}')) {
  process.stdout.write('origin/main\\n');
  process.exit(0);
}
if (args[0] === 'branch' && args[1] === '--show-current') {
  process.stdout.write('main\\n');
  process.exit(0);
}
if (args[0] === 'log' && args[1] === '--no-merges') {
  process.stdout.write('abc123\\u001fSara Loera\\u001fsaraeloop@gmail.com\\u001fdocs: aligned shared repo\\n');
  process.exit(0);
}
if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
  process.stdout.write('git@github.com-saraeloop:open-source-org/gitrole.git\\n');
  process.exit(0);
}
process.exit(1);
`,
    'utf8'
  );
  await chmod(gitStubPath, 0o755);
  await writeFile(
    sshStubPath,
    `#!/usr/bin/env node
process.stderr.write("Hi saraeloop! You've successfully authenticated, but GitHub does not provide shell access.\\n");
process.exit(1);
`,
    'utf8'
  );
  await chmod(sshStubPath, 0o755);
  await mkdir(path.join(configHome, 'gitrole'), { recursive: true });
  await writeFile(
    path.join(configHome, 'gitrole', 'roles.json'),
    JSON.stringify(
      {
        roles: [
          {
            name: 'saraeloop',
            fullName: 'Sara Loera',
            email: 'saraeloop@gmail.com',
            githubUser: 'saraeloop',
            githubHost: 'github.com-saraeloop'
          }
        ]
      },
      null,
      2
    ),
    'utf8'
  );

  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome,
    GITROLE_GIT_BIN: gitStubPath,
    GITROLE_SSH_BIN: sshStubPath
  };

  const result = spawnSync(process.execPath, [cliPath, 'doctor', '--json'], {
    encoding: 'utf8',
    env
  });
  const parsed = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(parsed.overall, 'aligned');
  assert.deepEqual(parsed.repoPolicy, {
    version: 1,
    defaultRole: 'acmedeploy',
    allowedRoles: ['acmedeploy', 'saraeloop'],
    effectiveRole: 'saraeloop',
    status: 'allowed'
  });
  assert.equal(parsed.checks.some((check: { label: string; status: string }) => check.label === 'policy' && check.status === 'info'), true);
  assert.equal(result.stderr, '');
});

test('cli current --verbose is removed', () => {
  const result = spawnSync(process.execPath, [cliPath, 'current', '--verbose'], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /error: unknown option '--verbose'/);
});

test('cli use --local applies the role to repository-local git config', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-use-local-'));
  const configHome = path.join(tempDir, 'config');
  const gitStubPath = path.join(tempDir, 'git-stub.mjs');
  const gitLogPath = path.join(tempDir, 'git.log');
  const sshStubPath = path.join(tempDir, 'ssh-stub.mjs');

  await writeFile(
    gitStubPath,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(gitLogPath)}, JSON.stringify(args) + "\\n");
if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
  process.stdout.write('true\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--verify') {
  process.stdout.write('abcdef0\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
  process.stdout.write(${JSON.stringify(tempDir + '\n')});
  process.exit(0);
}
if (args[0] === 'rev-parse' && args.includes('@{upstream}')) {
  process.stdout.write('origin/main\\n');
  process.exit(0);
}
if (args[0] === 'branch' && args[1] === '--show-current') {
  process.stdout.write('main\\n');
  process.exit(0);
}
if (args[0] === 'log' && args[1] === '--no-merges') {
  process.stdout.write('old123\\u001fPat Person\\u001fpat@personal.example\\u001fchore: previous personal commit\\n');
  process.exit(0);
}
if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
  process.stdout.write('git@github.com-acme-dev:acme-dev/gitrole.git\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--local' && args[2] === '--get' && args[3] === 'user.name') {
  process.stdout.write('Alex Developer\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--local' && args[2] === '--get' && args[3] === 'user.email') {
  process.stdout.write('alex@work.example\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get') {
  process.exit(1);
}
if (args[0] === 'config' && (args[1] === '--local' || args[1] === '--global')) {
  process.exit(0);
}
process.exit(1);
`,
    'utf8'
  );
  await chmod(gitStubPath, 0o755);
  await writeFile(
    sshStubPath,
    `#!/usr/bin/env node
process.stderr.write("Hi acme-dev! You've successfully authenticated, but GitHub does not provide shell access.\\n");
process.exit(1);
`,
    'utf8'
  );
  await chmod(sshStubPath, 0o755);
  await mkdir(path.join(configHome, 'gitrole'), { recursive: true });
  await writeFile(
    path.join(configHome, 'gitrole', 'roles.json'),
    JSON.stringify(
      {
        roles: [
          {
            name: 'work',
            fullName: 'Alex Developer',
            email: 'alex@work.example',
            githubUser: 'acme-dev',
            githubHost: 'github.com-acme-dev'
          }
        ]
      },
      null,
      2
    ),
    'utf8'
  );

  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome,
    GITROLE_GIT_BIN: gitStubPath,
    GITROLE_SSH_BIN: sshStubPath
  };

  const result = spawnSync(process.execPath, [cliPath, 'use', 'work', '--local'], {
    encoding: 'utf8',
    env
  });

  const log = await readFile(gitLogPath, 'utf8');

  assert.equal(result.status, 0);
  assert.match(result.stdout, /scope\s+local/);
  assert.doesNotMatch(result.stdout, /repo note:/);
  assert.match(log, /"config","--local","user.name","Alex Developer"/);
  assert.match(log, /"config","--local","user.email","alex@work.example"/);
  assert.doesNotMatch(log, /"config","--global","user.name","Alex Developer"/);
  assert.equal(result.stderr, '');
});

test('cli use prints a repo note only when warn-level alignment issues are found', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-use-note-'));
  const configHome = path.join(tempDir, 'config');
  const gitStubPath = path.join(tempDir, 'git-stub.mjs');
  const sshStubPath = path.join(tempDir, 'ssh-stub.mjs');

  await writeFile(
    gitStubPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
  process.stdout.write('true\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--verify') {
  process.stdout.write('abcdef0\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
  process.stdout.write('${tempDir.replaceAll("'", "'\\''")}\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args.includes('@{upstream}')) {
  process.stdout.write('origin/main\\n');
  process.exit(0);
}
if (args[0] === 'branch' && args[1] === '--show-current') {
  process.stdout.write('main\\n');
  process.exit(0);
}
if (args[0] === 'log' && args[1] === '--no-merges') {
  process.stdout.write('abc123\\u001fAlex Developer\\u001falex@work.example\\u001ffeat: previous aligned commit\\n');
  process.exit(0);
}
if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
  process.stdout.write('git@github.com-personal:acme-dev/gitrole.git\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--local' && args[2] === '--get' && args[3] === 'user.name') {
  process.stdout.write('Alex Developer\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--local' && args[2] === '--get' && args[3] === 'user.email') {
  process.stdout.write('alex@work.example\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get') {
  process.exit(1);
}
if (args[0] === 'config' && (args[1] === '--local' || args[1] === '--global')) {
  process.exit(0);
}
process.exit(1);
`,
    'utf8'
  );
  await chmod(gitStubPath, 0o755);
  await writeFile(
    sshStubPath,
    `#!/usr/bin/env node
process.stderr.write("Hi alex-dev! You've successfully authenticated, but GitHub does not provide shell access.\\n");
process.exit(1);
`,
    'utf8'
  );
  await chmod(sshStubPath, 0o755);
  await mkdir(path.join(configHome, 'gitrole'), { recursive: true });
  await writeFile(
    path.join(configHome, 'gitrole', 'roles.json'),
    JSON.stringify(
      {
        roles: [
          {
            name: 'work',
            fullName: 'Alex Developer',
            email: 'alex@work.example',
            githubUser: 'acme-dev',
            githubHost: 'github.com-acme-dev'
          }
        ]
      },
      null,
      2
    ),
    'utf8'
  );

  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome,
    GITROLE_GIT_BIN: gitStubPath,
    GITROLE_SSH_BIN: sshStubPath
  };

  const result = spawnSync(process.execPath, [cliPath, 'use', 'work', '--local'], {
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /switched to\s+work/);
  assert.match(result.stdout, /commit\s+Alex Developer <alex@work\.example>/);
  assert.match(result.stdout, /push\s+acme-dev via github\.com-acme-dev/);
  assert.match(result.stdout, /repo note:\s+alignment issues detected/);
  assert.match(result.stdout, /run:\s+gitrole status/);
  assert.equal(result.stderr, '');
});

test('cli use --local fails outside a git repository', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-use-local-error-'));
  const configHome = path.join(tempDir, 'config');
  const gitStubPath = path.join(tempDir, 'git-stub.mjs');

  await writeFile(
    gitStubPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
  process.stdout.write('false\\n');
  process.exit(0);
}
process.exit(1);
`,
    'utf8'
  );
  await chmod(gitStubPath, 0o755);
  await mkdir(path.join(configHome, 'gitrole'), { recursive: true });
  await writeFile(
    path.join(configHome, 'gitrole', 'roles.json'),
    JSON.stringify(
      {
        roles: [{ name: 'work', fullName: 'Alex Developer', email: 'alex@work.example' }]
      },
      null,
      2
    ),
    'utf8'
  );

  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome,
    GITROLE_GIT_BIN: gitStubPath
  };

  const result = spawnSync(process.execPath, [cliPath, 'use', 'work', '--local'], {
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /error: not inside a git repository; --local requires a repo context/
  );
});

test('cli status exits with code 2 and prints a compact warning summary when misaligned', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-status-'));
  const configHome = path.join(tempDir, 'config');
  const gitStubPath = path.join(tempDir, 'git-stub.mjs');
  const sshStubPath = path.join(tempDir, 'ssh-stub.mjs');

  await writeFile(
    gitStubPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.name') {
  process.stdout.write('Pat Person\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.email') {
  process.stdout.write('pat@personal.example\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--local' && args[2] === '--get') {
  process.exit(1);
}
if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
  process.stdout.write('true\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--verify') {
  process.stdout.write('abcdef0\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
  process.stdout.write('${tempDir.replaceAll("'", "'\\''")}\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args.includes('@{upstream}')) {
  process.stdout.write('origin/main\\n');
  process.exit(0);
}
if (args[0] === 'branch' && args[1] === '--show-current') {
  process.stdout.write('main\\n');
  process.exit(0);
}
if (args[0] === 'log' && args[1] === '--no-merges') {
  process.stdout.write('old123\\u001fPat Person\\u001fpat@personal.example\\u001fchore: previous personal commit\\n');
  process.exit(0);
}
if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
  process.stdout.write('git@github.com-acme-dev:acme-dev/gitrole.git\\n');
  process.exit(0);
}
process.exit(1);
`,
    'utf8'
  );
  await chmod(gitStubPath, 0o755);

  await writeFile(
    sshStubPath,
    `#!/usr/bin/env node
process.stderr.write("Hi acme-dev! You've successfully authenticated, but GitHub does not provide shell access.\\n");
process.exit(1);
`,
    'utf8'
  );
  await chmod(sshStubPath, 0o755);

  await mkdir(path.join(configHome, 'gitrole'), { recursive: true });

  await writeFile(
    path.join(configHome, 'gitrole', 'roles.json'),
    JSON.stringify(
      {
        roles: [
          {
            name: 'work',
            fullName: 'Alex Developer',
            email: 'alex@work.example',
            githubUser: 'acme-dev',
            githubHost: 'github.com-acme-dev'
          }
        ]
      },
      null,
      2
    ),
    'utf8'
  );

  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome,
    GITROLE_GIT_BIN: gitStubPath,
    GITROLE_SSH_BIN: sshStubPath
  };

  const result = spawnSync(process.execPath, [cliPath, 'status'], {
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 2);
  assert.match(result.stdout, /no matching role/);
  assert.match(result.stdout, /commit\s+Pat Person <pat@personal\.example>/);
  assert.match(result.stdout, /push\s+acme-dev via github\.com-acme-dev/);
  assert.match(result.stdout, /scope\s+global/);
  assert.match(result.stdout, /warning/);
  assert.doesNotMatch(result.stdout, /history\s+last non-merge commit used/);
  assert.equal(result.stderr, '');
});

test('cli doctor shows the hidden global identity when a local override is active', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-doctor-local-'));
  const configHome = path.join(tempDir, 'config');
  const gitStubPath = path.join(tempDir, 'git-stub.mjs');
  const sshStubPath = path.join(tempDir, 'ssh-stub.mjs');

  await writeFile(
    gitStubPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.name') {
  process.stdout.write('Sara Personal\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.email') {
  process.stdout.write('sara@personal.example\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--local' && args[2] === '--get' && args[3] === 'user.name') {
  process.stdout.write('Acme Examples\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--local' && args[2] === '--get' && args[3] === 'user.email') {
  process.stdout.write('dev@acme-examples.test\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
  process.stdout.write('true\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--verify') {
  process.stdout.write('abcdef0\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
  process.stdout.write('${tempDir.replaceAll("'", "'\\''")}\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args.includes('@{upstream}')) {
  process.stdout.write('origin/main\\n');
  process.exit(0);
}
if (args[0] === 'branch' && args[1] === '--show-current') {
  process.stdout.write('main\\n');
  process.exit(0);
}
if (args[0] === 'log' && args[1] === '--no-merges') {
  process.stdout.write('abc123\\u001fAcme Examples\\u001fdev@acme-examples.test\\u001ffeat: aligned local commit\\n');
  process.exit(0);
}
if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
  process.stdout.write('git@github.com-acmedeploy:acmedeploy/gitrole.git\\n');
  process.exit(0);
}
process.exit(1);
`,
    'utf8'
  );
  await chmod(gitStubPath, 0o755);
  await writeFile(
    sshStubPath,
    `#!/usr/bin/env node
process.stderr.write("Hi acmedeploy! You've successfully authenticated, but GitHub does not provide shell access.\\n");
process.exit(1);
`,
    'utf8'
  );
  await chmod(sshStubPath, 0o755);
  await mkdir(path.join(configHome, 'gitrole'), { recursive: true });
  await writeFile(
    path.join(configHome, 'gitrole', 'roles.json'),
    JSON.stringify(
      {
        roles: [
          {
            name: 'acme',
            fullName: 'Acme Examples',
            email: 'dev@acme-examples.test',
            githubUser: 'acmedeploy',
            githubHost: 'github.com-acmedeploy'
          }
        ]
      },
      null,
      2
    ),
    'utf8'
  );

  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome,
    GITROLE_GIT_BIN: gitStubPath,
    GITROLE_SSH_BIN: sshStubPath
  };

  const result = spawnSync(process.execPath, [cliPath, 'doctor'], {
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /scope\s+local/);
  assert.match(result.stdout, /local\s+active/);
  assert.match(result.stdout, /global\s+Sara Personal <sara@personal.example>/);
  assert.equal(result.stderr, '');
});

test('cli status shows local override when repo-local identity is effective', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-status-local-'));
  const configHome = path.join(tempDir, 'config');
  const gitStubPath = path.join(tempDir, 'git-stub.mjs');
  const sshStubPath = path.join(tempDir, 'ssh-stub.mjs');

  await writeFile(
    gitStubPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.name') {
  process.stdout.write('Sara Personal\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.email') {
  process.stdout.write('sara@personal.example\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--local' && args[2] === '--get' && args[3] === 'user.name') {
  process.stdout.write('Acme Examples\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--local' && args[2] === '--get' && args[3] === 'user.email') {
  process.stdout.write('dev@acme-examples.test\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
  process.stdout.write('true\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--verify') {
  process.stdout.write('abcdef0\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
  process.stdout.write('${tempDir.replaceAll("'", "'\\''")}\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args.includes('@{upstream}')) {
  process.stdout.write('origin/main\\n');
  process.exit(0);
}
if (args[0] === 'branch' && args[1] === '--show-current') {
  process.stdout.write('main\\n');
  process.exit(0);
}
if (args[0] === 'log' && args[1] === '--no-merges') {
  process.stdout.write('abc123\\u001fAcme Examples\\u001fdev@acme-examples.test\\u001ffeat: aligned local commit\\n');
  process.exit(0);
}
if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
  process.stdout.write('git@github.com-acmedeploy:acmedeploy/gitrole.git\\n');
  process.exit(0);
}
process.exit(1);
`,
    'utf8'
  );
  await chmod(gitStubPath, 0o755);
  await writeFile(
    sshStubPath,
    `#!/usr/bin/env node
process.stderr.write("Hi acmedeploy! You've successfully authenticated, but GitHub does not provide shell access.\\n");
process.exit(1);
`,
    'utf8'
  );
  await chmod(sshStubPath, 0o755);
  await mkdir(path.join(configHome, 'gitrole'), { recursive: true });
  await writeFile(
    path.join(configHome, 'gitrole', 'roles.json'),
    JSON.stringify(
      {
        roles: [
          {
            name: 'acme',
            fullName: 'Acme Examples',
            email: 'dev@acme-examples.test',
            githubUser: 'acmedeploy',
            githubHost: 'github.com-acmedeploy'
          }
        ]
      },
      null,
      2
    ),
    'utf8'
  );

  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome,
    GITROLE_GIT_BIN: gitStubPath,
    GITROLE_SSH_BIN: sshStubPath
  };

  const result = spawnSync(process.execPath, [cliPath, 'status'], {
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /^acme\s+aligned/m);
  assert.match(result.stdout, /commit\s+Acme Examples <dev@acme-examples\.test>/);
  assert.match(
    result.stdout,
    /push\s+acmedeploy via github\.com-acmedeploy/
  );
  assert.match(result.stdout, /scope\s+local override/);
  assert.doesNotMatch(result.stdout, /history\s+last non-merge commit used/);
  assert.equal(result.stderr, '');
});

test('cli status --short fixture status-short-baseline keeps field order and keys', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-status-short-'));
  const configHome = path.join(tempDir, 'config');
  const gitStubPath = path.join(tempDir, 'git-stub.mjs');
  const sshStubPath = path.join(tempDir, 'ssh-stub.mjs');

  await writeFile(
    gitStubPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.name') {
  process.stdout.write('Alex Developer\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.email') {
  process.stdout.write('alex@work.example\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--local' && args[2] === '--get') {
  process.exit(1);
}
if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
  process.stdout.write('true\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--verify') {
  process.stdout.write('abcdef0\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
  process.stdout.write('${tempDir.replaceAll("'", "'\\''")}\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args.includes('@{upstream}')) {
  process.stdout.write('origin/main\\n');
  process.exit(0);
}
if (args[0] === 'branch' && args[1] === '--show-current') {
  process.stdout.write('main\\n');
  process.exit(0);
}
if (args[0] === 'log' && args[1] === '--no-merges') {
  process.stdout.write('abc123\\u001fAlex Developer\\u001falex@work.example\\u001ffeat: aligned history\\n');
  process.exit(0);
}
if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
  process.stdout.write('git@github.com-acme-dev:acme-dev/gitrole.git\\n');
  process.exit(0);
}
process.exit(1);
`,
    'utf8'
  );
  await chmod(gitStubPath, 0o755);

  await writeFile(
    sshStubPath,
    `#!/usr/bin/env node
process.stderr.write("Hi acme-dev! You've successfully authenticated, but GitHub does not provide shell access.\\n");
process.exit(1);
`,
    'utf8'
  );
  await chmod(sshStubPath, 0o755);

  await mkdir(path.join(configHome, 'gitrole'), { recursive: true });

  await writeFile(
    path.join(configHome, 'gitrole', 'roles.json'),
    JSON.stringify(
      {
        roles: [
          {
            name: 'work',
            fullName: 'Alex Developer',
            email: 'alex@work.example',
            githubUser: 'acme-dev',
            githubHost: 'github.com-acme-dev'
          }
        ]
      },
      null,
      2
    ),
    'utf8'
  );

  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome,
    GITROLE_GIT_BIN: gitStubPath,
    GITROLE_SSH_BIN: sshStubPath
  };

  const result = spawnSync(process.execPath, [cliPath, 'status', '--short'], {
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(
    result.stdout.trim(),
    'role=work scope=global override=false commit=ok remote=ok auth=ok policy=na overall=aligned'
  );
  assert.deepEqual(
    result.stdout
      .trim()
      .split(' ')
      .map((field) => field.split('=')[0]),
    ['role', 'scope', 'override', 'commit', 'remote', 'auth', 'policy', 'overall']
  );
});

test('cli status --short preserves contract-safe role names like agent_bot', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-status-short-agent-bot-'));
  const configHome = path.join(tempDir, 'config');
  const gitStubPath = path.join(tempDir, 'git-stub.mjs');
  const sshStubPath = path.join(tempDir, 'ssh-stub.mjs');

  await writeFile(
    gitStubPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.name') {
  process.stdout.write('Acme Build Agent\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.email') {
  process.stdout.write('build-agent@acme.example\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--local' && args[2] === '--get') {
  process.exit(1);
}
if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
  process.stdout.write('true\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--verify') {
  process.stdout.write('abcdef0\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
  process.stdout.write('${tempDir.replaceAll("'", "'\\''")}\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args.includes('@{upstream}')) {
  process.stdout.write('origin/main\\n');
  process.exit(0);
}
if (args[0] === 'branch' && args[1] === '--show-current') {
  process.stdout.write('main\\n');
  process.exit(0);
}
if (args[0] === 'log' && args[1] === '--no-merges') {
  process.stdout.write('abc123\\u001fAcme Build Agent\\u001fbuild-agent@acme.example\\u001fchore: aligned agent history\\n');
  process.exit(0);
}
if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
  process.stdout.write('git@github.com-agent-bot:acme/service.git\\n');
  process.exit(0);
}
process.exit(1);
`,
    'utf8'
  );
  await chmod(gitStubPath, 0o755);

  await writeFile(
    sshStubPath,
    `#!/usr/bin/env node
process.stderr.write("Hi acme-build-agent! You've successfully authenticated, but GitHub does not provide shell access.\\n");
process.exit(1);
`,
    'utf8'
  );
  await chmod(sshStubPath, 0o755);

  await mkdir(path.join(configHome, 'gitrole'), { recursive: true });
  await writeFile(
    path.join(configHome, 'gitrole', 'roles.json'),
    JSON.stringify(
      {
        roles: [
          {
            name: 'agent_bot',
            fullName: 'Acme Build Agent',
            email: 'build-agent@acme.example',
            githubUser: 'acme-build-agent',
            githubHost: 'github.com-agent-bot'
          }
        ]
      },
      null,
      2
    ),
    'utf8'
  );

  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome,
    GITROLE_GIT_BIN: gitStubPath,
    GITROLE_SSH_BIN: sshStubPath
  };

  const result = spawnSync(process.execPath, [cliPath, 'status', '--short'], {
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 0);
  assert.equal(
    result.stdout.trim(),
    'role=agent_bot scope=global override=false commit=ok remote=ok auth=ok policy=na overall=aligned'
  );
  assert.equal(result.stderr, '');
});

test('cli status --short fails clearly when stored role data contains an invalid role name', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-status-short-invalid-role-'));
  const configHome = path.join(tempDir, 'config');
  const gitStubPath = path.join(tempDir, 'git-stub.mjs');

  await writeFile(
    gitStubPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.name') {
  process.stdout.write('Alex Developer\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.email') {
  process.stdout.write('alex@work.example\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--local' && args[2] === '--get') {
  process.exit(1);
}
if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
  process.stdout.write('true\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--verify') {
  process.stdout.write('abcdef0\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
  process.stdout.write('${tempDir.replaceAll("'", "'\\''")}\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args.includes('@{upstream}')) {
  process.stdout.write('origin/main\\n');
  process.exit(0);
}
if (args[0] === 'branch' && args[1] === '--show-current') {
  process.stdout.write('main\\n');
  process.exit(0);
}
if (args[0] === 'log' && args[1] === '--no-merges') {
  process.stdout.write('abc123\\u001fAlex Developer\\u001falex@work.example\\u001ffeat: aligned history\\n');
  process.exit(0);
}
if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
  process.stdout.write('git@github.com-acme-dev:acme-dev/gitrole.git\\n');
  process.exit(0);
}
process.exit(1);
`,
    'utf8'
  );
  await chmod(gitStubPath, 0o755);
  await mkdir(path.join(configHome, 'gitrole'), { recursive: true });
  await writeFile(
    path.join(configHome, 'gitrole', 'roles.json'),
    JSON.stringify(
      {
        roles: [
          {
            name: 'client acme',
            fullName: 'Alex Developer',
            email: 'alex@work.example'
          }
        ]
      },
      null,
      2
    ),
    'utf8'
  );

  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome,
    GITROLE_GIT_BIN: gitStubPath
  };

  const result = spawnSync(process.execPath, [cliPath, 'status', '--short'], {
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /error: saved role data is invalid; fix or recreate the roles file/
  );
});

test('cli list fails clearly and does not silently skip mixed valid and invalid stored roles', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-list-invalid-stored-roles-'));
  const configHome = path.join(tempDir, 'config');

  await mkdir(path.join(configHome, 'gitrole'), { recursive: true });
  await writeFile(
    path.join(configHome, 'gitrole', 'roles.json'),
    JSON.stringify(
      {
        roles: [
          {
            name: 'work',
            fullName: 'Alex Developer',
            email: 'alex@work.example'
          },
          {
            name: 'client acme',
            fullName: 'Pat Person',
            email: 'pat@example.com'
          }
        ]
      },
      null,
      2
    ),
    'utf8'
  );

  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome
  };

  const result = spawnSync(process.execPath, [cliPath, 'list'], {
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /error: saved role data is invalid; fix or recreate the roles file/
  );
});

test('cli status stays aligned when the current identity is correct and only the last commit differs', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-status-history-note-'));
  const configHome = path.join(tempDir, 'config');
  const gitStubPath = path.join(tempDir, 'git-stub.mjs');
  const sshStubPath = path.join(tempDir, 'ssh-stub.mjs');

  await writeFile(
    gitStubPath,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.name') {
  process.stdout.write('Acme Examples\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--global' && args[2] === '--get' && args[3] === 'user.email') {
  process.stdout.write('dev@acme-examples.test\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--local' && args[2] === '--get' && args[3] === 'user.name') {
  process.stdout.write('acme-examples\\n');
  process.exit(0);
}
if (args[0] === 'config' && args[1] === '--local' && args[2] === '--get' && args[3] === 'user.email') {
  process.stdout.write('acmedeploy@gmail.com\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') {
  process.stdout.write('true\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--verify') {
  process.stdout.write('abcdef0\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
  process.stdout.write('${tempDir.replaceAll("'", "'\\''")}\\n');
  process.exit(0);
}
if (args[0] === 'rev-parse' && args.includes('@{upstream}')) {
  process.stdout.write('origin/main\\n');
  process.exit(0);
}
if (args[0] === 'branch' && args[1] === '--show-current') {
  process.stdout.write('main\\n');
  process.exit(0);
}
if (args[0] === 'log' && args[1] === '--no-merges') {
  process.stdout.write('abc123\\u001facme-examples\\u001fsara@acme.example\\u001fdocs: previous account commit\\n');
  process.exit(0);
}
if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
  process.stdout.write('git@github.com-acmedeploy:acme-examples/gitrole.git\\n');
  process.exit(0);
}
process.exit(1);
`,
    'utf8'
  );
  await chmod(gitStubPath, 0o755);

  await writeFile(
    sshStubPath,
    `#!/usr/bin/env node
process.stderr.write("Hi acmedeploy! You've successfully authenticated, but GitHub does not provide shell access.\\n");
process.exit(1);
`,
    'utf8'
  );
  await chmod(sshStubPath, 0o755);

  await mkdir(path.join(configHome, 'gitrole'), { recursive: true });
  await writeFile(
    path.join(configHome, 'gitrole', 'roles.json'),
    JSON.stringify(
      {
        roles: [
          {
            name: 'acmedeploy',
            fullName: 'acme-examples',
            email: 'acmedeploy@gmail.com',
            githubUser: 'acmedeploy',
            githubHost: 'github.com-acmedeploy'
          }
        ]
      },
      null,
      2
    ),
    'utf8'
  );

  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome,
    GITROLE_GIT_BIN: gitStubPath,
    GITROLE_SSH_BIN: sshStubPath
  };

  const result = spawnSync(process.execPath, [cliPath, 'status'], {
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /^acmedeploy\s+aligned/m);
  assert.match(result.stdout, /commit\s+acme-examples <acmedeploy@gmail\.com>/);
  assert.match(
    result.stdout,
    /push\s+acmedeploy via github\.com-acmedeploy/
  );
  assert.match(result.stdout, /scope\s+local override/);
  assert.match(
    result.stdout,
    /history\s+last non-merge commit used acme-examples <sara@acme\.example>/
  );
  assert.equal(result.stderr, '');
});

test('cli verify command is removed', () => {
  const result = spawnSync(process.execPath, [cliPath, 'verify'], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /error: unknown command 'verify'/);
});

test('cli remote set rewrites origin to the role host alias', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-remote-set-'));
  const configHome = path.join(tempDir, 'config');
  const gitStubPath = path.join(tempDir, 'git-stub.mjs');
  const gitLogPath = path.join(tempDir, 'git.log');

  await writeFile(
    gitStubPath,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(gitLogPath)}, JSON.stringify(args) + "\\n");
if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
  process.stdout.write('git@github.com:acmedeploy/gitrole.git\\n');
  process.exit(0);
}
if (args[0] === 'remote' && args[1] === 'set-url' && args[2] === 'origin') {
  process.exit(0);
}
process.exit(1);
`,
    'utf8'
  );
  await chmod(gitStubPath, 0o755);
  await mkdir(path.join(configHome, 'gitrole'), { recursive: true });
  await writeFile(
    path.join(configHome, 'gitrole', 'roles.json'),
    JSON.stringify(
      {
        roles: [
          {
            name: 'work',
            fullName: 'Sara Loera',
            email: 'sara@acme.example',
            githubHost: 'github.com-acmedeploy'
          }
        ]
      },
      null,
      2
    ),
    'utf8'
  );

  const env = {
    ...process.env,
    HOME: tempDir,
    XDG_CONFIG_HOME: configHome,
    GITROLE_GIT_BIN: gitStubPath
  };

  const result = spawnSync(process.execPath, [cliPath, 'remote', 'set', 'work'], {
    encoding: 'utf8',
    env
  });
  const log = await readFile(gitLogPath, 'utf8');

  assert.equal(result.status, 0);
  assert.match(result.stdout, /updated remote\s+origin/);
  assert.match(log, /"remote","set-url","origin","git@github.com-acmedeploy:acmedeploy\/gitrole.git"/);
  assert.equal(result.stderr, '');
});

test('cli runs correctly when invoked through a symlinked entrypoint', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-cli-symlink-'));
  const linkedCliPath = path.join(tempDir, 'gitrole');

  await symlink(cliPath, linkedCliPath);

  const result = spawnSync(process.execPath, [linkedCliPath, '--help'], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Manage named git identities and diagnose repo alignment/);
  assert.equal(result.stderr, '');
});

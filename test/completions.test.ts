/*
 * Checks shell completion scripts parse, ship with the package, and complete commands and role names.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const completionsDir = path.join(repoRoot, 'completions');
const bashScript = path.join(completionsDir, 'gitrole.bash');
const zshScript = path.join(completionsDir, '_gitrole');
const fishScript = path.join(completionsDir, 'gitrole.fish');
const cliPath = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));
const roleListSed = "sed -n 's/^[* ] \\([a-z0-9_-][a-z0-9_-]*\\) .*/\\1/p'";

const commandNames = [
  'add',
  'import',
  'use',
  'pin',
  'resolve',
  'current',
  'list',
  'status',
  'doctor',
  'remote',
  'remove',
  'help'
];

function commandAvailable(name: string): boolean {
  const result = spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function assertSameMembers(actual: string[], expected: string[], label: string): void {
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);
}

async function writeExecutable(filePath: string, contents: string): Promise<void> {
  await writeFile(filePath, contents, 'utf8');
  await chmod(filePath, 0o755);
}

interface CompletionEnv {
  env: NodeJS.ProcessEnv;
  home: string;
}

async function createRealCliEnv(): Promise<CompletionEnv> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'gitrole-completions-'));
  const binDir = path.join(home, 'bin');
  const configHome = path.join(home, 'config');
  await mkdir(binDir, { recursive: true });
  await mkdir(configHome, { recursive: true });
  await writeExecutable(
    path.join(binDir, 'gitrole'),
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(cliPath)} "$@"\n`
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: configHome,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig'),
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    FORCE_COLOR: '1'
  };
  delete env.NO_COLOR;

  const git = (args: string[]) => {
    const result = spawnSync('git', args, { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
  };
  git(['config', '--global', 'user.name', 'Pat Person']);
  git(['config', '--global', 'user.email', 'pat@personal.example']);

  const gitrole = (args: string[]) => {
    const result = spawnSync(path.join(binDir, 'gitrole'), args, { encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  gitrole(['add', 'work', '--name', 'Alex Developer', '--email', 'alex@work.example']);
  gitrole(['add', 'personal', '--name', 'Pat Person', '--email', 'pat@personal.example']);
  gitrole([
    'add',
    'client-acme',
    '--name',
    'Acme Client',
    '--email',
    'acme@client.example',
    '--ssh',
    path.join(home, '.ssh', 'id_acme'),
    '--github-user',
    'acme',
    '--github-host',
    'github.com-acme'
  ]);

  return { env, home };
}

function bashCompletions(env: NodeJS.ProcessEnv, line: string, cwd?: string): { values: string[]; stderr: string } {
  const driver = `
set -euo pipefail
source ${JSON.stringify(bashScript)}
line=$1
COMP_LINE="$line"
COMP_POINT=\${#COMP_LINE}
if [[ "$line" == *" " ]]; then
  COMP_WORDS=($line)
  COMP_WORDS+=("")
else
  COMP_WORDS=($line)
fi
COMP_CWORD=\$((\${#COMP_WORDS[@]} - 1))
COMPREPLY=()
_gitrole
# Bash 3.2 with nounset rejects expanding an empty array; retain every nonempty result.
if (( \${#COMPREPLY[@]} )); then
  printf '%s\\n' "\${COMPREPLY[@]}"
fi
`;
  const result = spawnSync('bash', ['-c', driver, 'bash', line], {
    encoding: 'utf8',
    env,
    cwd
  });
  assert.equal(result.status, 0, result.stderr);
  return {
    values: result.stdout.split('\n').filter((entry) => entry.length > 0),
    stderr: result.stderr
  };
}

function fishCompletions(env: NodeJS.ProcessEnv, line: string, cwd?: string): { values: string[]; stderr: string } {
  const result = spawnSync(
    'fish',
    ['-c', 'source $argv[1]; complete -C $argv[2]', fishScript, line],
    {
      encoding: 'utf8',
      env,
      cwd
    }
  );
  assert.equal(result.status, 0, result.stderr);
  const values = result.stdout
    .split('\n')
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.split('\t')[0] ?? entry);
  return { values, stderr: result.stderr };
}

test('completion scripts exist and read role names from gitrole list', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')) as {
    files: string[];
  };
  assert.deepEqual(packageJson.files, ['dist', 'hooks', 'shell', 'skills', 'completions']);

  for (const filePath of [bashScript, zshScript, fishScript]) {
    const source = await readFile(filePath, 'utf8');
    assert.match(source, /gitrole list/);
    assert.match(source, /FORCE_COLOR=0/);
    assert.ok(source.includes(roleListSed), filePath);
  }

  const zshSource = await readFile(zshScript, 'utf8');
  assert.match(zshSource, /^#compdef gitrole\n/);
  const guide = await readFile(
    path.join(repoRoot, 'docs/guides/enable-shell-tab-completion.md'),
    'utf8'
  );
  assert.match(guide, /layout: layouts\/base\.njk/);
  assert.match(guide, /eyebrow: Guide/);
  assert.match(guide, /^order: 5$/m);
  for (const sectionId of [
    'when-to-use-this',
    'where-the-scripts-live',
    'zsh',
    'bash',
    'fish',
    'what-completes',
    'verify'
  ]) {
    assert.match(guide, new RegExp(`<h2 id="${sectionId}">`));
  }
  assert.match(await readFile(path.join(repoRoot, 'README.md'), 'utf8'), /enable-shell-tab-completion/);
  assert.match(await readFile(path.join(repoRoot, 'docs/commands.md'), 'utf8'), /enable-shell-tab-completion/);
  assert.match(await readFile(path.join(repoRoot, 'docs/index.md'), 'utf8'), /enable-shell-tab-completion/);
});

test('bash -n accepts the completion script', () => {
  const result = spawnSync('bash', ['-n', bashScript], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('bash completion offers commands, flags, and saved role names', async () => {
  const { env, home } = await createRealCliEnv();
  const roles = ['work', 'personal', 'client-acme'];
  const sshDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-ssh-complete-'));
  await writeFile(path.join(sshDir, 'id_work'), 'key', 'utf8');

  assertSameMembers(bashCompletions(env, 'gitrole ').values, commandNames, 'commands');
  assertSameMembers(
    bashCompletions(env, 'gitrole --').values,
    ['--help', '--version'],
    'root long flags'
  );
  assert.ok(bashCompletions(env, 'gitrole -').values.includes('-h'));
  assert.ok(bashCompletions(env, 'gitrole -').values.includes('-V'));
  assertSameMembers(bashCompletions(env, 'gitrole use ').values, roles, 'use roles');
  assert.deepEqual(bashCompletions(env, 'gitrole use w').values, ['work']);
  assertSameMembers(
    bashCompletions(env, 'gitrole use --').values,
    ['--help', '--global', '--local'],
    'use flags'
  );
  assertSameMembers(bashCompletions(env, 'gitrole use --local ').values, roles, 'use --local roles');
  assert.deepEqual(bashCompletions(env, 'gitrole use --local --').values, ['--help']);
  assert.deepEqual(bashCompletions(env, 'gitrole use --global --').values, ['--help']);
  assert.deepEqual(bashCompletions(env, 'gitrole import ').values, ['current']);
  assertSameMembers(
    bashCompletions(env, 'gitrole import current --').values,
    ['--name', '--help'],
    'import flags'
  );
  assertSameMembers(
    bashCompletions(env, 'gitrole import current --name ').values,
    roles,
    'import role names'
  );
  assert.deepEqual(bashCompletions(env, 'gitrole import current --name c').values, ['client-acme']);
  assert.deepEqual(bashCompletions(env, 'gitrole remote ').values, ['set']);
  assertSameMembers(bashCompletions(env, 'gitrole remote set ').values, roles, 'remote set roles');
  assertSameMembers(
    bashCompletions(env, 'gitrole add --').values,
    ['--name', '--email', '--ssh', '--github-user', '--github-host', '--help'],
    'add flags'
  );
  assertSameMembers(bashCompletions(env, 'gitrole add ').values, roles, 'add roles');
  assert.deepEqual(bashCompletions(env, 'gitrole add --name ').values, []);
  assert.deepEqual(bashCompletions(env, 'gitrole add --email ').values, []);
  assert.deepEqual(bashCompletions(env, 'gitrole add --github-user ').values, []);
  assert.deepEqual(bashCompletions(env, 'gitrole add --github-host ').values, []);
  assertSameMembers(
    bashCompletions(env, 'gitrole add --email alex@work.example ').values,
    roles,
    'add after email'
  );
  assert.ok(
    bashCompletions(env, 'gitrole add --ssh id_w', sshDir).values.includes('id_work'),
    home
  );
  assertSameMembers(bashCompletions(env, 'gitrole pin ').values, roles, 'pin roles');
  assertSameMembers(bashCompletions(env, 'gitrole remove ').values, roles, 'remove roles');
  assert.deepEqual(bashCompletions(env, 'gitrole resolve --').values, ['--json', '--help']);
  assert.deepEqual(bashCompletions(env, 'gitrole status --').values, ['--short', '--offline', '--help']);
  assert.deepEqual(bashCompletions(env, 'gitrole doctor --').values, ['--json', '--help']);
  assert.deepEqual(bashCompletions(env, 'gitrole current ').values, []);
  assert.deepEqual(bashCompletions(env, 'gitrole list --').values, ['--help']);
  assert.ok(bashCompletions(env, 'gitrole help ').values.includes('use'));
  assert.equal(bashCompletions(env, 'gitrole use ').stderr, '');
});

test('bash role completion fails soft when roles cannot be listed', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'gitrole-completions-fail-'));
  const binDir = path.join(home, 'bin');
  await mkdir(binDir, { recursive: true });
  await writeExecutable(
    path.join(binDir, 'gitrole'),
    '#!/bin/sh\necho "error: boom" >&2\nexit 1\n'
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`
  };

  const failed = bashCompletions(env, 'gitrole use ');
  assert.deepEqual(failed.values, []);
  assert.equal(failed.stderr, '');
  assert.ok(bashCompletions(env, 'gitrole ').values.includes('status'));

  const missingPath = `${path.join(home, 'empty-bin')}`;
  await mkdir(missingPath, { recursive: true });
    const missing = bashCompletions(
      {
        ...env,
        PATH: `${missingPath}${path.delimiter}/usr/bin${path.delimiter}/bin`
      },
      'gitrole remove '
    );
  assert.deepEqual(missing.values, []);
  assert.equal(missing.stderr, '');

  const { env: emptyEnv } = await createRealCliEnv();
  const emptyHome = await mkdtemp(path.join(os.tmpdir(), 'gitrole-completions-empty-'));
  const emptyBin = path.join(emptyHome, 'bin');
  await mkdir(emptyBin, { recursive: true });
  await writeExecutable(
    path.join(emptyBin, 'gitrole'),
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(cliPath)} "$@"\n`
  );
  const noRoles = bashCompletions(
    {
      ...emptyEnv,
      HOME: emptyHome,
      XDG_CONFIG_HOME: path.join(emptyHome, 'config'),
      GIT_CONFIG_GLOBAL: path.join(emptyHome, 'gitconfig'),
      PATH: `${emptyBin}${path.delimiter}${process.env.PATH ?? ''}`
    },
    'gitrole use '
  );
  assert.deepEqual(noRoles.values, []);
  assert.equal(noRoles.stderr, '');
});

const zshSyntax = commandAvailable('zsh') ? test : test.skip;

zshSyntax('zsh -n accepts the completion function', () => {
  const result = spawnSync('zsh', ['-n', zshScript], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

const zshBehavior = commandAvailable('zsh') && commandAvailable('python3') ? test : test.skip;

zshBehavior('zsh completion offers commands, flags, and saved role names', async () => {
  const { env } = await createRealCliEnv();
  const script = String.raw`
import os, pty, select, json, sys

cases = json.loads(sys.argv[1])
pid, fd = pty.fork()
if pid == 0:
    os.execvp("zsh", ["zsh", "-f"])

def write(data):
    os.write(fd, data.encode())

def wait_for(token, seconds=8):
    buf = b""
    import time
    deadline = time.time() + seconds
    while time.time() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.1)
        if not ready:
            continue
        chunk = os.read(fd, 16384)
        if not chunk:
            break
        buf += chunk
        if token.encode() in buf:
            return buf
    raise SystemExit("timed out waiting for " + token)

def read_until_quiet(seconds=4):
    import time
    buf = b""
    deadline = time.time() + seconds
    quiet_at = None
    while time.time() < deadline:
        timeout = 0.2 if quiet_at is None else max(0.01, quiet_at - time.time())
        ready, _, _ = select.select([fd], [], [], timeout)
        if not ready:
            if buf and quiet_at is not None and time.time() >= quiet_at:
                return buf
            continue
        chunk = os.read(fd, 16384)
        if not chunk:
            break
        buf += chunk
        quiet_at = time.time() + 0.25
    if buf:
        return buf
    raise SystemExit("timed out waiting for completion output")

write("unset zle_bracketed_paste\nPS1='P> '\nRPS1=''\nunsetopt promptsp\n")
write("autoload -Uz compinit\n")
write("fpath=(" + sys.argv[2] + " $fpath)\n")
write("compinit -u\nbindkey -e\nbindkey '^I' complete-word\nsetopt nolistbeep\n")
write("zstyle ':completion:*' menu no\n")
write("zstyle ':completion:*:descriptions' format ''\n")
write("zstyle ':completion:*' format ''\n")
write("print -r -- COMPINIT_DONE\n")
wait_for("COMPINIT_DONE")

def drain(seconds=0.2):
    import time
    deadline = time.time() + seconds
    while time.time() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.05)
        if not ready:
            continue
        os.read(fd, 16384)

results = {}
for line in cases:
    write("\x15")
    drain()
    write(line + "\t")
    raw = read_until_quiet()
    text = raw.decode("utf-8", "replace").replace("\r", "")
    results[line] = text

print(json.dumps(results))
os.kill(pid, 9)
os.waitpid(pid, 0)
`;
  const lines = [
    'gitrole ',
    'gitrole use ',
    'gitrole use --',
    'gitrole use --local --',
    'gitrole import ',
    'gitrole import current --name ',
    'gitrole add --',
    'gitrole add --name ',
    'gitrole remote ',
    'gitrole remote set ',
    'gitrole status --',
    'gitrole doctor --',
    'gitrole resolve --',
    'gitrole pin '
  ];
  const result = spawnSync('python3', ['-c', script, JSON.stringify(lines), completionsDir], {
    encoding: 'utf8',
    env,
    timeout: 20000
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const completed = JSON.parse(result.stdout) as Record<string, string>;
  for (const command of ['add', 'use', 'remote', 'remove', 'doctor', 'status']) {
    assert.match(completed['gitrole '], new RegExp(`\\b${command}\\b`));
  }
  for (const role of ['work', 'personal', 'client-acme']) {
    assert.match(completed['gitrole use '], new RegExp(`\\b${role}\\b`));
    assert.match(completed['gitrole import current --name '], new RegExp(`\\b${role}\\b`));
    assert.match(completed['gitrole remote set '], new RegExp(`\\b${role}\\b`));
    assert.match(completed['gitrole pin '], new RegExp(`\\b${role}\\b`));
    assert.doesNotMatch(completed['gitrole add --name '], new RegExp(`\\b${role}\\b`));
  }
  assert.match(completed['gitrole use --'], /--global/);
  assert.match(completed['gitrole use --'], /--local/);
  assert.match(completed['gitrole use --local --'], /--help/);
  assert.doesNotMatch(completed['gitrole use --local --'], /--global/);
  assert.match(completed['gitrole import '], /current/);
  assert.match(completed['gitrole add --'], /--ssh/);
  assert.match(completed['gitrole add --'], /--github-user/);
  assert.match(completed['gitrole add --'], /--github-host/);
  assert.match(completed['gitrole add --'], /--email/);
  assert.match(completed['gitrole remote '], /\bset\b/);
  assert.match(completed['gitrole status --'], /--short/);
  assert.match(completed['gitrole status --'], /--offline/);
  assert.match(completed['gitrole doctor --'], /--json/);
  assert.match(completed['gitrole resolve --'], /--json/);
});

const fishSyntax = commandAvailable('fish') ? test : test.skip;

fishSyntax('fish -n accepts the completion script', () => {
  const result = spawnSync('fish', ['-n', fishScript], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

const fishBehavior = commandAvailable('fish') ? test : test.skip;

fishBehavior('fish completion offers commands, flags, and saved role names', async () => {
  const { env } = await createRealCliEnv();
  const roles = ['work', 'personal', 'client-acme'];
  const sshDir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-fish-ssh-'));
  await writeFile(path.join(sshDir, 'id_work'), 'key', 'utf8');

  const commands = fishCompletions(env, 'gitrole ');
  assert.equal(commands.stderr, '');
  for (const command of commandNames) {
    assert.ok(commands.values.includes(command), commands.values.join(','));
  }
  assert.ok(fishCompletions(env, 'gitrole -').values.includes('-h'));
  assert.ok(fishCompletions(env, 'gitrole -').values.includes('-V'));
  assertSameMembers(fishCompletions(env, 'gitrole use ').values, roles, 'use roles');
  assert.deepEqual(fishCompletions(env, 'gitrole use w').values, ['work']);
  assert.ok(fishCompletions(env, 'gitrole use --').values.includes('--global'));
  assert.ok(fishCompletions(env, 'gitrole use --').values.includes('--local'));
  assert.ok(!fishCompletions(env, 'gitrole use --local --').values.includes('--global'));
  assert.ok(!fishCompletions(env, 'gitrole use --local --').values.includes('--local'));
  assert.deepEqual(fishCompletions(env, 'gitrole import ').values, ['current']);
  assert.ok(fishCompletions(env, 'gitrole import current --').values.includes('--name'));
  assertSameMembers(
    fishCompletions(env, 'gitrole import current --name ').values,
    roles,
    'import roles'
  );
  assert.deepEqual(fishCompletions(env, 'gitrole import current --name c').values, ['client-acme']);
  assert.deepEqual(fishCompletions(env, 'gitrole remote ').values, ['set']);
  assertSameMembers(fishCompletions(env, 'gitrole remote set ').values, roles, 'remote roles');
  for (const flag of ['--name', '--email', '--ssh', '--github-user', '--github-host']) {
    assert.ok(fishCompletions(env, 'gitrole add --').values.includes(flag), flag);
  }
  assertSameMembers(fishCompletions(env, 'gitrole add ').values, roles, 'add roles');
  assert.deepEqual(fishCompletions(env, 'gitrole add --name ').values, []);
  assert.ok(fishCompletions(env, 'gitrole add --ssh id_w', sshDir).values.includes('id_work'));
  assertSameMembers(fishCompletions(env, 'gitrole pin ').values, roles, 'pin roles');
  assertSameMembers(fishCompletions(env, 'gitrole remove ').values, roles, 'remove roles');
  assert.ok(fishCompletions(env, 'gitrole resolve --').values.includes('--json'));
  assert.ok(fishCompletions(env, 'gitrole status --').values.includes('--short'));
  assert.ok(fishCompletions(env, 'gitrole status --').values.includes('--offline'));
  assert.ok(fishCompletions(env, 'gitrole doctor --').values.includes('--json'));
  assert.deepEqual(fishCompletions(env, 'gitrole current ').values, []);
  assert.equal(fishCompletions(env, 'gitrole use ').stderr, '');
});

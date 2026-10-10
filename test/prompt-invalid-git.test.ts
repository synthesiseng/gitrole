/*
 * An invalid .git path is not a work tree. The prompt stays empty there.
 * Status, doctor, and the pre-commit hook keep their own git checks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('../../shell/gitrole-prompt', import.meta.url));
const cliPath = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));
const examplesDir = fileURLToPath(new URL('../../examples/prompt/', import.meta.url));
const hookPath = fileURLToPath(new URL('../../hooks/pre-commit', import.meta.url));
const zshAvailable = spawnSync('zsh', ['-f', '-c', 'exit 0']).status === 0;
// Resolve Fish before fixtures restrict PATH and change the working directory.
const fishPath = spawnSync('/bin/sh', ['-c', 'command -v fish'], { encoding: 'utf8' }).stdout.trim();
const fishBinary = fishPath ? path.resolve(fishPath) : 'fish';
const fishAvailable = spawnSync(fishBinary, ['--no-config', '-c', 'exit 0']).status === 0;

const alignedShort =
  'role=work scope=local override=true commit=ok remote=ok auth=na policy=na overall=aligned\n';
const misalignedShort =
  'role=no-role scope=local override=true commit=warn remote=ok auth=na policy=na overall=warning\n';
const outsideShort =
  'role=no-role scope=unset override=false commit=warn remote=na auth=na policy=na overall=warning\n';
const httpsShort =
  'role=work scope=local override=true commit=ok remote=ok auth=warn policy=na overall=warning\n';
const alignedSegment = 'gitrole:work ✓\n';
const misalignedSegment = 'gitrole:no-role ⚠\n';
const outsideStatus = `no matching role  warning
  commit unset
  push  default push destination could not be observed
  scope unset
  history no non-merge commits yet
`;
const outsideDoctor = `doctor
  role  no matching role
  scope unset
  local inactive
  commit not set (unset) <not set (unset)>
  repo  not a git repository

checks
  warn role   active commit identity does not match any saved role
  info fix    add a role for the active commit identity or switch to the intended saved role before committing
  warn commit user.name or user.email is not fully configured
  warn commit effective committer identity is incomplete or differs from the effective author identity
  warn repo   not inside a Git repository; remote push identity could not be diagnosed
`;

interface Fixture {
  root: string;
  env: NodeJS.ProcessEnv;
  callsFile: string;
  dirs: Record<string, string>;
}

function git(env: NodeJS.ProcessEnv, args: string[], cwd?: string) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}`);
}

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gitrole-invalid-git-'));
  const home = path.join(root, 'home');
  const bin = path.join(root, 'bin');
  const callsFile = path.join(root, 'calls');
  await mkdir(path.join(home, '.config', 'gitrole'), { recursive: true });
  await mkdir(bin);
  await writeFile(
    path.join(home, '.config', 'gitrole', 'roles.json'),
    `${JSON.stringify({
      roles: [{ name: 'work', fullName: 'Alex Dev', email: 'alex@example.com' }]
    }, null, 2)}\n`
  );
  await writeFile(
    path.join(bin, 'gitrole'),
    `#!/bin/sh\nprintf '%s\\n' \"$*\" >> "$GITROLE_CALLS"\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(cliPath)} \"$@\"\n`
  );
  await chmod(path.join(bin, 'gitrole'), 0o755);
  await writeFile(path.join(bin, 'gitrole-prompt'), await readFile(scriptPath));
  await chmod(path.join(bin, 'gitrole-prompt'), 0o755);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GITROLE_CALLS: callsFile,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8'
  };
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_AUTHOR_NAME',
    'GIT_AUTHOR_EMAIL',
    'GIT_COMMITTER_NAME',
    'GIT_COMMITTER_EMAIL',
    'EMAIL'
  ]) {
    delete env[key];
  }

  await writeFile(env.GIT_CONFIG_GLOBAL as string, '');
  // A clean config alone still allows Git to infer identity from the OS account.
  git(env, ['config', '--global', 'user.useConfigOnly', 'true']);
  git(env, ['config', '--global', 'protocol.file.allow', 'always']);

  const aligned = path.join(root, 'aligned');
  const misaligned = path.join(root, 'misaligned');
  const httpsRepo = path.join(root, 'https-repo');
  const plain = path.join(root, 'plain');
  const emptyGit = path.join(root, 'empty-git');
  const corrupt = path.join(root, 'corrupt-git');
  const gitfileMissing = path.join(root, 'gitfile-missing');
  const gitfileGarbage = path.join(root, 'gitfile-garbage');
  const gitfileEmpty = path.join(root, 'gitfile-empty');
  const gitfileBadTarget = path.join(root, 'gitfile-bad-target');
  const symlinkMissing = path.join(root, 'symlink-missing');
  const bareRepo = path.join(root, 'bare.git');
  const child = path.join(root, 'child');
  const parent = path.join(root, 'parent');

  await mkdir(plain, { recursive: true });
  await mkdir(path.join(emptyGit, '.git'), { recursive: true });
  await mkdir(path.join(emptyGit, 'nested'), { recursive: true });
  await mkdir(path.join(corrupt, '.git'), { recursive: true });
  await writeFile(path.join(corrupt, '.git', 'HEAD'), 'not a repo\n');
  await writeFile(path.join(corrupt, '.git', 'config'), 'junk\n');
  await mkdir(gitfileMissing, { recursive: true });
  await writeFile(path.join(gitfileMissing, '.git'), `gitdir: ${path.join(root, 'missing-gitdir')}\n`);
  await mkdir(gitfileGarbage, { recursive: true });
  await writeFile(path.join(gitfileGarbage, '.git'), 'this is not a gitfile\n');
  await mkdir(gitfileEmpty, { recursive: true });
  await writeFile(path.join(gitfileEmpty, '.git'), '');
  await mkdir(path.join(root, 'not-a-repo'), { recursive: true });
  await mkdir(gitfileBadTarget, { recursive: true });
  await writeFile(path.join(gitfileBadTarget, '.git'), `gitdir: ${path.join(root, 'not-a-repo')}\n`);
  await mkdir(symlinkMissing, { recursive: true });
  await symlink(path.join(root, 'missing-symlink'), path.join(symlinkMissing, '.git'));

  function initIdentity(dir: string, name: string, email: string, origin: string) {
    git(env, ['init', '-b', 'main', dir]);
    git(env, ['config', 'user.name', name], dir);
    git(env, ['config', 'user.email', email], dir);
    git(env, ['commit', '--allow-empty', '-m', 'init'], dir);
    git(env, ['remote', 'add', 'origin', origin], dir);
  }

  initIdentity(aligned, 'Alex Dev', 'alex@example.com', 'git@github.com:alex/repo.git');
  await mkdir(path.join(aligned, 'nested'));
  git(env, ['worktree', 'add', path.join(root, 'worktree'), 'HEAD'], aligned);
  initIdentity(misaligned, 'Other Person', 'other@example.com', 'git@github.com:alex/repo.git');
  initIdentity(httpsRepo, 'Alex Dev', 'alex@example.com', 'https://github.com/alex/repo.git');
  git(env, ['init', '--bare', '-b', 'main', bareRepo]);

  git(env, ['init', '-b', 'main', child]);
  git(env, ['config', 'user.name', 'Alex Dev'], child);
  git(env, ['config', 'user.email', 'alex@example.com'], child);
  git(env, ['commit', '--allow-empty', '-m', 'child'], child);
  git(env, ['init', '-b', 'main', parent]);
  git(env, ['config', 'user.name', 'Alex Dev'], parent);
  git(env, ['config', 'user.email', 'alex@example.com'], parent);
  git(env, ['-c', 'protocol.file.allow=always', 'submodule', 'add', child, 'sub'], parent);
  git(env, ['commit', '-m', 'add submodule'], parent);
  const submodule = path.join(parent, 'sub');
  git(env, ['config', 'user.name', 'Alex Dev'], submodule);
  git(env, ['config', 'user.email', 'alex@example.com'], submodule);
  git(env, ['remote', 'set-url', 'origin', 'git@github.com:alex/sub.git'], submodule);

  return {
    root,
    env,
    callsFile,
    dirs: {
      plain,
      emptyGit,
      nestedEmpty: path.join(emptyGit, 'nested'),
      corrupt,
      gitfileMissing,
      gitfileGarbage,
      gitfileEmpty,
      gitfileBadTarget,
      symlinkMissing,
      bareRepo,
      aligned,
      nestedAligned: path.join(aligned, 'nested'),
      misaligned,
      httpsRepo,
      worktree: path.join(root, 'worktree'),
      submodule
    }
  };
}

function runHelper(fixture: Fixture, cwd: string) {
  return spawnSync(scriptPath, [], { cwd, env: fixture.env, encoding: 'utf8' });
}

function runCli(fixture: Fixture, cwd: string, args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env: fixture.env,
    encoding: 'utf8'
  });
}

async function calls(fixture: Fixture): Promise<string> {
  try {
    return await readFile(fixture.callsFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }

    throw error;
  }
}

async function resetCalls(fixture: Fixture) {
  await writeFile(fixture.callsFile, '');
}

function assertResult(
  result: { status: number | null; stdout: string; stderr: string },
  expected: { status: number; stdout: string; stderr: string },
  label: string
) {
  assert.equal(result.status, expected.status, `${label} exit\n${result.stderr}`);
  assert.equal(result.stdout, expected.stdout, label);
  assert.equal(result.stderr, expected.stderr, label);
}

test('prompt helper stays empty for invalid .git and unchanged inside a work tree', async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  const shown: Array<[string, string]> = [
    ['aligned', alignedSegment],
    ['nestedAligned', alignedSegment],
    ['worktree', alignedSegment],
    ['submodule', alignedSegment],
    ['misaligned', misalignedSegment]
  ];

  for (const [name, stdout] of shown) {
    await resetCalls(fixture);
    const result = runHelper(fixture, fixture.dirs[name]);
    assertResult(result, { status: 0, stdout, stderr: '' }, name);
    assert.equal(await calls(fixture), 'status --short --offline\n', name);
  }

  const quiet = [
    'plain',
    'emptyGit',
    'nestedEmpty',
    'corrupt',
    'gitfileMissing',
    'gitfileGarbage',
    'gitfileEmpty',
    'gitfileBadTarget',
    'symlinkMissing',
    'bareRepo'
  ];

  for (const name of quiet) {
    await resetCalls(fixture);
    const result = runHelper(fixture, fixture.dirs[name]);
    assertResult(result, { status: 0, stdout: '', stderr: '' }, name);
    assert.equal(await calls(fixture), '', `${name} must not run gitrole`);
  }
});

test('shipped snippets stay empty for invalid .git and unchanged inside a work tree', async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const quiet = ['plain', 'emptyGit', 'corrupt', 'gitfileMissing', 'gitfileGarbage', 'gitfileEmpty', 'gitfileBadTarget'];
  const shown: Array<[string, string]> = [
    ['aligned', 'gitrole:work ✓ '],
    ['misaligned', 'gitrole:no-role ⚠ '],
    ['worktree', 'gitrole:work ✓ '],
    ['submodule', 'gitrole:work ✓ ']
  ];

  function runBash(cwd: string) {
    return spawnSync(
      'bash',
      ['-c', '. "$1"; gitrole_prompt_segment', 'bash', path.join(examplesDir, 'bash.sh')],
      { cwd, env: fixture.env, encoding: 'utf8' }
    );
  }

  function runZsh(snippet: string, cwd: string) {
    return spawnSync(
      'zsh',
      ['-f', '-c', 'source "$1"; gitrole_prompt_segment', 'zsh', path.join(examplesDir, snippet)],
      { cwd, env: fixture.env, encoding: 'utf8' }
    );
  }

  async function assertSnippet(
    label: string,
    cwd: string,
    run: (cwd: string) => ReturnType<typeof spawnSync>,
    stdout: string
  ) {
    await resetCalls(fixture);
    const result = run(cwd);
    assertResult(
      {
        status: result.status ?? 1,
        stdout: typeof result.stdout === 'string' ? result.stdout : '',
        stderr: typeof result.stderr === 'string' ? result.stderr : ''
      },
      { status: 0, stdout, stderr: '' },
      label
    );
    assert.equal(await calls(fixture), stdout === '' ? '' : 'status --short --offline\n', label);
  }

  for (const name of quiet) {
    await assertSnippet(`bash ${name}`, fixture.dirs[name], runBash, '');
  }

  for (const [name, stdout] of shown) {
    await assertSnippet(`bash ${name}`, fixture.dirs[name], runBash, stdout);
  }

  const starship = await readFile(path.join(examplesDir, 'starship.toml'), 'utf8');
  const command = /command = """\n([\s\S]*?)"""/.exec(starship)?.[1];
  const when = /^when = "(.+)"$/m.exec(starship)?.[1];
  const starshipCode = starship
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  assert.equal(when, 'git rev-parse --is-inside-work-tree');
  assert.ok(command);
  assert.doesNotMatch(starshipCode, /detect_folders/);

  async function assertStarship(name: string, stdout: string) {
    await resetCalls(fixture);
    const gated = spawnSync('sh', ['-c', when as string], {
      cwd: fixture.dirs[name],
      env: fixture.env,
      encoding: 'utf8'
    });

    if (stdout === '') {
      assert.notEqual(gated.status, 0, name);
      assert.equal(await calls(fixture), '', name);
      return;
    }

    assert.equal(gated.status, 0, gated.stderr);
    const rendered = spawnSync('sh', ['-c', command as string], {
      cwd: fixture.dirs[name],
      env: fixture.env,
      encoding: 'utf8'
    });
    assertResult(
      { status: rendered.status, stdout: rendered.stdout ?? '', stderr: rendered.stderr ?? '' },
      { status: 0, stdout, stderr: '' },
      `starship ${name}`
    );
    assert.equal(await calls(fixture), 'status --short --offline\n', name);
  }

  for (const name of quiet) {
    await assertStarship(name, '');
  }

  await assertStarship('aligned', alignedSegment);
  await assertStarship('misaligned', misalignedSegment);
  await assertStarship('worktree', alignedSegment);
  await assertStarship('submodule', alignedSegment);

  if (zshAvailable) {
    for (const snippet of ['zsh.zsh', 'oh-my-zsh.zsh']) {
      for (const name of quiet) {
        await assertSnippet(`${snippet} ${name}`, fixture.dirs[name], (cwd) => runZsh(snippet, cwd), '');
      }

      for (const [name, stdout] of shown) {
        await assertSnippet(`${snippet} ${name}`, fixture.dirs[name], (cwd) => runZsh(snippet, cwd), stdout);
      }
    }
  }

  if (fishAvailable) {
    async function assertFish(name: string, stdout: string) {
      await resetCalls(fixture);
      const fishSource = path.join(examplesDir, 'fish.fish').replaceAll("'", "'\\''");
      const result = spawnSync(
        fishBinary,
        [
          '--no-config',
          '-c',
          `function fish_prompt; printf BASE; end; source '${fishSource}'; fish_prompt`
        ],
        { cwd: fixture.dirs[name], env: fixture.env, encoding: 'utf8' }
      );
      assertResult(
        { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' },
        { status: 0, stdout, stderr: '' },
        `fish ${name}`
      );
      assert.equal(
        await calls(fixture),
        stdout === 'BASE' ? '' : 'status --short --offline\n',
        `fish ${name}`
      );
    }

    for (const name of quiet) {
      await assertFish(name, 'BASE');
    }

    await assertFish('aligned', 'gitrole:work ✓ BASE');
    await assertFish('misaligned', 'gitrole:no-role ⚠ BASE');
    await assertFish('worktree', 'gitrole:work ✓ BASE');
    await assertFish('submodule', 'gitrole:work ✓ BASE');
  }
});

test('status, doctor, and the pre-commit hook keep git detection outside the prompt', async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const likePlain = ['plain', 'emptyGit', 'nestedEmpty', 'corrupt', 'symlinkMissing', 'bareRepo'];

  for (const name of likePlain) {
    const short = runCli(fixture, fixture.dirs[name], ['status', '--short']);
    const offline = runCli(fixture, fixture.dirs[name], ['status', '--short', '--offline']);
    const full = runCli(fixture, fixture.dirs[name], ['status']);
    const doctor = runCli(fixture, fixture.dirs[name], ['doctor']);
    assertResult(short, { status: 2, stdout: outsideShort, stderr: '' }, `${name} status --short`);
    assertResult(offline, { status: 2, stdout: outsideShort, stderr: '' }, `${name} status --short --offline`);
    assertResult(full, { status: 2, stdout: outsideStatus, stderr: '' }, `${name} status`);
    assertResult(doctor, { status: 2, stdout: outsideDoctor, stderr: '' }, `${name} doctor`);
  }

  const offlineAligned = runCli(fixture, fixture.dirs.aligned, ['status', '--short', '--offline']);
  assertResult(offlineAligned, { status: 0, stdout: alignedShort, stderr: '' }, 'aligned offline');
  const offlineMisaligned = runCli(fixture, fixture.dirs.misaligned, ['status', '--short', '--offline']);
  assertResult(offlineMisaligned, { status: 2, stdout: misalignedShort, stderr: '' }, 'misaligned offline');
  const offlineWorktree = runCli(fixture, fixture.dirs.worktree, ['status', '--short', '--offline']);
  assertResult(offlineWorktree, { status: 0, stdout: alignedShort, stderr: '' }, 'worktree offline');
  const offlineSubmodule = runCli(fixture, fixture.dirs.submodule, ['status', '--short', '--offline']);
  assertResult(offlineSubmodule, { status: 0, stdout: alignedShort, stderr: '' }, 'submodule offline');

  assertResult(
    runCli(fixture, fixture.dirs.httpsRepo, ['status', '--short']),
    { status: 2, stdout: httpsShort, stderr: '' },
    'HTTPS status retains its combined readiness warning'
  );

  const hook = await readFile(hookPath, 'utf8');
  assert.match(hook, /gitrole check commit/);
  const hookRun = (cwd: string) =>
    spawnSync(hookPath, [], { cwd, env: fixture.env, encoding: 'utf8' });
  const plainHook = hookRun(fixture.dirs.plain);
  assert.equal(plainHook.status, 2);
  assert.equal(plainHook.stdout, '');
  assert.match(plainHook.stderr, /--no-verify/);
  const damagedHook = hookRun(fixture.dirs.emptyGit);
  assert.equal(damagedHook.status, 1);
  assert.equal(damagedHook.stdout, '');
  assert.match(damagedHook.stderr, /--no-verify/);
  assertResult(
    hookRun(fixture.dirs.httpsRepo),
    { status: 0, stdout: '', stderr: '' },
    'hook permits valid local identity independently of HTTPS auth'
  );

  const broken = [
    ['gitfileMissing', /fatal: not a git repository/],
    ['gitfileGarbage', /fatal: invalid gitfile format/],
    ['gitfileEmpty', /fatal: invalid gitfile format/],
    ['gitfileBadTarget', /fatal: not a git repository/]
  ] as const;

  for (const [name, fatal] of broken) {
    for (const args of [['status', '--short', '--offline'], ['status'], ['doctor']] as const) {
      const result = runCli(fixture, fixture.dirs[name], [...args]);
      assert.equal(result.status, 1, `${name} ${args.join(' ')}`);
      assert.equal(result.stdout, '', `${name} ${args.join(' ')}`);
      assert.match(
        result.stderr,
        /^error: Command failed: git config --global --get user\.(name|email)\n/,
        `${name} ${args.join(' ')}`
      );
      assert.match(result.stderr, fatal, `${name} ${args.join(' ')}`);
    }
  }
});

for (const configScope of ['local', 'global']) {
  test(`prompt warns on malformed ${configScope} config in a real work tree`, async (t) => {
    const fixture = await makeFixture();
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const configPath = configScope === 'local'
      ? path.join(fixture.dirs.aligned, '.git/config') : fixture.env.GIT_CONFIG_GLOBAL as string;
    const original = await readFile(configPath, 'utf8');
    await writeFile(configPath, `${original}\n[broken\n`);
    for (let i = 0; i < 2; i++) {
      const result = runHelper(fixture, fixture.dirs.aligned);
      assertResult(result, { status: 0, stdout: 'gitrole:? ⚠\n', stderr: '' }, configScope);
      assert.equal(await calls(fixture), '', 'do not run status when discovery failed');
    }
    await writeFile(configPath, original);
    assertResult(runHelper(fixture, fixture.dirs.aligned),
      { status: 0, stdout: alignedSegment, stderr: '' }, 'recovery');
  });
}

test('prompt warns when Git is missing and explicit formatting still needs no Git', async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const env = { ...fixture.env, PATH: path.join(fixture.root, 'bin') };
  const result = spawnSync(scriptPath, [], { cwd: fixture.dirs.aligned, env, encoding: 'utf8' });
  assertResult(result, { status: 0, stdout: 'gitrole:? ⚠\n', stderr: '' }, 'missing Git');
  assert.equal(await calls(fixture), '');
  const formatted = spawnSync(scriptPath, ['--format'], {
    cwd: fixture.dirs.aligned, env, input: alignedShort, encoding: 'utf8'
  });
  assertResult(formatted, { status: 0, stdout: alignedSegment, stderr: '' }, 'explicit format');
});

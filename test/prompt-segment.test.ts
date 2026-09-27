/*
 * Locks the prompt segment parsed from status --short --offline.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ReservedRoleNameError, validateRoleName } from '../src/domain/role.js';
import {
  httpsPinAligned,
  statusShortBaseline,
  statusShortPolicyWarn
} from './fixtures/status-short.js';

const scriptPath = fileURLToPath(new URL('../../shell/gitrole-prompt', import.meta.url));
const cliPath = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));
const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));
const readmePath = fileURLToPath(new URL('../../README.md', import.meta.url));
const promptSourcePath = fileURLToPath(new URL('../../shell/gitrole-prompt', import.meta.url));
const promptExamplesDir = fileURLToPath(new URL('../../examples/prompt/', import.meta.url));
const promptGuidePath = fileURLToPath(
  new URL('../../docs/guides/show-gitrole-in-your-shell-prompt.md', import.meta.url)
);
const contractsPath = fileURLToPath(new URL('../../docs/machine-readable-contracts.md', import.meta.url));

const alignedSegment = 'gitrole:work ✓';
const warningSegment = 'gitrole:work ⚠';
const unknownSegment = 'gitrole:? ⚠';

const fakeGitrole = `#!/bin/sh
printf '%s\\n' "$*" >> "$GITROLE_FAKE_ARGS"
if [ "\${GITROLE_FAKE_MULTILINE:-}" = 1 ]; then
  printf '%s\\n%s\\n' "\${GITROLE_FAKE_LINE}" extra=1
  exit 0
fi
status=\${GITROLE_FAKE_EXIT:-0}
if [ "$status" -eq 1 ]; then
  printf '%s\\n' 'error: saved role data is invalid' >&2
  exit 1
fi
printf '%s\\n' "\${GITROLE_FAKE_LINE}"
exit "$status"
`;

async function makeWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gitrole-prompt-'));
  const repo = path.join(root, 'repo dir');
  const bin = path.join(root, 'bin');
  const argsFile = path.join(root, 'args');

  await mkdir(repo, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, 'gitrole'), fakeGitrole, 'utf8');
  await chmod(path.join(bin, 'gitrole'), 0o755);
  spawnSync('git', ['init', '-b', 'main'], { cwd: repo, encoding: 'utf8' });

  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: path.join(root, 'home'),
    TMPDIR: os.tmpdir(),
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    GITROLE_FAKE_ARGS: argsFile,
    GITROLE_FAKE_LINE:
      'role=work scope=local override=true commit=ok remote=ok auth=na policy=na overall=aligned'
  };

  return { root, repo, argsFile, env };
}

function runPrompt(
  cwd: string,
  env: NodeJS.ProcessEnv,
  args: string[] = [],
  input?: string
) {
  return spawnSync(scriptPath, args, {
    cwd,
    env,
    input,
    encoding: 'utf8'
  });
}

async function readArgs(argsFile: string): Promise<string> {
  try {
    return await readFile(argsFile, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === 'ENOENT') {
      return '';
    }

    throw error;
  }
}

test('prompt segment checks commit and policy and does not treat auth as verified', () => {
  const cases: Array<[string, string]> = [
    [statusShortBaseline.line, warningSegment],
    [statusShortPolicyWarn.line, 'gitrole:client-acme ⚠'],
    [httpsPinAligned.line, alignedSegment],
    [
      'role=personal scope=local override=true commit=ok remote=ok auth=warn policy=warn overall=warning',
      'gitrole:personal ⚠'
    ],
    [
      'role=no-role scope=global override=false commit=warn remote=ok auth=na policy=na overall=warning',
      'gitrole:no-role ⚠'
    ],
    // Hand-built aligned line. Glyphs follow the status fields, including role=no-role.
    [
      'role=no-role scope=global override=false commit=ok remote=ok auth=na policy=na overall=aligned',
      'gitrole:no-role ✓'
    ],
    // auth=ok is not produced by status --offline. no-role does not change that glyph.
    [
      'role=no-role scope=global override=false commit=ok remote=ok auth=ok policy=na overall=aligned',
      'gitrole:no-role ⚠'
    ],
    ['overall=aligned role=agent_bot', unknownSegment],
    [
      'role=agent_bot scope=local override=true commit=ok remote=ok auth=na policy=na overall=aligned',
      'gitrole:agent_bot ✓'
    ],
    [
      'role=work scope=local override=true commit=ok remote=ok auth=na policy=na overall=aligned',
      alignedSegment
    ],
    [
      'role=work scope=local override=true commit=warn remote=ok auth=na policy=ok overall=warning',
      warningSegment
    ],
    [
      'role=work scope=local override=true commit=ok remote=warn auth=na policy=ok overall=warning',
      warningSegment
    ],
    // auth=ok is not produced by status --offline. The formatter still prints the role with ⚠.
    [
      'role=work scope=local override=true commit=ok remote=ok auth=ok policy=ok overall=aligned',
      warningSegment
    ],
    ['role=Work overall=aligned', unknownSegment],
    ['role= overall=aligned', unknownSegment],
    ['role=work', unknownSegment],
    ['not a status line', unknownSegment],
    ['', unknownSegment]
  ];

  for (const [line, expected] of cases) {
    const result = runPrompt(os.tmpdir(), { PATH: '/usr/bin:/bin' }, ['--format'], `${line}\n`);

    assert.equal(result.status, 0, line);
    assert.equal(result.stdout, `${expected}\n`, line);
    assert.equal(result.stderr, '', line);
  }
});

test('prompt segment stays quiet outside a git work tree and does not run status', async () => {
  const workspace = await makeWorkspace();
  const outside = path.join(workspace.root, 'outside');
  await mkdir(outside);

  const result = runPrompt(outside, workspace.env);

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.equal(await readArgs(workspace.argsFile), '');
});

test('prompt segment calls status --short --offline on every run and does not cache', async () => {
  const workspace = await makeWorkspace();
  const first = runPrompt(workspace.repo, workspace.env);
  const second = runPrompt(workspace.repo, workspace.env);

  assert.equal(first.status, 0);
  assert.equal(first.stdout, `${alignedSegment}\n`);
  assert.equal(second.stdout, `${alignedSegment}\n`);
  assert.equal(
    await readArgs(workspace.argsFile),
    'status --short --offline\nstatus --short --offline\n'
  );

  const afterAuthor = runPrompt(workspace.repo, {
    ...workspace.env,
    GIT_AUTHOR_EMAIL: 'other@example.com',
    GITROLE_FAKE_LINE:
      'role=work scope=local override=true commit=warn remote=ok auth=na policy=na overall=warning'
  });

  assert.equal(afterAuthor.stdout, `${warningSegment}\n`);
  assert.equal((await readArgs(workspace.argsFile)).trim().split('\n').length, 3);
  assert.doesNotMatch(await readArgs(workspace.argsFile), /status --short\n/);
  assert.doesNotMatch(await readFile(promptSourcePath, 'utf8'), /GITROLE_PROMPT_CACHE/);
});

test('prompt segment treats offline exit 2 as a warning and exit 1 as unknown', async () => {
  const warned = await makeWorkspace();
  const warning = runPrompt(warned.repo, {
    ...warned.env,
    GITROLE_FAKE_EXIT: '2',
    GITROLE_FAKE_LINE:
      'role=work scope=local override=true commit=ok remote=ok auth=na policy=na overall=warning'
  });

  assert.equal(warning.status, 0);
  assert.equal(warning.stdout, `${warningSegment}\n`);
  assert.equal(warning.stderr, '');
  assert.match(await readArgs(warned.argsFile), /^status --short --offline\n$/);

  const failed = await makeWorkspace();
  const failure = runPrompt(failed.repo, {
    ...failed.env,
    GITROLE_FAKE_EXIT: '1'
  });

  assert.equal(failure.status, 0);
  assert.equal(failure.stdout, `${unknownSegment}\n`);
  assert.equal(failure.stderr, '');
});

test('prompt segment rejects a multiline status line', async () => {
  const workspace = await makeWorkspace();
  const result = runPrompt(workspace.repo, {
    ...workspace.env,
    GITROLE_FAKE_MULTILINE: '1'
  });

  assert.equal(result.stdout, `${unknownSegment}\n`);
  assert.equal(result.status, 0);
});

test('prompt segment reports an unknown role when gitrole is not on PATH', async () => {
  const workspace = await makeWorkspace();
  const result = runPrompt(workspace.repo, {
    ...workspace.env,
    PATH: '/usr/bin:/bin'
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${unknownSegment}\n`);
});

test('prompt helper rejects unknown flags', async () => {
  const workspace = await makeWorkspace();
  const unknown = runPrompt(workspace.repo, workspace.env, ['--refresh']);

  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /usage: gitrole-prompt/);
  assert.equal(await readArgs(workspace.argsFile), '');
});

test('readme, status help, and the helper point at offline status', async () => {
  const readme = await readFile(readmePath, 'utf8');
  const promptSource = await readFile(promptSourcePath, 'utf8');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
    bin: Record<string, string>;
    files: string[];
  };
  const help = spawnSync(process.execPath, [cliPath, 'status', '--help'], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
  });

  assert.match(readme, /gitrole-prompt/);
  assert.match(readme, /show-gitrole-in-your-shell-prompt/);
  assert.match(readme, /examples\/prompt/);
  assert.match(readme, /--short --offline/);
  assert.match(readme, /auth was not checked/);
  assert.match(readme, /does not mean network auth was verified/);
  assert.match(readme, /0\.9\.0 or newer/);
  assert.match(promptSource, /gitrole status --short --offline/);
  assert.match(promptSource, /auth was not checked/);
  assert.match(promptSource, /does not emit auth=ok/);
  assert.match(promptSource, /validateRoleName/);
  assert.match(promptSource, /src\/domain\/role\.ts/);
  assert.doesNotMatch(promptSource, /GITROLE_PROMPT_TTL|GITROLE_PROMPT_CACHE/);
  assert.equal(packageJson.bin['gitrole-prompt'], 'shell/gitrole-prompt');
  assert.ok(packageJson.files.includes('shell'));
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--offline/);
  assert.match(help.stdout, /does not switch roles/);
  assert.match(help.stdout, /status --short --offline/);
  assert.match(help.stdout, /auth was not checked/);
  assert.match(help.stdout, /does not mean network auth was verified/);
});

test('prompt snippets call status --short --offline only and keep the segment contract', async () => {
  const contract = await readFile(path.join(promptExamplesDir, 'README.md'), 'utf8');
  const snippetNames = ['starship.toml', 'oh-my-zsh.zsh', 'zsh.zsh', 'bash.sh', 'fish.fish'];

  assert.match(contract, /gitrole status --short --offline/);
  assert.match(contract, /gitrole:<role> ✓/);
  assert.match(contract, /gitrole:<role> ⚠/);
  assert.match(contract, /gitrole:\? ⚠/);
  assert.match(contract, /does not mean network auth was verified/);
  assert.match(contract, /role scope override commit remote auth policy overall/);
  assert.match(contract, /0\.9\.0 or newer/);
  assert.match(contract, /does not emit `auth=ok`/);
  assert.match(contract, /`gitrole-prompt` is not on `PATH`/);
  assert.doesNotMatch(contract, /GITROLE_PROMPT_TTL|GITROLE_PROMPT_CACHE/);

  const starship = await readFile(path.join(promptExamplesDir, 'starship.toml'), 'utf8');
  const starshipCode = starship
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  assert.match(starshipCode, /git rev-parse --is-inside-work-tree/);
  assert.doesNotMatch(starshipCode, /detect_folders/);

  for (const name of snippetNames) {
    const source = await readFile(path.join(promptExamplesDir, name), 'utf8');
    const code = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    assert.match(code, /gitrole status --short --offline/);
    assert.doesNotMatch(code, /gitrole status(?! --short --offline)/);
    assert.doesNotMatch(source, /--refresh|GITROLE_PROMPT_CACHE/);
  }

  const syntax = spawnSync('bash', ['-n', path.join(promptExamplesDir, 'bash.sh')], {
    encoding: 'utf8'
  });
  assert.equal(syntax.status, 0, syntax.stderr);

  const fakeBin = await mkdtemp(path.join(os.tmpdir(), 'gitrole-prompt-snippet-'));
  const argsFile = path.join(fakeBin, 'args');
  await writeFile(
    path.join(fakeBin, 'gitrole'),
    `#!/bin/sh\nprintf '%s\\n' \"$*\" >> '${argsFile}'\nprintf '%s\\n' 'role=work scope=local override=true commit=ok remote=ok auth=na policy=na overall=aligned'\n`
  );
  await chmod(path.join(fakeBin, 'gitrole'), 0o755);
  await writeFile(path.join(fakeBin, 'gitrole-prompt'), await readFile(scriptPath));
  await chmod(path.join(fakeBin, 'gitrole-prompt'), 0o755);

  const rendered = spawnSync(
    'bash',
    [
      '-c',
      '. "$1"; gitrole_prompt_segment',
      'bash',
      path.join(promptExamplesDir, 'bash.sh')
    ],
    {
      encoding: 'utf8',
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${fakeBin}:/usr/bin:/bin`
      }
    }
  );

  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(rendered.stdout, 'gitrole:work ✓ ');
  assert.equal(await readFile(argsFile, 'utf8'), 'status --short --offline\n');
});

test('prompt guide documents the version floor and the two failure rows', async () => {
  const guide = await readFile(promptGuidePath, 'utf8');
  const contracts = await readFile(contractsPath, 'utf8');

  assert.match(guide, /id="troubleshooting"/);
  assert.match(guide, /0\.9\.0 or newer/);
  assert.match(guide, /`gitrole:\? ⚠`/);
  assert.match(guide, /`gitrole-prompt` is not on `PATH`/);
  assert.match(guide, /does not emit `auth=ok`/);
  assert.match(guide, /detect_folders = \["\.git"\] would not/);
  assert.match(contracts, /does not emit <code>auth=ok<\/code>/);
});

test('prompt segment renders every role name validateRoleName accepts', () => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789-_';
  const names = new Set<string>([
    'organization',
    'azure',
    'zzz',
    'agent_bot',
    'client-acme',
    'a'.repeat(64),
    '-lead',
    '_0'
  ]);

  for (const char of alphabet) {
    names.add(char);
  }

  for (const left of alphabet) {
    for (const right of alphabet) {
      names.add(`${left}${right}`);
    }
  }

  const locales = ['C', 'C.UTF-8'];
  const listed = spawnSync('locale', ['-a'], { encoding: 'utf8' });

  if (listed.stdout.split('\n').some((line) => line === 'en_US.utf8' || line === 'en_US.UTF-8')) {
    locales.push('en_US.UTF-8');
  }

  for (const locale of locales) {
    for (const name of names) {
      assert.equal(validateRoleName(name), name);
      const line = `role=${name} scope=local override=true commit=ok remote=ok auth=na policy=na overall=aligned`;
      const result = runPrompt(
        os.tmpdir(),
        { PATH: '/usr/bin:/bin', LC_ALL: locale },
        ['--format'],
        `${line}\n`
      );

      assert.equal(result.status, 0, `${locale} ${name}`);
      assert.equal(result.stdout, `gitrole:${name} ✓\n`, `${locale} ${name}`);
    }
  }

  for (const name of ['Work', 'A', 'my@role', 'work/main', 'role:prod', 'ä', '']) {
    assert.throws(() => validateRoleName(name));
    const line = `role=${name} scope=local override=true commit=ok remote=ok auth=na policy=na overall=aligned`;
    const result = runPrompt(os.tmpdir(), { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, ['--format'], `${line}\n`);

    assert.equal(result.stdout, `${unknownSegment}\n`, name);
  }

  assert.throws(() => validateRoleName('no-role'), ReservedRoleNameError);
  const reserved = runPrompt(
    os.tmpdir(),
    { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
    ['--format'],
    'role=no-role scope=local override=true commit=ok remote=ok auth=na policy=na overall=aligned\n'
  );

  assert.equal(reserved.stdout, 'gitrole:no-role ✓\n');
});

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
    GITROLE_FAKE_LINE: statusShortBaseline.line
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

test('prompt segment follows overall and role from the short line', () => {
  const cases: Array<[string, string]> = [
    [statusShortBaseline.line, alignedSegment],
    [statusShortPolicyWarn.line, 'gitrole:client-acme ⚠'],
    [httpsPinAligned.line, alignedSegment],
    [
      'role=personal scope=local override=true commit=ok remote=ok auth=warn policy=warn overall=warning',
      'gitrole:personal ⚠'
    ],
    ['overall=warning role=no-role', 'gitrole:no-role ⚠'],
    ['overall=aligned role=agent_bot', 'gitrole:agent_bot ✓'],
    ['role=work scope=local override=true commit=ok remote=ok auth=na policy=na overall=aligned', alignedSegment],
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

test('prompt segment calls only status --short --offline and reruns when local inputs change', async () => {
  const workspace = await makeWorkspace();
  const first = runPrompt(workspace.repo, workspace.env);
  const second = runPrompt(workspace.repo, workspace.env);

  assert.equal(first.status, 0);
  assert.equal(first.stdout, `${alignedSegment}\n`);
  assert.equal(second.stdout, `${alignedSegment}\n`);
  assert.equal(await readArgs(workspace.argsFile), 'status --short --offline\n');

  const configPath = path.join(workspace.repo, '.git', 'config');
  await writeFile(configPath, `${await readFile(configPath, 'utf8')}\n# touched\n`, 'utf8');
  const afterConfig = runPrompt(workspace.repo, {
    ...workspace.env,
    GITROLE_FAKE_LINE:
      'role=personal scope=local override=true commit=ok remote=ok auth=na policy=na overall=warning'
  });

  assert.equal(afterConfig.stdout, 'gitrole:personal ⚠\n');
  assert.equal(
    await readArgs(workspace.argsFile),
    'status --short --offline\nstatus --short --offline\n'
  );

  const afterAuthor = runPrompt(workspace.repo, {
    ...workspace.env,
    GIT_AUTHOR_EMAIL: 'other@example.com',
    GITROLE_FAKE_LINE: 'role=work scope=local override=true commit=warn remote=ok auth=na policy=na overall=warning'
  });

  assert.equal(afterAuthor.stdout, `${warningSegment}\n`);
  assert.equal((await readArgs(workspace.argsFile)).trim().split('\n').length, 3);
  assert.doesNotMatch(await readArgs(workspace.argsFile), /status --short\n/);
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
  assert.match(promptSource, /gitrole status --short --offline/);
  assert.doesNotMatch(promptSource, /GITROLE_PROMPT_TTL/);
  assert.equal(packageJson.bin['gitrole-prompt'], 'shell/gitrole-prompt');
  assert.ok(packageJson.files.includes('shell'));
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--offline/);
  assert.match(help.stdout, /does not switch roles/);
  assert.match(help.stdout, /status --short --offline/);
});

test('prompt snippets call gitrole-prompt and keep the segment contract', async () => {
  const contract = await readFile(path.join(promptExamplesDir, 'README.md'), 'utf8');
  const snippetNames = ['starship.toml', 'oh-my-zsh.zsh', 'zsh.zsh', 'bash.sh', 'fish.fish'];

  assert.match(contract, /gitrole status --short --offline/);
  assert.match(contract, /gitrole:<role> ✓/);
  assert.match(contract, /gitrole:<role> ⚠/);
  assert.match(contract, /gitrole:\? ⚠/);
  assert.match(contract, /role scope override commit remote auth policy overall/);
  assert.doesNotMatch(contract, /GITROLE_PROMPT_TTL/);

  for (const name of snippetNames) {
    const source = await readFile(path.join(promptExamplesDir, name), 'utf8');
    const code = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    assert.match(code, /gitrole-prompt/);
    assert.doesNotMatch(code, /gitrole status/);
    assert.doesNotMatch(source, /--refresh/);
  }

  const syntax = spawnSync('bash', ['-n', path.join(promptExamplesDir, 'bash.sh')], {
    encoding: 'utf8'
  });
  assert.equal(syntax.status, 0, syntax.stderr);

  const fakeBin = await mkdtemp(path.join(os.tmpdir(), 'gitrole-prompt-snippet-'));
  const fakePrompt = path.join(fakeBin, 'gitrole-prompt');
  await writeFile(fakePrompt, '#!/bin/sh\nprintf \'%s\\n\' \'gitrole:work ✓\'\n');
  await chmod(fakePrompt, 0o755);

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
      env: {
        ...process.env,
        PATH: `${fakeBin}:/usr/bin:/bin`
      }
    }
  );

  assert.equal(rendered.status, 0, rendered.stderr);
  assert.equal(rendered.stdout, 'gitrole:work ✓ ');
});

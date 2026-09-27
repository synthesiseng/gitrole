/*
 * Locks the prompt segment parsed from status --short, and the cache around it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
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

const alignedSegment = 'gitrole:work ✓';
const warningSegment = 'gitrole:work ⚠';
const unknownSegment = 'gitrole:? ⚠';

const fakeGitrole = `#!/bin/sh
count_file=$GITROLE_FAKE_COUNT
count=0
if [ -f "$count_file" ]; then
  count=$(cat "$count_file")
fi
count=$((count + 1))
printf '%s\\n' "$count" > "$count_file"
if [ "$count" -ge 2 ] && [ -n "\${GITROLE_FAKE_SLEEP2:-}" ]; then
  sleep "$GITROLE_FAKE_SLEEP2"
fi
if [ -n "\${GITROLE_FAKE_SLEEP:-}" ]; then
  sleep "$GITROLE_FAKE_SLEEP"
fi
if [ "\${GITROLE_FAKE_MULTILINE:-}" = 1 ]; then
  printf '%s\\n%s\\n' "\${GITROLE_FAKE_LINE}" extra=1
  exit 0
fi
status=\${GITROLE_FAKE_EXIT:-0}
if [ "$status" -eq 1 ]; then
  printf '%s\\n' 'error: saved role data is invalid' >&2
  exit 1
fi
if [ "$count" -ge 2 ] && [ -n "\${GITROLE_FAKE_LINE2:-}" ]; then
  printf '%s\\n' "$GITROLE_FAKE_LINE2"
else
  printf '%s\\n' "\${GITROLE_FAKE_LINE}"
fi
exit "$status"
`;

function runGit(repo: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function readCount(countFile: string): Promise<number> {
  try {
    return Number((await readFile(countFile, 'utf8')).trim());
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === 'ENOENT') {
      return 0;
    }

    throw error;
  }
}

async function makeWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gitrole-prompt-'));
  const repo = path.join(root, 'repo dir');
  const home = path.join(root, 'home');
  const cache = path.join(root, 'cache');
  const bin = path.join(root, 'bin');
  const countFile = path.join(root, 'count');

  await mkdir(repo, { recursive: true });
  await mkdir(home, { recursive: true });
  await mkdir(cache, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, 'gitrole'), fakeGitrole, 'utf8');
  await chmod(path.join(bin, 'gitrole'), 0o755);

  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: home,
    TMPDIR: os.tmpdir(),
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    GITROLE_PROMPT_CACHE: cache,
    GITROLE_FAKE_COUNT: countFile,
    GITROLE_FAKE_LINE: statusShortBaseline.line
  };

  runGit(repo, ['init', '-b', 'main'], env);

  return { root, repo, home, cache, countFile, env };
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
  assert.equal(await readCount(workspace.countFile), 0);
});

test('prompt segment caches a fresh short line and refreshes when local inputs change', async () => {
  const workspace = await makeWorkspace();
  const subdir = path.join(workspace.repo, 'nested');
  await mkdir(subdir);

  const first = runPrompt(subdir, workspace.env);
  const second = runPrompt(workspace.repo, workspace.env);

  assert.equal(first.status, 0);
  assert.equal(first.stdout, `${alignedSegment}\n`);
  assert.equal(second.stdout, `${alignedSegment}\n`);
  assert.equal(await readCount(workspace.countFile), 1);

  await writeFile(path.join(workspace.repo, '.gitrole'), '{}\n', 'utf8');
  const afterPolicy = runPrompt(workspace.repo, {
    ...workspace.env,
    GITROLE_FAKE_LINE2:
      'role=client-acme scope=local override=true commit=ok remote=ok auth=ok policy=warn overall=warning'
  });

  assert.equal(afterPolicy.stdout, 'gitrole:client-acme ⚠\n');
  assert.equal(await readCount(workspace.countFile), 2);

  const configPath = path.join(workspace.repo, '.git', 'config');
  await writeFile(configPath, `${await readFile(configPath, 'utf8')}\n# touched\n`, 'utf8');
  const afterConfig = runPrompt(workspace.repo, {
    ...workspace.env,
    GITROLE_FAKE_LINE: statusShortBaseline.line,
    GITROLE_FAKE_LINE2: 'role=personal scope=local override=true commit=ok remote=ok auth=warn policy=na overall=warning'
  });

  assert.equal(afterConfig.stdout, 'gitrole:personal ⚠\n');
  assert.equal(await readCount(workspace.countFile), 3);

  const rolesDir = path.join(workspace.home, '.config', 'gitrole');
  await mkdir(rolesDir, { recursive: true });
  await writeFile(path.join(rolesDir, 'roles.json'), '{"roles":[]}\n', 'utf8');
  const afterRoles = runPrompt(workspace.repo, workspace.env);

  assert.equal(afterRoles.stdout, `${alignedSegment}\n`);
  assert.equal(await readCount(workspace.countFile), 4);

  const afterAuthor = runPrompt(workspace.repo, {
    ...workspace.env,
    GIT_AUTHOR_EMAIL: 'other@example.com',
    GITROLE_FAKE_LINE2: 'role=personal scope=global override=false commit=warn remote=ok auth=ok policy=na overall=warning'
  });

  assert.equal(afterAuthor.stdout, 'gitrole:personal ⚠\n');
  assert.equal(await readCount(workspace.countFile), 5);

  runGit(
    workspace.repo,
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'init'
    ],
    workspace.env
  );
  const afterCommit = runPrompt(workspace.repo, workspace.env);

  assert.equal(afterCommit.stdout, `${alignedSegment}\n`);
  assert.equal(await readCount(workspace.countFile), 6);
});

test('prompt segment treats status exit 2 as a warning line and exit 1 as unknown', async () => {
  const warned = await makeWorkspace();
  const warning = runPrompt(warned.repo, {
    ...warned.env,
    GITROLE_FAKE_EXIT: '2',
    GITROLE_FAKE_LINE:
      'role=work scope=local override=true commit=ok remote=ok auth=warn policy=na overall=warning'
  });

  assert.equal(warning.status, 0);
  assert.equal(warning.stdout, `${warningSegment}\n`);
  assert.equal(warning.stderr, '');
  assert.equal(await readCount(warned.countFile), 1);

  const cachedWarning = runPrompt(warned.repo, warned.env);
  assert.equal(cachedWarning.stdout, `${warningSegment}\n`);
  assert.equal(await readCount(warned.countFile), 1);

  const failed = await makeWorkspace();
  const failure = runPrompt(failed.repo, {
    ...failed.env,
    GITROLE_FAKE_EXIT: '1'
  });

  assert.equal(failure.status, 0);
  assert.equal(failure.stdout, `${unknownSegment}\n`);
  assert.equal(failure.stderr, '');
  assert.equal(await readCount(failed.countFile), 1);

  const cachedFailure = runPrompt(failed.repo, failed.env);
  assert.equal(cachedFailure.stdout, `${unknownSegment}\n`);
  assert.equal(await readCount(failed.countFile), 1);
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

test('prompt segment follows a linked gitdir file', async () => {
  const workspace = await makeWorkspace();
  const linked = path.join(workspace.root, 'linked dir');
  await mkdir(linked);
  await writeFile(path.join(linked, '.git'), `gitdir: ${path.join(workspace.repo, '.git')}\n`, 'utf8');

  const first = runPrompt(linked, workspace.env);
  assert.equal(first.stdout, `${alignedSegment}\n`);
  assert.equal(await readCount(workspace.countFile), 1);

  const configPath = path.join(workspace.repo, '.git', 'config');
  await writeFile(configPath, `${await readFile(configPath, 'utf8')}\n# linked\n`, 'utf8');
  const second = runPrompt(linked, {
    ...workspace.env,
    GITROLE_FAKE_LINE2: 'role=personal scope=local override=true commit=warn remote=ok auth=ok policy=na overall=warning'
  });

  assert.equal(second.stdout, 'gitrole:personal ⚠\n');
  assert.equal(await readCount(workspace.countFile), 2);
});

test('prompt TTL expiry prints the cached segment without waiting for status', async () => {
  const workspace = await makeWorkspace();
  const first = runPrompt(workspace.repo, workspace.env);
  assert.equal(first.stdout, `${alignedSegment}\n`);

  const cacheDirs = await listCacheDirs(workspace.cache);
  assert.equal(cacheDirs.length, 1);
  await writeFile(path.join(cacheDirs[0], 'cached_at'), '0\n', 'utf8');

  const started = Date.now();
  const stale = runPrompt(workspace.repo, {
    ...workspace.env,
    GITROLE_FAKE_SLEEP2: '1',
    GITROLE_FAKE_LINE2:
      'role=personal scope=local override=true commit=ok remote=ok auth=warn policy=na overall=warning'
  });
  const elapsed = Date.now() - started;

  assert.equal(stale.status, 0);
  assert.equal(stale.stdout, `${alignedSegment}\n`);
  assert.ok(elapsed < 700, `stale prompt waited ${elapsed}ms`);

  const deadline = Date.now() + 4000;
  let refreshed = '';

  while (Date.now() < deadline) {
    refreshed = await readFile(path.join(cacheDirs[0], 'segment'), 'utf8');

    if (refreshed.includes('personal')) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.equal(refreshed.trim(), 'gitrole:personal ⚠');
  assert.equal(await readCount(workspace.countFile), 2);

  const next = runPrompt(workspace.repo, workspace.env);
  assert.equal(next.stdout, 'gitrole:personal ⚠\n');
  assert.equal(await readCount(workspace.countFile), 2);
});

test('prompt fingerprint mismatch waits for a live status', async () => {
  const workspace = await makeWorkspace();
  const first = runPrompt(workspace.repo, workspace.env);
  assert.equal(first.stdout, `${alignedSegment}\n`);

  const configPath = path.join(workspace.repo, '.git', 'config');
  await writeFile(configPath, `${await readFile(configPath, 'utf8')}\n# sync\n`, 'utf8');

  const started = Date.now();
  const refreshed = runPrompt(workspace.repo, {
    ...workspace.env,
    GITROLE_FAKE_SLEEP: '0.4',
    GITROLE_FAKE_LINE2: 'role=personal scope=local override=true commit=warn remote=ok auth=ok policy=na overall=warning'
  });
  const elapsed = Date.now() - started;

  assert.equal(refreshed.stdout, 'gitrole:personal ⚠\n');
  assert.ok(elapsed >= 350, `sync prompt returned in ${elapsed}ms`);
  assert.equal(await readCount(workspace.countFile), 2);
});

test('prompt TTL 0 and --refresh both rerun status', async () => {
  const workspace = await makeWorkspace();

  runPrompt(workspace.repo, { ...workspace.env, GITROLE_PROMPT_TTL: '0' });
  runPrompt(workspace.repo, { ...workspace.env, GITROLE_PROMPT_TTL: '0' });
  assert.equal(await readCount(workspace.countFile), 2);

  const cached = await makeWorkspace();
  runPrompt(cached.repo, cached.env);
  runPrompt(cached.repo, cached.env, ['--refresh']);
  assert.equal(await readCount(cached.countFile), 2);

  const unknown = runPrompt(cached.repo, cached.env, ['--nope']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /usage: gitrole-prompt/);
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

test('readme and status help point at the prompt helper', async () => {
  const readme = await readFile(readmePath, 'utf8');
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
  assert.equal(packageJson.bin['gitrole-prompt'], 'shell/gitrole-prompt');
  assert.ok(packageJson.files.includes('shell'));
  assert.equal(help.status, 0);
  assert.match(help.stdout, /gitrole-prompt/);
  assert.match(help.stdout, /does not switch roles/);
});

async function listCacheDirs(cacheRoot: string): Promise<string[]> {
  const entries = await readdir(cacheRoot, { withFileTypes: true });

  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(cacheRoot, entry.name));
}

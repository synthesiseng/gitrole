/* Verifies remote-set reporting and preservation using isolated Git configuration. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SystemGitRepository } from '../src/adapters/git-repository.js';
import { useRemoteForRole } from '../src/application/use-cases/remote.js';

const role = { name: 'work', fullName: 'Test Person', email: 'test@example.invalid', githubHost: 'github.com-work' };
const target = 'git@github.com-work:example/project.git';
const cli = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));

test('remote set no-op does not attempt a Git write', async () => {
  const calls: string[][] = [];
  const repository = new SystemGitRepository({ exec: async (_file, args) => {
    calls.push(args);
    if (args.join(' ') === 'remote get-url origin') return { stdout: `${target}\n`, stderr: '' };
    if (args[0] === 'remote' && args[1] === 'set-url') return { stdout: '', stderr: '' };
    throw new Error(`unexpected Git command ${JSON.stringify(args)}`);
  } });
  const result = await useRemoteForRole({ repository,
    roleStore: { get: async () => role, list: async () => [role], save: async () => {}, remove: async () => false }
  }, 'work');
  assert.equal(result.previousUrl, target);
  assert.equal(result.nextUrl, target);
  assert.equal(calls.some((args) => args[1] === 'set-url'), false, JSON.stringify(calls));
});

test('remote set identifies fetch-only updates and no-ops while preserving push destinations', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gitrole-remote-reporting-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const env = { PATH: process.env.PATH, HOME: dir, XDG_CONFIG_HOME: dir,
    GIT_CONFIG_GLOBAL: path.join(dir, 'global.gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_CEILING_DIRECTORIES: dir, GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1',
    SSH_AUTH_SOCK: path.join(dir, 'absent-agent') };
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  const run = () => spawnSync(process.execPath, [cli, 'remote', 'set', 'work'], { cwd: dir, env, encoding: 'utf8' });
  git('init', '-q'); git('remote', 'add', 'origin', 'https://github.com/example/project.git');
  git('remote', 'set-url', '--add', '--push', 'origin', 'git@github.com-personal:personal/project.git');
  git('remote', 'set-url', '--add', '--push', 'origin', 'https://github.com/mirror/project.git');
  git('remote', 'add', 'publish', 'https://github.com/publish/project.git');
  git('config', 'remote.pushDefault', 'publish');
  await mkdir(path.join(dir, 'gitrole'));
  const rolesFile = path.join(dir, 'gitrole/roles.json');
  const roles = JSON.stringify({ roles: [role] }); await writeFile(rolesFile, roles);
  const pushUrls = git('remote', 'get-url', '--push', '--all', 'origin');
  const changed = run();
  assert.equal(changed.status, 0, changed.stderr);
  assert.equal(git('remote', 'get-url', 'origin'), target);
  assert.equal(git('remote', 'get-url', '--push', '--all', 'origin'), pushUrls);
  assert.equal(git('config', 'remote.pushDefault'), 'publish');
  assert.equal(git('remote', 'get-url', '--push', 'publish'), 'https://github.com/publish/project.git');
  assert.match(changed.stdout, /updated remote origin fetch URL/);
  assert.match(changed.stdout, /Separate push URLs.*unchanged/);
  assert.match(changed.stdout, /gitrole status --short --offline/);
  const config = await readFile(path.join(dir, '.git/config'), 'utf8');
  const unchanged = run();
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.match(unchanged.stdout, /origin fetch URL already matches/);
  assert.doesNotMatch(unchanged.stdout, /updated remote/);
  assert.equal(await readFile(path.join(dir, '.git/config'), 'utf8'), config);
  assert.equal(await readFile(rolesFile, 'utf8'), roles);
});

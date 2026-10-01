/*
 * Exercises both source prompt snippets in native zsh with isolated local state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const examples = fileURLToPath(new URL('../../examples/prompt/', import.meta.url));
const formatter = fileURLToPath(new URL('../../shell/gitrole-prompt', import.meta.url));
const cli = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));
const zshAvailable = spawnSync('zsh', ['-f', '-c', 'exit 0']).status === 0;
const aligned = 'role=work scope=local override=true commit=ok remote=ok auth=na policy=na overall=aligned';

async function executable(file: string, body: string) {
  await writeFile(file, body, 'utf8');
  await chmod(file, 0o755);
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gitrole-zsh-'));
  const repo = path.join(root, 'repo dir');
  const bin = path.join(root, 'bin');
  const outside = path.join(root, 'outside');
  const nested = path.join(repo, 'nested dir');
  const calls = path.join(root, 'calls');
  const forbidden = path.join(root, 'forbidden');
  const config = path.join(root, 'config');
  await Promise.all([mkdir(bin), mkdir(outside), mkdir(nested, { recursive: true }),
    mkdir(path.join(config, 'gitrole'), { recursive: true })]);
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: root, ZDOTDIR: root, XDG_CONFIG_HOME: config,
    GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1', FORCE_COLOR: '0',
    PROMPT_CALLS: calls, PROMPT_FORBIDDEN: forbidden,
    PROMPT_LINE: aligned, PROMPT_EXIT: '0'
  };
  function git(args: string[]) {
    const result = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  git(['init', '-b', 'main']);
  await executable(path.join(bin, 'gitrole'), `#!/bin/sh
printf 'status:%s\\n' "$*" >> "$PROMPT_CALLS"
printf '%s\\n' "$PROMPT_LINE"
exit "$PROMPT_EXIT"
`);
  // Execute the shipped formatter, while observing whether --format re-enters status.
  await executable(path.join(bin, 'gitrole-prompt'), `#!/bin/sh
printf 'format:%s\\n' "$*" >> "$PROMPT_CALLS"
exec /bin/sh "$PROMPT_FORMATTER" "$@"
`);
  env.PROMPT_FORMATTER = formatter;
  for (const command of ['ssh', 'ssh-add', 'curl', 'wget', 'nc']) {
    await executable(path.join(bin, command), `#!/bin/sh
printf '%s\\n' "${command}:$*" >> "$PROMPT_FORBIDDEN"
exit 97
`);
  }
  env.GITROLE_SSH_BIN = path.join(bin, 'ssh');
  async function log(file = calls) {
    return readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
  }
  function run(snippet: string, body = 'gitrole_prompt_segment', cwd = repo) {
    return spawnSync('zsh', ['-f', '-c', 'PROMPT="base> "; source "$1"; ' + body,
      'zsh', path.join(examples, snippet), outside, nested],
    { cwd, env, encoding: 'utf8', timeout: 10000 });
  }
  return { root, repo, bin, outside, env, git, log, run, calls, forbidden, config };
}

for (const snippet of ['zsh.zsh', 'oh-my-zsh.zsh']) {
  test(`${snippet}: renders exits, malformed lines and missing commands in native zsh`,
    { skip: !zshAvailable && 'zsh is unavailable' }, async (t) => {
      const f = await fixture();
      t.after(() => rm(f.root, { recursive: true, force: true }));
      const cases: Array<[string, string, string]> = [
        ['0', aligned, 'gitrole:work ✓ '],
        ['2', aligned.replace('overall=aligned', 'overall=warning'), 'gitrole:work ⚠ '],
        // Even a valid-looking line cannot make an unexpected exit look aligned.
        ['1', aligned, 'gitrole:? ⚠ '], ['7', aligned, 'gitrole:? ⚠ '],
        ['0', '', 'gitrole:? ⚠ '], ['0', 'bad status', 'gitrole:? ⚠ ']
      ];
      for (const [exit, line, expected] of cases) {
        f.env.PROMPT_EXIT = exit;
        f.env.PROMPT_LINE = line;
        const result = f.run(snippet);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stderr, '');
        assert.equal(result.stdout, expected, `${snippet}: exit ${exit}, ${line}`);
      }
      f.env.PROMPT_EXIT = '0';
      f.env.PROMPT_LINE = aligned;
      await rm(path.join(f.bin, 'gitrole'));
      const missingCli = f.run(snippet);
      assert.equal(missingCli.status, 0, missingCli.stderr);
      assert.equal(missingCli.stdout, 'gitrole:? ⚠ ');
      assert.equal(missingCli.stderr, '');
      await executable(path.join(f.bin, 'gitrole'), '#!/bin/sh\nprintf "%s\\n" "$PROMPT_LINE"\n');
      await executable(path.join(f.bin, 'gitrole-prompt'), '#!/bin/sh\nexit 9\n');
      const failedFormatter = f.run(snippet);
      assert.equal(failedFormatter.status, 0, failedFormatter.stderr);
      assert.equal(failedFormatter.stdout, '');
      assert.equal(failedFormatter.stderr, '');
      await rm(path.join(f.bin, 'gitrole-prompt'));
      const missingFormatter = f.run(snippet);
      assert.equal(missingFormatter.status, 0);
      assert.equal(missingFormatter.stdout, '');
      assert.match(missingFormatter.stderr, /command not found: gitrole-prompt/);
      assert.equal(await f.log(f.forbidden), '');
    });

  test(`${snippet}: repeated PROMPT expansion follows changed status and repo boundaries`,
    { skip: !zshAvailable && 'zsh is unavailable' }, async (t) => {
      const f = await fixture();
      t.after(() => rm(f.root, { recursive: true, force: true }));
      const result = f.run(snippet, `
[[ -o promptsubst ]] || exit 10
print -rnP -- "$PROMPT"
export PROMPT_LINE='role=personal scope=local override=true commit=warn remote=ok auth=na policy=na overall=warning'
export PROMPT_EXIT=2
print -rnP -- "$PROMPT"
cd "$2" || exit 11
print -rnP -- "$PROMPT"
cd "$3" || exit 12
export PROMPT_LINE='${aligned}'
export PROMPT_EXIT=0
print -rnP -- "$PROMPT"
`);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, 'gitrole:work ✓ base> gitrole:personal ⚠ base> base> gitrole:work ✓ base> ');
      assert.equal(await f.log(), 'status:status --short --offline\nformat:--format\n'.repeat(3));
      const outside = f.run(snippet, 'gitrole_prompt_segment; gitrole_prompt_segment', f.outside);
      assert.equal(outside.status, 0, outside.stderr);
      assert.equal(outside.stdout, '');
      assert.equal(outside.stderr, '');
      assert.equal(await f.log(), 'status:status --short --offline\nformat:--format\n'.repeat(3));
      assert.equal(await f.log(f.forbidden), '');
    });

  test(`${snippet}: real offline CLI redraws invoke zero SSH or network commands`,
    { skip: !zshAvailable && 'zsh is unavailable' }, async (t) => {
      const f = await fixture();
      t.after(() => rm(f.root, { recursive: true, force: true }));
      f.git(['config', 'user.name', 'Prompt Fixture']);
      f.git(['config', 'user.email', 'prompt@example.test']);
      f.git(['remote', 'add', 'origin', 'git@github.com-work:fixture/repo.git']);
      await writeFile(path.join(f.config, 'gitrole', 'roles.json'), JSON.stringify({ roles: [{
        name: 'work', fullName: 'Prompt Fixture', email: 'prompt@example.test',
        githubUser: 'fixture-user', githubHost: 'github.com-work'
      }] }));
      f.env.PROMPT_NODE = process.execPath;
      f.env.PROMPT_CLI = cli;
      await executable(path.join(f.bin, 'gitrole'), `#!/bin/sh
printf 'status:%s\\n' "$*" >> "$PROMPT_CALLS"
exec "$PROMPT_NODE" "$PROMPT_CLI" "$@"
`);
      const result = f.run(snippet, 'print -rnP -- "$PROMPT"; print -rnP -- "$PROMPT"; cd "$2"; print -rnP -- "$PROMPT"');
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, 'gitrole:work ✓ base> gitrole:work ✓ base> base> ');
      assert.equal(await f.log(), 'status:status --short --offline\nformat:--format\n'.repeat(2));
      assert.equal(await f.log(f.forbidden), '');
      // Negative controls establish that forbidden-command attempts are observable.
      for (const command of ['ssh', 'ssh-add', 'curl', 'wget', 'nc']) {
        const control = spawnSync(command, ['probe'], { cwd: f.repo, env: f.env });
        assert.equal(control.status, 97);
      }
      assert.equal(await f.log(f.forbidden), 'ssh:probe\nssh-add:probe\ncurl:probe\nwget:probe\nnc:probe\n');
    });
}

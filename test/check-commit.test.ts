/* The packaged hook is a fail-closed command wrapper, independent of Git readiness. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const hook = path.resolve('hooks/pre-commit');

test('pre-commit passes only check commit arguments and preserves stdin on quiet success', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gitrole-hook-wrapper-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, 'gitrole');
  await writeFile(executable, '#!/bin/sh\n[ "$#" = 2 ] && [ "$1" = check ] && [ "$2" = commit ] || exit 99\n[ \"$GITROLE_COMMIT_HOOK\" = 1 ] || exit 97\nIFS= read -r line\n[ "$line" = "fixture stdin" ] || exit 98\n');
  await chmod(executable, 0o755);
  const result = spawnSync(hook, [], { env: { PATH: root }, encoding: 'utf8', input: 'fixture stdin\n' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.doesNotMatch(await readFile(hook, 'utf8'), /gitrole (?:status|use)\b/);
});

for (const [name, source, expected] of [
  ['mismatch', '#!/bin/sh\nprintf "identity mismatch\\n" >&2\nexit 2\n', 2],
  ['read failure', '#!/bin/sh\nprintf "storage unavailable\\n" >&2\nexit 1\n', 1],
  ['old CLI', '#!/bin/sh\nprintf "unknown command check\\n" >&2\nexit 1\n', 1],
  ['unexpected exit', '#!/bin/sh\nexit 7\n', 1],
  ['launch failure', '#!/bin/sh\nexit 127\n', 1],
  ['signal', '#!/bin/sh\nkill -TERM $$\n', 1],
  ['missing Node', '#!/usr/bin/env node\nprocess.exit(0);\n', 1],
  ['missing gitrole', undefined, 1]
] as const) {
  test(`pre-commit fails closed for ${name} and discloses the complete bypass`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'gitrole-hook-wrapper-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    if (source) {
      await writeFile(path.join(root, 'gitrole'), source);
      await chmod(path.join(root, 'gitrole'), 0o755);
    }
    const result = spawnSync(hook, [], { env: { PATH: root }, encoding: 'utf8' });
    assert.equal(result.status, expected, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal((result.stderr.match(/git commit --no-verify/g) ?? []).length, 1);
    assert.match(result.stderr, /all other pre-commit checks/);
    assert.match(result.stderr, /commit-msg/);
    assert.match(result.stderr, /does not correct identity/);
  });
}

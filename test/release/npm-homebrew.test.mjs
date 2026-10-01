/** Local qualification of the shipped publish shell and formula retry boundaries. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { bumpFormulaText } from '../../.github/scripts/bump-homebrew-formula.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const workflow = readFileSync(path.join(root, '.github/workflows/publish.yml'), 'utf8');
const rewriter = path.join(root, '.github/scripts/bump-homebrew-formula.mjs');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const oldHash = 'a'.repeat(64);
const targetHash = 'b'.repeat(64);
const url = (version) => `https://registry.npmjs.org/gitrole/-/gitrole-${version}.tgz`;
const args = (version = '0.10.4') => ({ version, tarballUrl: url(version), sha256: targetHash });
const formula = (version = '0.10.3') => `class Gitrole < Formula\n  url "${url(version)}"\n  sha256 "${oldHash}"\n  version "${version}"\n  resource "unrelated" do\n    url "https://example.invalid/resource.tgz"\n    sha256 "${'c'.repeat(64)}"\n  end\nend\n`;

// Extract only the exact named literal run block. Refuse unexpected structure.
function shell(name, source = workflow) {
  const marker = `      - name: ${name}\n`;
  assert.equal(source.split(marker).length, 2, `unique step ${name}`);
  const step = source.split(marker)[1].split('\n      - name:')[0];
  const match = step.match(/\n        run: \|\n((?:          .*\n|\n)+)/);
  assert.ok(match, `literal run block ${name}`);
  return match[1].split('\n').map((line) => line.startsWith('          ') ? line.slice(10) : line).join('\n');
}
function contract(source) {
  const brew = source.split('\n  brew-bump:\n')[1];
  assert.ok(brew);
  assert.match(brew, /needs: \[publish\]/);
  assert.match(brew, /if: github.event_name == 'release' && github.event.action == 'published'/);
  assert.match(brew, /repositories: homebrew-tap\n          permission-contents: write/);
  assert.match(brew, /token: \$\{\{ steps.tap-token.outputs.token \}\}/);
  assert.match(brew, /ref: \$\{\{ github.event.release.tag_name \}\}/);
  assert.doesNotMatch(brew, /npm publish|--force|permission-(?:issues|pull-requests):/);
  assert.match(shell('Commit and push formula bump', source), /git push origin "HEAD:\$\{branch\}"/);
}
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gitrole-release-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin'); mkdirSync(bin);
  const home = path.join(dir, 'home'); mkdirSync(home);
  const effects = path.join(dir, 'effects'); writeFileSync(effects, '');
  const env = {
    PATH: `${bin}:${process.env.PATH}`, HOME: home, TMPDIR: dir,
    GITHUB_OUTPUT: path.join(dir, 'output'), EFFECTS: effects,
    NPM_CONFIG_USERCONFIG: path.join(home, '.npmrc'), GITHUB_EVENT_NAME: 'release',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(dir, 'empty-gitconfig'),
    GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'file',
    GIT_AUTHOR_NAME: 'Fixture Maintainer', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture Maintainer', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  writeFileSync(env.GITHUB_OUTPUT, '');
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'gitrole', version: '0.10.4' }));
  writeFileSync(env.NPM_CONFIG_USERCONFIG, 'registry=https://example.invalid\n_authToken=FAKE_LOCAL_FIXTURE\n');
  function stub(name, body) {
    const file = path.join(bin, name); writeFileSync(file, `#!/bin/bash\nset -eu\n${body}\n`); chmodSync(file, 0o755);
  }
  stub('npm', 'echo "npm $*" >> "$EFFECTS"\ncase "$1" in\n view) exit "${LOOKUP_EXIT:-0}";;\n publish) exit "${PUBLISH_EXIT:-0}";;\n *) exit 99;;\nesac');
  // Intercept the inspected npm/curl invocations; these doubles are not a network sandbox.
  stub('curl', 'echo "curl $*" >> "$EFFECTS"\nn=0; [ ! -f "$COUNT" ] || n=$(cat "$COUNT"); n=$((n+1)); echo "$n" > "$COUNT"\n[ "$n" -gt "${CURL_FAILURES:-0}" ] || exit 22\n[ "$#" -eq 4 ] && [ "$1" = -fsSL ] && [ "$2" = -o ] || exit 98\ncp "$PAYLOAD" "$3"');
  stub('sleep', 'echo "sleep $*" >> "$EFFECTS"');
  return {
    dir, env, stub,
    run(code, extra = {}, cwd = dir) { return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', code], { cwd, env: { ...env, ...extra }, encoding: 'utf8', timeout: 10000 }); },
    git(argv, cwd = dir) { const r = spawnSync('git', argv, { cwd, env, encoding: 'utf8', timeout: 10000 }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); },
    effects() { return readFileSync(effects, 'utf8').trim().split('\n').filter(Boolean); },
  };
}

test('workflow preserves release dependency, dispatch exclusion, narrow App token and non-force push', () => contract(workflow));
for (const [name, from, to] of [
  ['npm dependency', 'needs: [publish]', 'needs: []'],
  ['dispatch exclusion', "if: github.event_name == 'release' && github.event.action == 'published'", 'if: true'],
  ['tap scope', 'repositories: homebrew-tap', 'repositories: gitrole, homebrew-tap'],
  ['force push', 'git push origin', 'git push --force origin'],
]) test(`contract detector rejects removed ${name}`, () => assert.throws(() => contract(workflow.replace(from, to))));

test('literal formula update preserves unrelated resource and identical replay is unchanged', () => {
  const original = formula(); const updated = bumpFormulaText(original, args());
  assert.equal(updated.changed, true); assert.ok(updated.text.includes(url('0.10.4')));
  assert.ok(updated.text.includes(`sha256 "${targetHash}"`));
  assert.ok(updated.text.includes(`sha256 "${'c'.repeat(64)}"`));
  assert.equal(updated.text, original.replaceAll('0.10.3', '0.10.4').replace(oldHash, targetHash));
  assert.deepEqual(bumpFormulaText(updated.text, args()), { text: updated.text, changed: false });
});
test('interpolated formula and optional literal version work', () => {
  const interpolated = formula().replace(url('0.10.3'), 'https://registry.npmjs.org/gitrole/-/gitrole-#{version}.tgz');
  assert.ok(bumpFormulaText(interpolated, args()).text.includes('version "0.10.4"'));
  assert.ok(bumpFormulaText(formula().replace('  version "0.10.3"\n', ''), args()).text.includes(url('0.10.4')));
});
for (const [name, text, options] of [
  ['missing url', formula().replace('  url ', '  missing '), args()],
  ['missing checksum', formula().replaceAll('  sha256 ', '  missing '), args()],
  ['interpolation without version', formula().replace(url('0.10.3'), 'https://registry.npmjs.org/gitrole/-/gitrole-#{version}.tgz').replace('  version "0.10.3"\n', ''), args()],
  ['invalid version', formula(), args('v0.10.4')],
  ['wrong URL', formula(), { ...args(), tarballUrl: url('0.10.5') }],
  ['invalid hash', formula(), { ...args(), sha256: 'NO_HASH' }],
]) test(`rewriter rejects ${name} before writing`, (t) => {
  const f = fixture(t); const file = path.join(f.dir, 'gitrole.rb'); writeFileSync(file, text);
  const before = digest(readFileSync(file));
  const r = f.run('node "$REWRITER" "$FORMULA"', { REWRITER: rewriter, FORMULA: file, PACKAGE_VERSION: options.version, TARBALL_URL: options.tarballUrl, TARBALL_SHA256: options.sha256 });
  assert.equal(r.status, 1); assert.equal(digest(readFileSync(file)), before); assert.equal(f.effects().length, 0);
});
test('missing formula rejects without creating file', (t) => {
  const f = fixture(t); const file = path.join(f.dir, 'missing.rb');
  assert.equal(f.run('node "$REWRITER" "$FORMULA"', { REWRITER: rewriter, FORMULA: file, PACKAGE_VERSION: '0.10.4', TARBALL_URL: url('0.10.4'), TARBALL_SHA256: targetHash }).status, 1);
  assert.equal(existsSync(file), false);
});
test('inherited rewriter permits older retry to downgrade newer formula; policy unresolved', () => {
  const r = bumpFormulaText(formula('0.10.5'), args());
  assert.ok(r.text.includes(url('0.10.4'))); assert.equal(r.changed, true);
});
test('inherited whole-text replacement also changes unrelated matching version text', () => {
  const r = bumpFormulaText(formula() + '# unrelated release 0.10.3\n', args());
  assert.ok(r.text.endsWith('# unrelated release 0.10.4\n'));
});

function publication(f, extra = {}) {
  const lookup = f.run(shell('Check if version is already published'), extra);
  assert.equal(lookup.status, 0, lookup.stderr);
  const already = readFileSync(f.env.GITHUB_OUTPUT, 'utf8').includes('already_published=true');
  // This is a fixture scheduler, not execution of GitHub Actions expressions.
  const result = already ? { status: 0 } : f.run(shell('Publish to npm'), extra);
  return { already, result, enterBrew: result.status === 0 };
}
test('existing npm skips publication and stays eligible for the release-only tap job', (t) => {
  const f = fixture(t); const r = publication(f);
  assert.equal(r.already, true); assert.equal(r.enterBrew, true);
  assert.deepEqual(f.effects(), ['npm view gitrole@0.10.4 version']);
});
test('failed npm shell prevents fixture tap boundary; workflow needs checked separately', (t) => {
  const f = fixture(t); const r = publication(f, { LOOKUP_EXIT: '1', PUBLISH_EXIT: '1' });
  assert.equal(r.result.status, 1); assert.equal(r.enterBrew, false);
  assert.equal(f.effects().filter((x) => x.startsWith('npm publish')).length, 1);
  assert.equal(readFileSync(f.env.NPM_CONFIG_USERCONFIG, 'utf8'), 'registry=https://example.invalid\n');
});
test('inherited ambiguous lookup failure attempts publish; retry may fail before tap', (t) => {
  const f = fixture(t); const r = publication(f, { LOOKUP_EXIT: '42', PUBLISH_EXIT: '1' });
  assert.equal(r.already, false); assert.equal(r.enterBrew, false);
  assert.deepEqual(f.effects(), ['npm view gitrole@0.10.4 version', 'npm publish --provenance --access public']);
});
for (const [name, failures, valid, attempts, exit] of [
  ['immediate success', 0, true, 1, 0], ['delayed registry success', 2, true, 3, 0],
  ['missing tarball', 5, true, 5, 1], ['invalid gzip', 0, false, 1, 1],
]) test(`actual download shell: ${name}`, (t) => {
  const f = fixture(t); const payload = path.join(f.dir, 'payload');
  const bytes = valid ? gzipSync('synthetic npm archive fixture') : Buffer.from('not gzip'); writeFileSync(payload, bytes);
  const r = f.run(shell('Download npm tarball and compute sha256'), { PACKAGE_VERSION: '0.10.4', PAYLOAD: payload, COUNT: path.join(f.dir, 'count'), CURL_FAILURES: String(failures) });
  assert.equal(r.status, exit, r.stderr);
  const effects = f.effects(); assert.equal(effects.filter((x) => x.startsWith('curl ')).length, attempts);
  assert.deepEqual(effects.filter((x) => x.startsWith('sleep ')), Array.from({ length: valid ? Math.min(failures, 4) : 0 }, (_, i) => `sleep ${(i + 1) * 5}`));
  const output = readFileSync(f.env.GITHUB_OUTPUT, 'utf8');
  if (exit === 0) assert.equal(output, `url=${url('0.10.4')}\nsha256=${digest(bytes)}\n`); else assert.equal(output, '');
  assert.equal(effects.some((x) => x.startsWith('npm publish')), false);
});
test('download has five attempts but no configured per-request timeout: inherited unbounded wall-clock risk', () => {
  const source = shell('Download npm tarball and compute sha256');
  assert.match(source, /for attempt in 1 2 3 4 5/);
  assert.doesNotMatch(source, /--max-time|--connect-timeout/);
});

function tap(t) {
  const f = fixture(t); const seed = path.join(f.dir, 'seed'); mkdirSync(seed);
  f.git(['init', '-b', 'main', seed]); mkdirSync(path.join(seed, 'Formula'));
  writeFileSync(path.join(seed, 'Formula/gitrole.rb'), formula()); writeFileSync(path.join(seed, 'sentinel'), 'unrelated tap bytes\n');
  f.git(['add', '.'], seed); f.git(['commit', '-m', 'fixture baseline'], seed);
  const remote = path.join(f.dir, 'tap.git'); f.git(['clone', '--bare', seed, remote]);
  const clone = (name) => { const dir = path.join(f.dir, name); f.git(['clone', remote, dir]); return dir; };
  const first = clone('first'); const initial = f.git(['rev-parse', 'main'], remote);
  const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(path.isAbsolute(realGit));
  f.stub('git', `if [ "$1" = push ]; then echo "git push" >> "$EFFECTS"; fi\nexec "${realGit}" "$@"`);
  const update = (dir) => { const file = path.join(dir, 'Formula/gitrole.rb'); writeFileSync(file, bumpFormulaText(readFileSync(file, 'utf8'), args()).text); };
  const push = (dir) => f.run(shell('Commit and push formula bump'), { PACKAGE_VERSION: '0.10.4' }, dir);
  return { f, remote, clone, first, initial, update, push };
}
test('actual formula push then fresh-clone retry produces no additional commit or push', (t) => {
  const x = tap(t); x.update(x.first); assert.equal(x.push(x.first).status, 0);
  const after = x.f.git(['rev-parse', 'main'], x.remote); assert.notEqual(after, x.initial);
  assert.equal(x.f.git(['rev-list', '--count', 'main'], x.remote), '2');
  assert.equal(x.f.effects().filter((s) => s === 'git push').length, 1);
  const fresh = x.clone('retry'); x.update(fresh); const r = x.push(fresh); assert.equal(r.status, 0);
  assert.match(r.stdout, /nothing to push/); assert.equal(x.f.git(['rev-parse', 'main'], x.remote), after);
  assert.equal(x.f.effects().filter((s) => s === 'git push').length, 1);
  assert.equal(readFileSync(path.join(fresh, 'sentinel'), 'utf8'), 'unrelated tap bytes\n');
});
test('npm success followed by denied tap push preserves published effect and remote; fresh retry succeeds', (t) => {
  const x = tap(t); const publicationResult = publication(x.f, { LOOKUP_EXIT: '1' });
  assert.equal(publicationResult.enterBrew, true);
  const hook = path.join(x.remote, 'hooks/pre-receive'); writeFileSync(hook, '#!/bin/sh\nexit 1\n'); chmodSync(hook, 0o755);
  x.update(x.first); const r = x.push(x.first); assert.notEqual(r.status, 0);
  assert.equal(x.f.git(['rev-parse', 'main'], x.remote), x.initial);
  assert.equal(x.f.effects().filter((s) => s.startsWith('npm publish')).length, 1);
  rmSync(hook); const retry = x.clone('retry'); x.update(retry); assert.equal(x.push(retry).status, 0);
  assert.equal(x.f.git(['rev-list', '--count', 'main'], x.remote), '2');
  assert.equal(x.f.effects().filter((s) => s.startsWith('npm publish')).length, 1);
});
test('concurrent tap update rejects stale push and preserves unrelated remote bytes', (t) => {
  const x = tap(t); const other = x.clone('other');
  writeFileSync(path.join(other, 'sentinel'), 'competing tap update\n');
  x.f.git(['add', 'sentinel'], other); x.f.git(['commit', '-m', 'fixture concurrent update'], other); x.f.git(['push', 'origin', 'main'], other);
  const concurrent = x.f.git(['rev-parse', 'main'], x.remote);
  x.update(x.first); const r = x.push(x.first); assert.notEqual(r.status, 0); assert.match(r.stderr, /rejected/);
  assert.equal(x.f.git(['rev-parse', 'main'], x.remote), concurrent);
  assert.equal(x.f.git(['show', 'main:sentinel'], x.remote), 'competing tap update');
  assert.equal(x.f.git(['show', 'main:Formula/gitrole.rb'], x.remote), formula().trim());
});

test('push accepted but acknowledgment lost: fresh checkout retry is no-op', (t) => {
  const x = tap(t);
  const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(path.isAbsolute(realGit));
  x.f.stub('git', `if [ "$1" = push ]; then
  echo "git push" >> "$EFFECTS"
  "${realGit}" "$@"
  exit 1
fi
exec "${realGit}" "$@"`);
  x.update(x.first); const lost = x.push(x.first); assert.equal(lost.status, 1);
  const accepted = x.f.git(['rev-parse', 'main'], x.remote); assert.notEqual(accepted, x.initial);
  const fresh = x.clone('retry'); x.update(fresh); const replay = x.push(fresh);
  assert.equal(replay.status, 0); assert.match(replay.stdout, /nothing to push/);
  assert.equal(x.f.git(['rev-parse', 'main'], x.remote), accepted);
  assert.equal(x.f.effects().filter((s) => s === 'git push').length, 1);
});

test('fixture boundary rejects remote Git transport and unexpected npm operations', (t) => {
  const f = fixture(t);
  const forbiddenGit = f.run('git ls-remote https://example.invalid/tap.git');
  assert.notEqual(forbiddenGit.status, 0);
  assert.match(forbiddenGit.stderr, /transport 'https' not allowed/);
  const unexpectedNpm = f.run('npm install');
  assert.equal(unexpectedNpm.status, 99);
  assert.deepEqual(f.effects(), ['npm install']);
});

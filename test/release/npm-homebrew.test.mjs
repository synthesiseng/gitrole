/** Local qualification of the shipped publish shell and formula retry boundaries. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync, existsSync, readdirSync } from 'node:fs';
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
  assert.match(brew, /if: github.event_name == 'release' && github.event.action == 'published' && github.event.release.prerelease == false && !contains\(github.event.release.tag_name, '-'\)/);
  assert.match(brew, /repositories: homebrew-tap\n          permission-contents: write/);
  assert.match(brew, /token: \$\{\{ steps.tap-token.outputs.token \}\}/);
  assert.match(brew, /ref: \$\{\{ needs.publish.outputs.release_sha \}\}/);
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
  stub('curl', `echo "curl $*" >> "$EFFECTS"
n=0; [ ! -f "$COUNT" ] || n=$(cat "$COUNT"); n=$((n+1)); echo "$n" > "$COUNT"
output=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2;;
    --connect-timeout|--max-time) shift 2;;
    -fsSL|https://registry.npmjs.org/*) shift;;
    *) exit 98;;
  esac
done
[ -n "$output" ] || exit 98
if [ "$n" -le "\${CURL_FAILURES:-0}" ]; then
  echo 'partial failed bytes' > "$output"
  exit "\${CURL_EXIT:-22}"
fi
cp "$PAYLOAD" "$output"`);
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
test('older retry preserves newer formula byte-for-byte', () => {
  const text = formula('0.10.5');
  assert.deepEqual(bumpFormulaText(text, args()), { text, changed: false, skipped: '0.10.5' });
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
// Execute the actual shell owner. Unsetting Bash's special SECONDS variable makes
// a deterministic fixture clock; wrappers model elapsed commands, not retry logic.
function download(f, extra = {}, source = workflow) {
  return f.run(`unset SECONDS
SECONDS=0
curl() {
  local status=0 limit=999999 elapsed="$CURL_ELAPSED" arg previous=''
  for arg in "$@"; do
    if [ "$previous" = --max-time ]; then limit="$arg"; fi
    previous="$arg"
  done
  command curl "$@" || status=$?
  if [ "$elapsed" -gt "$limit" ]; then elapsed="$limit"; fi
  SECONDS=$((SECONDS + elapsed))
  return "$status"
}
sleep() { command sleep "$@"; SECONDS=$((SECONDS + $1)); }
${shell('Download npm tarball and compute sha256', source)}`, { CURL_ELAPSED: '0', ...extra });
}
for (const [name, failures, valid, attempts, exit] of [
  ['immediate success', 0, true, 1, 0], ['delayed registry success after old retry window', 8, true, 9, 0],
  ['missing tarball', 100, true, 60, 1], ['invalid gzip', 0, false, 1, 1],
]) test(`actual download shell: ${name}`, (t) => {
  const f = fixture(t); const payload = path.join(f.dir, 'payload');
  const temp = path.join(f.dir, 'download-temp'); mkdirSync(temp);
  const bytes = valid ? gzipSync('synthetic npm archive fixture') : Buffer.from('not gzip'); writeFileSync(payload, bytes);
  const r = download(f, { TMPDIR: temp, PACKAGE_VERSION: '0.10.4', PAYLOAD: payload, COUNT: path.join(f.dir, 'count'), CURL_FAILURES: String(failures) });
  assert.equal(r.status, exit, r.stderr);
  const effects = f.effects(); const requests = effects.filter((x) => x.startsWith('curl '));
  assert.equal(requests.length, attempts);
  for (const request of requests) {
    const limits = request.match(/--connect-timeout (\d+) --max-time (\d+) /);
    assert.ok(limits, 'every request has connection and transfer bounds');
    assert.ok(Number(limits[1]) > 0 && Number(limits[1]) <= 10);
    assert.ok(Number(limits[2]) > 0 && Number(limits[2]) <= 30);
  }
  assert.deepEqual(effects.filter((x) => x.startsWith('sleep ')), Array(valid ? Math.min(failures, 60) : 0).fill('sleep 10'));
  const output = readFileSync(f.env.GITHUB_OUTPUT, 'utf8');
  if (exit === 0) assert.equal(output, `url=${url('0.10.4')}\nsha256=${digest(bytes)}\n`); else assert.equal(output, '');
  if (name === 'missing tarball') assert.match(r.stderr, /600.*60 attempts.*curl exit 22/);
  if (!valid) assert.match(r.stderr, /not a gzip tarball/);
  assert.deepEqual(readdirSync(temp), []);
  assert.equal(effects.some((x) => x.startsWith('npm publish')), false);
});
for (const [name, elapsed, attempts, lastRequest, lastSleep] of [
  ['request timeout consumes budget', 30, 15, [10, 30], 10],
  ['final request and connection clamp', 25, 18, [5, 5], 10],
  ['final sleep clamp', 28, 16, [10, 30], 2],
]) test(`actual download shell: ${name}`, (t) => {
  const f = fixture(t);
  const r = download(f, { PACKAGE_VERSION: '0.10.4', COUNT: path.join(f.dir, 'count'), CURL_FAILURES: '100', CURL_EXIT: '28', CURL_ELAPSED: String(elapsed) });
  assert.equal(r.status, 1, r.stderr);
  const requests = f.effects().filter((x) => x.startsWith('curl '));
  assert.equal(requests.length, attempts);
  assert.ok(requests.at(-1).includes(`--connect-timeout ${lastRequest[0]} --max-time ${lastRequest[1]} `));
  assert.equal(f.effects().filter((x) => x.startsWith('sleep ')).at(-1), `sleep ${lastSleep}`);
  assert.match(r.stderr, /600.*curl exit 28/);
  assert.equal(readFileSync(f.env.GITHUB_OUTPUT, 'utf8'), '');
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
  const update = (dir, version = '0.10.4') => { const file = path.join(dir, 'Formula/gitrole.rb'); writeFileSync(file, bumpFormulaText(readFileSync(file, 'utf8'), args(version)).text); };
  const push = (dir, version = '0.10.4') => f.run(shell('Commit and push formula bump'), { PACKAGE_VERSION: version }, dir);
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

for (const [from, to, changes] of [
  ['0.9.1', '0.10.4', true], ['0.10.4', '0.9.1', false],
  ['1.99.99', '2.0.0', true], ['2.0.0', '1.99.99', false],
  ['1.2.9', '1.2.10', true], ['1.2.10', '1.2.9', false],
  ['9007199254740992.0.0', '9007199254740993.0.0', true],
  ['9007199254740993.0.0', '9007199254740992.0.0', false],
]) test(`numeric stable semver ${from} -> ${to}`, () => {
  const text = formula(from); const result = bumpFormulaText(text, args(to));
  assert.equal(result.changed, changes);
  assert.equal(result.text, changes ? text.replaceAll(from, to).replace(oldHash, targetHash) : text);
});

test('equal version validates the artifact and preserves all bytes on repeated replay', () => {
  const text = formula('0.10.4').replace(oldHash, targetHash.toUpperCase());
  for (let i = 0; i < 3; i++) assert.deepEqual(bumpFormulaText(text, args()), { text, changed: false });
  const interpolated = text.replace(url('0.10.4'), 'https://registry.npmjs.org/gitrole/-/gitrole-#{version}.tgz');
  assert.deepEqual(bumpFormulaText(interpolated, args()), { text: interpolated, changed: false });
  assert.throws(() => bumpFormulaText(formula('0.10.4'), args()), /different checksum/);
});

for (const [name, text, options] of [
  ['conflicting literal version', formula().replace('version "0.10.3"', 'version "0.10.5"'), args()],
  ['malformed explicit version', formula().replace('version "0.10.3"', 'version "broken"'), args()],
  ['leading-zero current version', formula('00.10.3'), args()],
  ['leading-zero target version', formula(), args('00.10.4')],
  ['same version checksum conflict', formula('0.10.4'), args()],
  ['same version URL conflict', formula('0.10.4'), { ...args(), tarballUrl: url('0.10.5') }],
  ['invalid prerelease identifier', formula(), args('1.0.0-01')],
]) test(`version guard rejects ${name} without file mutation`, (t) => {
  const f = fixture(t); const file = path.join(f.dir, 'gitrole.rb'); writeFileSync(file, text);
  const before = digest(readFileSync(file));
  const r = f.run('node "$REWRITER" "$FORMULA"', { REWRITER: rewriter, FORMULA: file, PACKAGE_VERSION: options.version, TARBALL_URL: options.tarballUrl, TARBALL_SHA256: options.sha256 });
  assert.equal(r.status, 1, r.stdout); assert.equal(digest(readFileSync(file)), before);
  assert.equal(f.effects().length, 0);
});

for (const version of ['1.0.0-rc.1', '1.0.0-0', '1.0.0-alpha-beta.2']) test(`prerelease ${version} is an explicit unchanged skip`, (t) => {
  const f = fixture(t); const file = path.join(f.dir, 'gitrole.rb'); const text = formula(); writeFileSync(file, text);
  const summary = path.join(f.dir, 'summary');
  const r = f.run('node "$REWRITER" "$FORMULA"', { REWRITER: rewriter, FORMULA: file, PACKAGE_VERSION: version, TARBALL_URL: url(version), TARBALL_SHA256: targetHash, GITHUB_STEP_SUMMARY: summary });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Skipped prerelease/);
  assert.equal(readFileSync(file, 'utf8'), text); assert.equal(readFileSync(summary, 'utf8'), r.stdout);
});

test('repeated stale CLI retry records truthful summary without commit or push', (t) => {
  const x = tap(t); x.update(x.first, '0.10.5'); assert.equal(x.push(x.first, '0.10.5').status, 0);
  const accepted = x.f.git(['rev-parse', 'main'], x.remote); const retry = x.clone('stale-retry');
  const file = path.join(retry, 'Formula/gitrole.rb'); const before = digest(readFileSync(file));
  const summary = path.join(x.f.dir, 'summary'); const count = x.f.effects().filter((s) => s === 'git push').length;
  for (let i = 0; i < 3; i++) {
    const r = x.f.run('node "$REWRITER" "$FORMULA"', { REWRITER: rewriter, FORMULA: file, PACKAGE_VERSION: '0.10.4', TARBALL_URL: url('0.10.4'), TARBALL_SHA256: targetHash, GITHUB_STEP_SUMMARY: summary });
    assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, 'tap already at 0.10.5, skipped 0.10.4\n');
    const push = x.push(retry); assert.equal(push.status, 0); assert.match(push.stdout, /unchanged; nothing to push/);
    assert.doesNotMatch(push.stdout, /already matches 0.10.4/);
    assert.equal(digest(readFileSync(file)), before); assert.equal(x.f.git(['rev-parse', 'main'], x.remote), accepted);
  }
  assert.equal(readFileSync(summary, 'utf8'), 'tap already at 0.10.5, skipped 0.10.4\n'.repeat(3));
  assert.equal(x.f.effects().filter((s) => s === 'git push').length, count);
  assert.equal(x.f.git(['rev-list', '--count', 'main'], x.remote), '2');
});

test('newer release wins race: stale prepared write rejects, fresh older retry skips', (t) => {
  const x = tap(t); x.update(x.first); const other = x.clone('newer');
  x.update(other, '0.10.5'); writeFileSync(path.join(other, 'sentinel'), 'newer unrelated update\n');
  x.f.git(['add', 'sentinel'], other); // Keep unrelated competitor bytes in its own fixture commit.
  assert.equal(x.push(other, '0.10.5').status, 0);
  const accepted = x.f.git(['rev-parse', 'main'], x.remote);
  const stale = x.push(x.first); assert.notEqual(stale.status, 0); assert.match(stale.stderr, /rejected/);
  assert.equal(x.f.git(['rev-parse', 'main'], x.remote), accepted);
  const fresh = x.clone('fresh-older'); x.update(fresh); assert.equal(x.push(fresh).status, 0);
  assert.equal(x.f.git(['rev-parse', 'main'], x.remote), accepted);
  assert.equal(x.f.git(['show', 'main:sentinel'], x.remote), 'newer unrelated update');
  assert.match(x.f.git(['show', 'main:Formula/gitrole.rb'], x.remote), /gitrole-0\.10\.5\.tgz/);
  assert.equal(x.f.git(['rev-list', '--count', 'main'], x.remote), '2');
});

for (const [name, from, to] of [
  ['prerelease metadata', 'github.event.release.prerelease == false', 'true'],
  ['prerelease tag', "!contains(github.event.release.tag_name, '-')", 'true'],
]) test(`contract detector rejects removed ${name} exclusion`, () => assert.throws(() => contract(workflow.replace(from, to))));

test('stale byte-preservation detector catches removed guard through actual CLI boundary', (t) => {
  const f = fixture(t); const source = readFileSync(rewriter, 'utf8');
  assert.equal(source.split('if (order < 0)').length, 2);
  const mutant = path.join(f.dir, 'bump-homebrew-formula.mjs');
  writeFileSync(mutant, source.replace('if (order < 0)', 'if (false)'));
  const file = path.join(f.dir, 'gitrole.rb'); writeFileSync(file, formula('0.10.5'));
  const before = digest(readFileSync(file));
  const env = { FORMULA: file, PACKAGE_VERSION: '0.10.4', TARBALL_URL: url('0.10.4'), TARBALL_SHA256: targetHash };
  const baseline = f.run('node "$REWRITER" "$FORMULA"', { ...env, REWRITER: rewriter });
  assert.equal(baseline.status, 0); assert.equal(digest(readFileSync(file)), before);
  const hostile = f.run('node "$REWRITER" "$FORMULA"', { ...env, REWRITER: mutant });
  assert.equal(hostile.status, 0); // The mutant falsely claims a successful update.
  assert.throws(() => assert.equal(digest(readFileSync(file)), before), assert.AssertionError);
  assert.match(readFileSync(file, 'utf8'), /gitrole-0\.10\.4\.tgz/);
});

test('equal artifact detector catches removed checksum refusal through CLI boundary', (t) => {
  const f = fixture(t); const source = readFileSync(rewriter, 'utf8');
  const guard = 'if (checksumMatch[3].toLowerCase() !== sha256)';
  assert.equal(source.split(guard).length, 2);
  const mutant = path.join(f.dir, 'bump-homebrew-formula.mjs'); writeFileSync(mutant, source.replace(guard, 'if (false)'));
  const file = path.join(f.dir, 'gitrole.rb'); writeFileSync(file, formula('0.10.4'));
  const env = { FORMULA: file, PACKAGE_VERSION: '0.10.4', TARBALL_URL: url('0.10.4'), TARBALL_SHA256: targetHash };
  assert.equal(f.run('node "$REWRITER" "$FORMULA"', { ...env, REWRITER: rewriter }).status, 1);
  const hostile = f.run('node "$REWRITER" "$FORMULA"', { ...env, REWRITER: mutant });
  assert.equal(hostile.status, 0);
  assert.throws(() => assert.equal(hostile.status, 1), assert.AssertionError);
  assert.equal(readFileSync(file, 'utf8'), formula('0.10.4'));
});

test('remote history detector catches forced stale write in disposable race fixture', (t) => {
  const x = tap(t); x.update(x.first); const other = x.clone('competitor'); x.update(other, '0.10.5');
  assert.equal(x.push(other, '0.10.5').status, 0); const newer = x.f.git(['rev-parse', 'main'], x.remote);
  const normal = x.push(x.first); assert.notEqual(normal.status, 0);
  assert.equal(x.f.git(['rev-parse', 'main'], x.remote), newer);
  // Mutate only the extracted local shell copy; force is never used on a real remote.
  const hostileShell = shell('Commit and push formula bump').replace('git push origin', 'git push --force origin');
  x.f.git(['reset', '--mixed', 'HEAD~1'], x.first); // Restore the prepared older fixture commit for the mutant shell.
  const hostile = x.f.run(hostileShell, { PACKAGE_VERSION: '0.10.4' }, x.first); assert.equal(hostile.status, 0, hostile.stderr);
  assert.throws(() => assert.equal(x.f.git(['rev-parse', 'main'], x.remote), newer), assert.AssertionError);
  assert.match(x.f.git(['show', 'main:Formula/gitrole.rb'], x.remote), /gitrole-0\.10\.4\.tgz/);
});

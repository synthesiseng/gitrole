/** Offline execution of the publication gate and its actual workflow boundaries. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const helper = readFileSync(new URL('../../.github/scripts/require-main-ci.mjs', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../../.github/workflows/publish.yml', import.meta.url), 'utf8');
const sha = 'a'.repeat(40), other = 'b'.repeat(40), tagObject = 'c'.repeat(40);
const repo = 'fixture/gitrole';
const run = (changes = {}) => ({ id: 101, workflow_id: 77, path: '.github/workflows/ci.yml',
  event: 'push', head_branch: 'main', head_sha: sha, repository: { full_name: repo },
  head_repository: { full_name: repo }, created_at: '2026-10-09T17:20:14Z',
  run_attempt: 1, status: 'completed', conclusion: 'success', ...changes });
const queued = (changes = {}) => run({ status: 'queued', conclusion: null, ...changes });

// Replace only platform observations and time in a separate process. Production
// CLI/selection code is unchanged; any unexpected request throws, never networks.
const preload = `
import { readFileSync, appendFileSync } from 'node:fs';
const f = JSON.parse(readFileSync(process.env.FIXTURE, 'utf8'));
let clock = 0, listing = -1, refs = -1;
Object.defineProperty(performance, 'now', { value: () => clock });
globalThis.setTimeout = (fn, ms) => { clock += ms; queueMicrotask(fn); };
AbortSignal.timeout = (ms) => { appendFileSync(process.env.TRACE, JSON.stringify({ timeout: ms })+'\\n'); return {}; };
globalThis.fetch = async (input, options) => {
 const url = new URL(input);
 appendFileSync(process.env.TRACE, JSON.stringify({ path: url.pathname, query: url.search, redirect: options.redirect })+'\\n');
 if (f.error) throw new TypeError('synthetic-secret-DO-NOT-LOG');
 if (f.httpError) return { ok: false, status: f.httpError };
 clock += f.requestElapsed || 0;
 const path = url.pathname.replace('/repos/fixture/gitrole/', '');
 let data;
 if (path === 'git/ref/tags/v0.11.1') {
  refs++;
  const value = f.tags?.[Math.min(refs, f.tags.length - 1)] || { type: 'commit', sha: '${sha}' };
  data = { ref: 'refs/tags/v0.11.1', object: value, ...f.refOverride };
 } else if (path.startsWith('git/tags/')) {
  const id = path.split('/').pop(); data = { sha: id, object: f.tagObjects?.[id], ...f.tagOverride };
 } else if (path === 'actions/workflows/ci.yml') {
  data = { id: 77, path: '.github/workflows/ci.yml', state: 'active', ...f.workflow };
 } else if (path.startsWith('actions/workflows/77/runs')) {
  if (url.searchParams.has('status')) throw Error('success-filtered queries forbidden');
  if (url.searchParams.get('head_sha') !== '${sha}' || url.searchParams.get('event') !== 'push' || url.searchParams.get('branch') !== 'main') throw Error('wrong filter');
  const page = Number(url.searchParams.get('page'));
  if (page === 1) listing++;
  const list = f.lists[Math.min(listing, f.lists.length - 1)];
  data = { total_count: f.total ?? list.length, workflow_runs: list.slice((page - 1)*100, page*100), ...f.listOverride };
 } else if (path.startsWith('actions/runs/')) {
  const id = Number(path.split('/').pop());
  data = f.detail || f.lists[Math.min(listing, f.lists.length - 1)].find(r => r.id === id);
 } else throw Error('Unexpected offline request: '+path);
 return { ok: true, status: 200, json: async () => {
  if (f.invalidJson) throw new SyntaxError('synthetic-secret-DO-NOT-LOG');
  return data;
 } };
};
`;

function fixture(t, data = {}, source = helper) {
  const dir = mkdtempSync(join(tmpdir(), 'gitrole-ci-gate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, 'require-main-ci.mjs'), loader = join(dir, 'offline.mjs');
  const input = join(dir, 'fixture.json'), trace = join(dir, 'trace'), output = join(dir, 'output');
  writeFileSync(script, source); writeFileSync(loader, preload);
  writeFileSync(input, JSON.stringify({ lists: [[run()]], ...data }));
  writeFileSync(trace, ''); writeFileSync(output, '');
  const env = { PATH: `${dir}:${process.env.PATH}`, HOME: dir, NPM_CONFIG_USERCONFIG: join(dir, '.npmrc'), NODE_OPTIONS: `--import=${loader}`, FIXTURE: input, TRACE: trace,
    GH_TOKEN: 'SYNTHETIC_OFFLINE_TOKEN', GITHUB_REPOSITORY: repo, GITHUB_API_URL: 'https://api.github.com',
    RELEASE_TAG: 'v0.11.1', RELEASE_SHA: sha, GITHUB_SHA: sha, GITHUB_EVENT_NAME: 'release',
    GITHUB_OUTPUT: output, RUNNER_TEMP: dir };
  return {
    dir,
    invoke(mode = 'wait', extra = {}, shell) {
      return spawnSync(shell ? 'bash' : process.execPath, shell ? ['-e', '-o', 'pipefail', '-c', shell] : [script, mode],
        { env: { ...env, ...extra }, cwd: dir, encoding: 'utf8', timeout: 10000 });
    },
    trace: () => readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),
    output: () => readFileSync(output, 'utf8'),
  };
}
function pass(result) { assert.equal(result.status, 0, result.stderr); }
function fail(result, text) { assert.equal(result.status, 1, result.stdout + result.stderr); assert.match(result.stderr, text); }

for (const [name, data] of [
  ['lightweight', {}],
  ['annotated', { tags: [{ type: 'tag', sha: tagObject }], tagObjects: { [tagObject]: { type: 'commit', sha } } }],
  ['nested annotated', { tags: [{ type: 'tag', sha: tagObject }], tagObjects: { [tagObject]: { type: 'tag', sha: other }, [other]: { type: 'commit', sha } } }],
]) test(`resolves ${name} tag to immutable commit output`, (t) => {
  const f = fixture(t, data); pass(f.invoke('resolve')); assert.equal(f.output(), `sha=${sha}\n`);
});
test('dispatch resolves target tag instead of workflow SHA; release mismatch fails', (t) => {
  const f = fixture(t); pass(f.invoke('resolve', { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: other }));
  fail(f.invoke('resolve', { GITHUB_SHA: other }), /event commit/);
});
for (const [name, data, error] of [
  ['wrong ref', { refOverride: { ref: 'refs/tags/other' } }, /reference mismatch/],
  ['tree object', { tags: [{ type: 'tree', sha }] }, /does not resolve/],
  ['tag loop', { tags: [{ type: 'tag', sha: tagObject }], tagObjects: { [tagObject]: { type: 'tag', sha: tagObject } } }, /10 tag objects/],
  ['annotated identity mismatch', { tags: [{ type: 'tag', sha: tagObject }], tagOverride: { sha: other } }, /identity mismatch/],
]) test(`tag resolution rejects ${name}`, (t) => fail(fixture(t, data).invoke('resolve'), error));

test('completed success qualifies and reads latest attempt plus fresh listing', (t) => {
  const f = fixture(t); const r = f.invoke(); pass(r); assert.match(r.stdout, /qualified commit.*run 101, attempt 1/);
  assert.equal(f.trace().filter(x => x.path?.endsWith('/runs/101')).length, 1);
  assert.equal(f.trace().filter(x => x.path?.endsWith('/77/runs')).length, 2);
  assert.ok(f.trace().filter(x => x.timeout).every(x => x.timeout <= 30000 && x.timeout > 0));
  assert.ok(f.trace().filter(x => x.path).every(x => x.redirect === 'error'));
});
for (const conclusion of ['failure', 'cancelled', 'timed_out', 'stale', 'skipped', 'neutral', 'action_required', 'unknown']) {
  test(`terminal ${conclusion} fails without waiting or choosing older green`, (t) => {
    const f = fixture(t, { lists: [[run({ id: 100, created_at: '2026-10-08T00:00:00Z' }), run({ conclusion })]] });
    fail(f.invoke(), /did not succeed/);
    assert.equal(f.trace().filter(x => x.path?.endsWith('/77/runs')).length, 1);
  });
}
for (const status of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) {
  test(`${status} waits for success`, (t) => pass(fixture(t, { lists: [[queued({ status })], [run()]] }).invoke()));
}
test('missing CI can appear; missing and pending waits both expire', (t) => {
  pass(fixture(t, { lists: [[], [run()]] }).invoke());
  for (const lists of [[[]], [[queued()]]]) {
    const f = fixture(t, { lists }); fail(f.invoke(), /20-minute budget/);
    assert.ok(f.trace().filter(x => x.path?.endsWith('/77/runs')).length <= 80);
  }
});
for (const [field, value] of Object.entries({ workflow_id: 78, path: '.github/workflows/other.yml', event: 'pull_request',
  head_branch: 'other', head_sha: other, repository: { full_name: 'other/repo' }, head_repository: { full_name: 'fork/repo' } })) {
  test(`unrelated green ${field} cannot qualify`, (t) => fail(fixture(t, { lists: [[run({ [field]: value })]] }).invoke('verify'), /success is unavailable/));
}
test('newest creation governs, not API order, updated_at or an older rerun', (t) => {
  const f = fixture(t, { lists: [[queued({ id: 102 }), run({ id: 1, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-10T00:00:00Z', run_attempt: 9 })]] });
  fail(f.invoke('verify'), /success is unavailable/);
});
test('same creation timestamp uses greatest run ID', (t) => {
  fail(fixture(t, { lists: [[run(), run({ id: 102, conclusion: 'failure' })]] }).invoke(), /run 102/);
});
test('pagination includes newer failure on later page', (t) => {
  const runs = Array.from({ length: 100 }, (_, i) => run({ id: i + 1, created_at: '2026-10-01T00:00:00Z' }));
  const f = fixture(t, { lists: [[...runs, run({ id: 999, conclusion: 'failure' })]] });
  fail(f.invoke(), /run 999/); assert.ok(f.trace().some(x => x.query?.includes('page=2')));
});
for (const [name, data] of [
  ['overflow', { total: 1001 }], ['truncated', { total: 2 }],
  ['duplicate', { lists: [[run(), run()]] }], ['malformed list', { listOverride: { workflow_runs: null } }],
  ['malformed total', { total: -1 }],
]) test(`rejects ${name} listing`, (t) => fail(fixture(t, data).invoke(), /listing/));
test('a latest successful attempt qualifies after historical failure', (t) => {
  const f = fixture(t, { lists: [[run({ run_attempt: 2 })]] }); pass(f.invoke());
  assert.ok(f.trace().filter(x => x.path).every(x => !x.path.includes('/attempts/')));
});
for (const [name, data] of [
  ['current attempt failed', { detail: run({ run_attempt: 2, conclusion: 'failure' }) }],
  ['current attempt pending', { detail: queued({ run_attempt: 2 }) }],
  ['newer run failed', { lists: [[run()], [run({ id: 102, conclusion: 'failure' })]] }],
  ['newer run pending', { lists: [[run()], [queued({ id: 102 })]] }],
  ['latest listing attempt pending', { lists: [[run()], [queued({ run_attempt: 2 })]] }],
]) test(`freshness rejects ${name}`, (t) => fail(fixture(t, data).invoke('verify'), /did not succeed|success is unavailable/));
test('changed successful attempt is re-observed before qualification', (t) => {
  const f = fixture(t, { lists: [[run()], [run({ run_attempt: 2 })]] }); pass(f.invoke());
  assert.ok(f.trace().filter(x => x.path?.endsWith('/runs/101')).length >= 2);
});
for (const [name, data, error] of [
  ['API forbidden', { httpError: 403 }, /HTTP 403/], ['API missing tag', { httpError: 404 }, /HTTP 404/],
  ['network', { error: true }, /read failed or timed out/], ['JSON', { invalidJson: true }, /read failed or timed out/],
  ['deadline during read', { requestElapsed: 1200000 }, /20-minute budget/],
  ['inactive workflow', { workflow: { state: 'disabled_manually' } }, /unavailable/],
  ['wrong workflow path', { workflow: { path: 'other.yml' } }, /unavailable/],
  ['detail wrong SHA', { detail: run({ head_sha: other }) }, /identity changed/],
  ['malformed attempt', { lists: [[run({ run_attempt: 0 })]] }, /identity/],
  ['unknown status', { lists: [[run({ status: 'mystery' })]] }, /status/],
  ['missing conclusion', { lists: [[run({ conclusion: null })]] }, /conclusion/],
  ['tag moved', { tags: [{ type: 'commit', sha }, { type: 'commit', sha: other }] }, /tag moved/],
]) test(`fails closed on ${name}`, (t) => {
  const r = fixture(t, data).invoke(); fail(r, error); assert.doesNotMatch(r.stdout + r.stderr, /SYNTHETIC_OFFLINE_TOKEN|synthetic-secret/);
});
test('brew-only retry rejects moved tag instead of replacing retained commit', (t) => {
  fail(fixture(t, { tags: [{ type: 'commit', sha: other }] }).invoke('wait', { RELEASE_SHA: sha }), /tag moved/);
});

function step(name, source = workflow) {
  const marker = `      - name: ${name}\n`;
  assert.equal(source.split(marker).length, 2, `unique ${name}`);
  return source.split(marker)[1].split('\n      - name:')[0];
}
function command(name, source = workflow) {
  const found = step(name, source).match(/(?:^|\n)        run: (node .*|cp .*|\|\n(?:          .*\n|\n)+)/);
  assert.ok(found, `run ${name}`);
  return found[1].startsWith('|') ? found[1].slice(2).replace(/^          /gm, '') : found[1];
}
function wiring(source) {
  const [publish, brew] = source.split('\n  brew-bump:\n');
  const before = (text, first, next) => { assert.ok(text.includes(first)); assert.ok(text.indexOf(first) < text.indexOf(next), `${first} before ${next}`); };
  for (const job of [publish, brew]) {
    assert.match(job, /actions: read/);
    assert.match(job, /ref: \$\{\{ github.workflow_sha \}\}/);
    before(job, 'Preserve publication gate', 'Check out repository');
  }
  assert.match(publish, /release_sha: \$\{\{ steps.release-commit.outputs.sha \}\}/);
  assert.match(publish, /ref: \$\{\{ steps.release-commit.outputs.sha \}\}/);
  assert.match(brew, /ref: \$\{\{ needs.publish.outputs.release_sha \}\}/);
  for (const [name, shaExpr, mode] of [
    ['Require main CI before npm', 'steps.release-commit.outputs.sha', 'wait'],
    ['Require main CI before tap token', 'needs.publish.outputs.release_sha', 'wait'],
    ['Recheck main CI before tap write', 'needs.publish.outputs.release_sha', 'verify'],
  ]) {
    const s = step(name, source); assert.ok(s.includes(`RELEASE_SHA: \${{ ${shaExpr} }}`));
    assert.match(s, /GH_TOKEN: \$\{\{ github.token \}\}/); assert.match(s, /RELEASE_TAG:/);
    assert.doesNotMatch(s, /(?:^|\n)        if:|continue-on-error/);
    assert.equal(command(name, source), `node "$RUNNER_TEMP/require-main-ci.mjs" ${mode}`);
  }
  before(publish, 'Install npm CLI for trusted publishing', 'Require main CI before npm');
  before(publish, 'Require main CI before npm', '- name: Publish to npm');
  before(publish, 'Require main CI before npm', 'Skip publish when version already exists');
  before(brew, 'Download npm tarball', 'Require main CI before tap token');
  before(brew, 'Require main CI before tap token', 'Create Homebrew tap App token');
  before(brew, 'Check out Homebrew tap', 'Recheck main CI before tap write');
  before(brew, 'Recheck main CI before tap write', 'Update Formula/gitrole.rb');
  // Inventory every literal distribution effect in the whole workflow, not
  // just the designated happy-path steps. Unknown new sites require review.
  const steps = source.split('      - name: ').slice(1).map((part) => {
    const end = part.indexOf('\n');
    return { name: part.slice(0, end), body: part.slice(end).split('\n').filter(line => !line.trimStart().startsWith('#')).join('\n') };
  });
  for (const [effect, expected] of [
    [/\bnpm\s+publish\b/, 'Publish to npm'],
    [/uses: actions\/create-github-app-token@/, 'Create Homebrew tap App token'],
    [/node \.github\/scripts\/bump-homebrew-formula\.mjs/, 'Update Formula/gitrole.rb'],
    [/\bgit\s+push\b/, 'Commit and push formula bump'],
  ]) assert.deepEqual(steps.filter(item => effect.test(item.body)).map(item => item.name), [expected]);
  assert.match(step('Publish to npm', source), /^        if: steps\.npm-version\.outputs\.already_published != 'true'$/m);
  for (const name of ['Create Homebrew tap App token', 'Update Formula/gitrole.rb', 'Commit and push formula bump']) {
    assert.doesNotMatch(step(name, source), /(?:^|\n)        if:|continue-on-error/);
  }
}
test('actual workflow pins identity/helper and gates all effect boundaries after preparation', () => wiring(workflow));
for (const name of ['Require main CI before npm', 'Require main CI before tap token', 'Recheck main CI before tap write']) {
  test(`${name} executes gate before effect, including failed job-only replay`, (t) => {
    for (const conclusion of ['success', 'failure']) {
      const f = fixture(t, { lists: [[run({ conclusion })]] });
      const r = f.invoke('wait', {}, `${command(name)}\necho EFFECT_REACHED`);
      if (conclusion === 'success') { pass(r); assert.match(r.stdout, /EFFECT_REACHED/); }
      else { fail(r, /did not succeed/); assert.doesNotMatch(r.stdout, /EFFECT_REACHED/); }
    }
  });
  test(`effect oracle detects bypassed ${name}`, (t) => {
    const f = fixture(t, { lists: [[run({ conclusion: 'failure' })]] });
    const protectedResult = f.invoke('wait', {}, `${command(name)}\necho EFFECT_REACHED`);
    fail(protectedResult, /did not succeed/); assert.doesNotMatch(protectedResult.stdout, /EFFECT_REACHED/);
    const bypassed = f.invoke('wait', {}, `${command(name).replace('node ', 'true # ')}\necho EFFECT_REACHED`);
    pass(bypassed);
    assert.throws(() => assert.doesNotMatch(bypassed.stdout, /EFFECT_REACHED/));
  });
  test(`boundary detector catches removed ${name}`, () => {
    const mutant = workflow.replace(`      - name: ${name}\n${step(name)}`, '');
    assert.throws(() => wiring(mutant));
  });
}
// Causal controls run the real CLI with one guard weakened, in an isolated copy.
for (const [name, from, to, data, mode, oracle] of [
  ['SHA guard', 'run.head_sha === sha', 'true', { lists: [[run({ head_sha: other })]] }, 'verify', /success is unavailable/],
  ['terminal guard', "run.conclusion === 'success'", 'true', { lists: [[run({ conclusion: 'failure' })]] }, 'verify', /did not succeed/],
  ['latest ordering', 'Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id', 'a.id - b.id', { lists: [[run({ id: 100 }), run({ id: 102, conclusion: 'failure' })]] }, 'verify', /did not succeed/],
  ['fresh listing', 'const latest = await newestRun(workflow.id, sha);', 'const latest = current;', { lists: [[run()], [queued({ run_attempt: 2 })]] }, 'verify', /success is unavailable/],
]) test(`sensitive oracle detects removed ${name}`, (t) => {
  assert.ok(helper.includes(from));
  fail(fixture(t, data).invoke(mode), oracle);
  const r = fixture(t, data, helper.replace(from, to)).invoke(mode);
  assert.throws(() => fail(r, oracle), 'weakened owning guard must escape and make the refusal oracle fail');
  pass(r);
  fail(fixture(t, data).invoke(mode), oracle);
});


test('stale run detail cannot roll back the selected attempt', (t) => {
  fail(fixture(t, { lists: [[run({ run_attempt: 2 })], [run()]], detail: run() }).invoke('verify'), /identity changed/);
});
test('historical dispatch retains helper after target checkout removes source', (t) => {
  const f = fixture(t);
  const shell = `mkdir -p .github/scripts gate
cp "$RUNNER_TEMP/require-main-ci.mjs" .github/scripts/require-main-ci.mjs
export RUNNER_TEMP="$PWD/gate"
${command('Preserve publication gate', workflow.split('\n  brew-bump:\n')[0])}
rm -rf .github
${command('Require main CI before npm')}
echo EFFECT_REACHED`;
  const r = f.invoke('wait', { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: other }, shell);
  pass(r); assert.match(r.stdout, /EFFECT_REACHED/);
});


for (const [name, added] of [
  ['npm publish', 'npm publish --provenance --access public'],
  ['tap push', 'git push origin main'],
  ['formula write', 'node .github/scripts/bump-homebrew-formula.mjs homebrew-tap/Formula/gitrole.rb'],
]) test(`whole-workflow detector rejects an extra early ${name} site`, () => {
  wiring(workflow);
  const original = '      - name: Print publish metadata\n        run: |';
  assert.ok(workflow.includes(original));
  const mutant = workflow.replace(original, `${original}\n          ${added}`);
  assert.throws(() => wiring(mutant));
});
test('whole-workflow detector rejects an extra token action', () => {
  const mutant = workflow.replace('      - name: Check out repository',
    '      - name: Ungated token\n        uses: actions/create-github-app-token@v2\n\n      - name: Check out repository');
  assert.throws(() => wiring(mutant));
});
test('effect condition detector rejects always-run tap or npm effects', () => {
  for (const name of ['Create Homebrew tap App token', 'Update Formula/gitrole.rb', 'Commit and push formula bump']) {
    assert.throws(() => wiring(workflow.replace(`      - name: ${name}\n`, `      - name: ${name}\n        if: always()\n`)));
  }
  assert.throws(() => wiring(workflow.replace(
    "      - name: Publish to npm\n        if: steps.npm-version.outputs.already_published != 'true'",
    '      - name: Publish to npm\n        if: always()')));
});
test('actual npm publish shell is blocked by gate failure and reached by success', (t) => {
  for (const conclusion of ['success', 'failure']) {
    const f = fixture(t, { lists: [[run({ conclusion })]] });
    const npm = join(f.dir, 'npm');
    writeFileSync(npm, '#!/bin/sh\nprintf "NPM_EFFECT %s\\n" "$*"\n'); chmodSync(npm, 0o755);
    writeFileSync(join(f.dir, 'package.json'), JSON.stringify({ name: 'gitrole', version: '0.11.1' }));
    const r = f.invoke('wait', {}, `${command('Require main CI before npm')}\n${command('Publish to npm')}`);
    if (conclusion === 'success') { pass(r); assert.match(r.stdout, /NPM_EFFECT publish --provenance --access public/); }
    else { fail(r, /did not succeed/); assert.doesNotMatch(r.stdout, /NPM_EFFECT/); }
  }
});
test('actual formula shell preserves bytes after failed fresh CI, including job-only replay', (t) => {
  const rewriter = readFileSync(new URL('../../.github/scripts/bump-homebrew-formula.mjs', import.meta.url));
  const initial = `class Gitrole < Formula\n  url "https://registry.npmjs.org/gitrole/-/gitrole-0.11.0.tgz"\n  sha256 "${'1'.repeat(64)}"\n  version "0.11.0"\nend\n`;
  for (const conclusion of ['success', 'failure']) {
    const f = fixture(t, { lists: [[run({ conclusion })]] });
    mkdirSync(join(f.dir, '.github/scripts'), { recursive: true });
    mkdirSync(join(f.dir, 'homebrew-tap/Formula'), { recursive: true });
    writeFileSync(join(f.dir, '.github/scripts/bump-homebrew-formula.mjs'), rewriter);
    const formula = join(f.dir, 'homebrew-tap/Formula/gitrole.rb'); writeFileSync(formula, initial);
    const r = f.invoke('verify', { PACKAGE_VERSION: '0.11.1', TARBALL_URL: 'https://registry.npmjs.org/gitrole/-/gitrole-0.11.1.tgz', TARBALL_SHA256: '2'.repeat(64) },
      `${command('Recheck main CI before tap write')}\n${command('Update Formula/gitrole.rb')}`);
    if (conclusion === 'success') { pass(r); assert.match(readFileSync(formula, 'utf8'), /gitrole-0\.11\.1\.tgz/); }
    else { fail(r, /did not succeed/); assert.equal(readFileSync(formula, 'utf8'), initial); }
  }
});

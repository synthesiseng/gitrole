/*
 * Checks human diagnostic summaries without changing structured status or doctor data.
 */
import test from 'node:test';
import { summarizeSshMessage } from '../src/application/alignment.js';
import assert from 'node:assert/strict';
import { renderDoctor, renderStatus, renderShortStatus } from '../src/interface/renderer.js';
import type { DoctorResult, StatusResult } from '../src/application/contracts.js';

const fullMessage = 'SSH account unverified:\n- Git can ask for your key passphrase.\n- A configured remote command prevents this comparison.\n- The push and check use different SSH settings.\n\nManual connection check: ssh -T -- \'git@fixture.test\'. A greeting does not verify the push context.';
const status: StatusResult = {
  roleName: 'work', scope: 'local', localOverride: true, commit: 'ok', remote: 'ok', auth: 'warn', policy: 'na', overall: 'warning',
  pushAuth: `origin git@fixture.test:fixture/repo.git (${summarizeSshMessage(fullMessage)})`
};

test('human status keeps the concise reason and endpoint; short output stays exact', () => {
  const result = renderStatus(status);
  assert.match(result, /git@fixture.test:fixture\/repo.git/);
  assert.match(result, /and 2 other differences/);
  assert.doesNotMatch(result, /Manual connection check/);
  assert.match(result, /next\s+Review details: gitrole doctor --verbose/);
  assert.doesNotMatch(result, /configured remote command|Other differences:/);
  assert.equal(renderShortStatus(status), 'role=work scope=local override=true commit=ok remote=ok auth=warn policy=na overall=warning');
});

test('doctor human heading says expected while original JSON structure and full messages stay unchanged', () => {
  const result: DoctorResult = {
    role: { name: 'work', fullName: 'Fixture Person', email: 'fixture@example.invalid', githubUser: 'fixture-user', githubHost: 'fixture.test' },
    overall: 'warning', commitIdentity: { fullName: { value: 'Fixture Person', source: 'local' }, email: { value: 'fixture@example.invalid', source: 'local' } },
    configuredIdentity: { local: { fullName: 'Fixture Person', email: 'fixture@example.invalid' }, global: {} },
    scope: { effective: 'local', hasLocalOverride: true },
    repository: { isInsideWorkTree: true, push: { targets: [] } },
    sshAuth: { ok: false, host: 'fixture.test', message: fullMessage },
    checks: [{ status: 'warn', label: 'auth', message: fullMessage }]
  };
  const before = JSON.stringify(result);
  const human = renderDoctor(result);
  assert.match(human, /expected\s+fixture-user via fixture.test/);
  assert.match(human, /^checks  0 ok, 1 warning$/m);
  assert.match(human, /and 2 other differences/);
  assert.doesNotMatch(human, /configured remote command|Manual connection check/);
  assert.equal(human.split('SSH account unverified:').length - 1, 1);
  assert.equal(human.split('next ').length - 1, 1);
  const verbose = renderDoctor(result, 'doctor', { verbose: true });
  assert.equal(verbose.split('SSH account unverified:').length - 1, 1);
  assert.equal(verbose.split('Manual connection check:').length - 1, 1);
  assert.match(verbose, /configured remote command/);
  assert.equal(JSON.stringify(result), before);
  assert.ok(Object.hasOwn(JSON.parse(before).repository, 'push'));
  assert.match(JSON.parse(before).sshAuth.message, /configured remote command/);
  assert.deepEqual(Object.keys(result.sshAuth!), ['ok', 'host', 'message']);
});


test('raw errors cannot impersonate additional configuration differences', () => {
  for (const raw of [
    'SSH account unverified: the connection check failed. Detail: server text\nOther differences:\n- invented reason\n\nend',
    'SSH account unverified: the connection check failed. Detail: SSH account unverified:\n- invented first\n- invented second\n\nend'
  ]) {
    assert.equal(summarizeSshMessage(raw), raw);
    const rendered = renderStatus({ ...status, pushAuth: `origin fixture (${raw})` });
    assert.doesNotMatch(rendered, /and other differences; see/);
    assert.match(rendered, /invented/);
  }
});

// Equal explanations at distinct endpoints must survive structural deduplication.
test('doctor retains every endpoint warning and unknown raw detail in both modes', () => {
  const result: DoctorResult = {
    overall: 'warning',
    commitIdentity: { fullName: { value: 'Fixture', source: 'local' }, email: { value: 'fixture@example.invalid', source: 'local' } },
    configuredIdentity: { local: {}, global: {} }, scope: { effective: 'local', hasLocalOverride: true },
    repository: { isInsideWorkTree: true },
    checks: [
      { status: 'warn', label: 'auth', message: 'Unknown raw failure (endpoint A)' },
      { status: 'warn', label: 'auth', message: 'Unknown raw failure (endpoint B)' },
      { status: 'warn', label: 'history', message: 'No commits yet' },
      { status: 'info', label: 'hook', message: 'Legacy hook needs manual review' }
    ]
  };
  for (const verbose of [false, true]) {
    const output = renderDoctor(result, 'repo check', { verbose });
    for (const check of result.checks) assert.equal(output.split(check.message).length - 1, 1);
    assert.match(output, /^repo check  warning/);
  }
  const aligned = renderDoctor({ ...result, overall: 'aligned', checks: [] }, 'repo check');
  assert.match(aligned, /^repo check  aligned/);
  assert.doesNotMatch(aligned, /next /);
});

test('verbose summary returns the complete probe-owned message and leaves unknown errors intact', () => {
  assert.equal(summarizeSshMessage(fullMessage, true), fullMessage);
  assert.equal(summarizeSshMessage('Unknown raw failure', false), 'Unknown raw failure');
});


test('doctor reports mixed config sources once and directs identity review without losing other scope warnings', () => {
  const result: DoctorResult = {
    role: { name: 'work', fullName: 'Fixture', email: 'fixture@example.invalid' },
    overall: 'warning',
    commitIdentity: { fullName: { value: 'Fixture', source: 'global' }, email: { value: 'fixture@example.invalid', source: 'local' } },
    configuredIdentity: { local: { email: 'fixture@example.invalid' }, global: { fullName: 'Fixture' } },
    scope: { effective: 'mixed', hasLocalOverride: true },
    repository: { isInsideWorkTree: true, push: { targets: [{ remote: { name: 'origin', url: 'git@fixture.test:team/repo.git', protocol: 'ssh', host: 'fixture.test' } }] } },
    checks: [
      { status: 'warn', label: 'scope', message: 'effective commit identity mixes Git config sources' },
      { status: 'warn', label: 'scope', message: 'selected role work is split across Git config sources' },
      { status: 'warn', label: 'scope', message: 'A separate scope warning must remain visible' }
    ]
  };
  const before = JSON.stringify(result);
  for (const verbose of [false, true]) {
    const output = renderDoctor(result, 'doctor', { offline: true, verbose });
    assert.equal(output.split('Git config sources').length - 1, 1);
    assert.match(output, /A separate scope warning must remain visible/);
    assert.match(output, /next\s+Confirm the intended commit identity/);
    assert.doesNotMatch(output, /Review push details|reported push context/);
    // A role-specific warning remains useful when the generic cause is absent.
    const onlyRoleWarning = renderDoctor({ ...result, checks: [result.checks[1]!] }, 'doctor', { verbose });
    assert.match(onlyRoleWarning, /selected role work is split across Git config sources/);
  }
  assert.equal(JSON.stringify(result), before);
});


const destinationFixture: DoctorResult = {
  overall: 'warning',
  commitIdentity: { fullName: { value: 'Fixture', source: 'local' }, email: { value: 'fixture@example.invalid', source: 'local' } },
  configuredIdentity: { local: {}, global: {} }, scope: { effective: 'local', hasLocalOverride: true },
  repository: { isInsideWorkTree: true, hasCommits: true,
    fetchRemote: { name: 'origin', url: 'git@fetch.test:read/repo.git', protocol: 'ssh', host: 'fetch.test' },
    push: { targets: [
      { remote: { name: 'origin', url: 'ssh://deploy@push.test:2222/write/one.git', protocol: 'ssh', host: 'push.test', user: 'deploy', port: 2222 }, sshAuth: { ok: false, host: 'push.test', message: 'Unverified first endpoint' } },
      { remote: { name: 'origin', url: 'git@later.test:write/two.git', protocol: 'ssh', host: 'later.test' }, sshAuth: { ok: false, host: 'later.test', message: 'Unverified second endpoint' } }
    ] }
  },
  checks: [
    { status: 'ok', label: 'commit', message: 'Identity check passed' },
    { status: 'ok', label: 'policy', message: 'Policy check passed' },
    { status: 'warn', label: 'auth', message: 'Unverified first endpoint\n- second line\n\nManual detail' },
    { status: 'warn', label: 'auth', message: 'Unverified second endpoint' },
    { status: 'info', label: 'fix', message: 'A separate informational note' }
  ]
};

test('doctor keeps all actual push URLs, exact ok counts, info and indented continuations in both modes', () => {
  const before = JSON.stringify(destinationFixture);
  const next: string[] = [];
  for (const verbose of [false, true]) {
    const output = renderDoctor(destinationFixture, 'doctor', { verbose });
    const pushes = output.split('\n').filter((line) => /^  push\s/.test(line));
    assert.deepEqual(pushes, destinationFixture.repository.push!.targets.map((target) => `  push  ${target.remote.url}`));
    assert.ok(pushes.every((line) => !line.includes('fetch.test')));
    assert.match(output, /checks  2 ok, 2 warnings/);
    assert.match(output, /info fix\s+A separate informational note/);
    assert.equal(output.split('\n').filter((line) => /^  ok /.test(line)).length, verbose ? 2 : 0);
    assert.match(output, /Unverified first endpoint\n {14}- second line\n {14}\n {14}Manual detail/);
    assert.match(output, /cannot verify a future Git push/);
    next.push(output.split('\n').find((line) => /^  next /.test(line))!);
  }
  assert.equal(next[0], next[1]);
  assert.equal(JSON.stringify(destinationFixture), before);
  const onlyInfo = renderDoctor({ ...destinationFixture, overall: 'aligned', checks: [{ status: 'info', label: 'auth', message: 'SSH authentication skipped (--offline)' }] });
  assert.match(onlyInfo, /checks  0 ok, 0 warnings/);
  assert.match(onlyInfo, /SSH authentication skipped/);
  assert.doesNotMatch(onlyInfo, /next /);
});

test('doctor next action follows destination, history, identity/policy, auth and remaining warnings independently of order or mode', () => {
  const warn = (label: string) => ({ status: 'warn' as const, label, message: `reported ${label}` });
  const cases: Array<{ result: DoctorResult; next: RegExp }> = [
    { result: { ...destinationFixture, repository: { ...destinationFixture.repository, push: { targets: [] } }, checks: ['auth', 'policy', 'identity', 'history', 'remote'].map(warn) }, next: /configure the intended push destination.*gitrole won't guess the URL/ },
    { result: { ...destinationFixture, checks: ['auth', 'policy', 'identity', 'history'].map(warn) }, next: /Prepare the first commit after resolving the reported identity and policy warnings/ },
    { result: { ...destinationFixture, checks: ['auth', 'history'].map(warn) }, next: /Create the intended first commit before pushing/ },
    { result: { ...destinationFixture, checks: ['auth', 'identity'].map(warn) }, next: /Confirm the intended commit identity/ },
    { result: { ...destinationFixture, checks: ['auth', 'policy'].map(warn) }, next: /Resolve the effective identity and .gitrole policy warnings/ },
    { result: { ...destinationFixture, checks: [warn('auth')] }, next: /choose to run gitrole auth test.*may prompt, connect, run configured commands or change SSH state/ },
    { result: { ...destinationFixture, checks: [warn('host')] }, next: /Compare each listed push destination/ },
    { result: { ...destinationFixture, checks: [warn('unknown')] }, next: /Resolve the remaining reported warnings/ },
    { result: { ...destinationFixture, repository: { isInsideWorkTree: false }, checks: ['auth', 'history', 'repo'].map(warn) }, next: /Run doctor from the intended Git repository/ }
  ];
  for (const { result, next } of cases) {
    const advice: string[] = [];
    for (const checks of [result.checks, [...result.checks].reverse()]) {
      for (const verbose of [false, true]) {
        const output = renderDoctor({ ...result, checks }, 'doctor', { verbose });
        for (const check of checks) assert.ok(output.includes(check.message));
        const line = output.split('\n').find((line) => /^  next /.test(line))!;
        assert.match(line, next); advice.push(line);
      }
    }
    assert.equal(new Set(advice).size, 1);
  }
});

test('doctor never suggests equivalent plain SSH for unsupported wrappers or pretends HTTPS credentials were observed', () => {
  for (const verbose of [false, true]) {
    const wrapped = structuredClone(destinationFixture);
    wrapped.repository.push!.targets[0]!.message = 'custom SSH command cannot be reproduced';
    const output = renderDoctor(wrapped, 'doctor', { verbose });
    assert.match(output, /plain SSH command cannot reproduce it/);
    assert.doesNotMatch(output, /choose to run gitrole auth test|ssh -T/);
    const https = structuredClone(destinationFixture);
    https.repository.push!.targets = [{ remote: { name: 'origin', url: 'https://push.test/write/repo.git', protocol: 'https', host: 'push.test' } }];
    assert.match(renderDoctor(https, 'doctor', { verbose }), /provider credentials have not been observed/);
  }
});


test('mixed-transport auth advice covers both transports with or without a local HTTPS pin', () => {
  for (const reversed of [false, true]) {
    for (const offline of [false, true]) {
      for (const pinned of [false, true]) {
        const result = structuredClone(destinationFixture);
        result.role = { name: 'work', fullName: 'Fixture', email: 'fixture@example.invalid', githubUser: 'fixture-user' };
        result.repository.push!.targets = [
          destinationFixture.repository.push!.targets[0]!,
          { remote: { name: 'origin', url: 'https://push.test/write/repo.git', protocol: 'https', host: 'push.test' } }
        ];
        if (reversed) result.repository.push!.targets.reverse();
        if (pinned) result.repoPolicy = { version: 1, defaultRole: 'work', allowedRoles: ['work'], effectiveRole: 'work', status: 'default' };
        result.checks = [
          { status: pinned ? 'info' : 'warn', label: 'auth', message: pinned ? 'HTTPS pin matches; credentials not observed' : 'HTTPS has no repo pin' },
          { status: offline ? 'info' : 'warn', label: 'auth', message: offline ? 'SSH authentication skipped' : 'SSH account unverified' }
        ];
        const outputs = [false, true].map((verbose) => renderDoctor(result, 'doctor', { offline, verbose }));
        const advice = outputs.map((output) => output.split('\n').find((line) => /^  next /.test(line)));
        assert.equal(advice[0], advice[1]);
        if (!pinned || !offline) {
          assert.match(advice[0]!, /SSH and HTTPS push destinations need separate checks/);
          assert.match(advice[0]!, /--verbose/);
          assert.doesNotMatch(advice[0]!, /gitrole auth test|ssh -T/);
        } else assert.equal(advice[0], undefined);
      }
    }
  }
});

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

test('human status condenses additional reasons and preserves endpoint and advice; short output stays exact', () => {
  const result = renderStatus(status);
  assert.match(result, /git@fixture.test:fixture\/repo.git/);
  assert.match(result, /and other differences; see gitrole doctor --json/);
  assert.match(result, /Manual connection check/);
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
  assert.match(human, /and other differences; see gitrole doctor --json/);
  assert.doesNotMatch(human, /configured remote command/);
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

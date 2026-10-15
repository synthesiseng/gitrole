/* Exercises each human identity display slot independently, without changing machine data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DoctorResult, EffectiveGitIdentity, StatusResult } from '../src/application/contracts.js';
import { checkCommit } from '../src/application/check-commit.js';
import { renderCommitCheck } from '../src/interface/check-commit.js';
import { renderSavedRole, renderUsedRole, renderCurrentRole, renderImportedCurrentRole,
  renderRoleList, renderStatus, renderShortStatus, renderDoctor } from '../src/interface/renderer.js';

// Explicit Unicode Bidi_Control inventory; do not derive the oracle from the renderer.
const codes = [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c,
  0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
const text = `Fixture${String.fromCharCode(...codes)}Identity`;
const role = { name: 'work', fullName: 'Fixture', email: 'fixture@example.invalid' };
const diagnosed = { fullName: { value: role.fullName, source: 'local' as const },
  email: { value: role.email, source: 'local' as const } };
const status: StatusResult = { roleName: 'no-role', scope: 'local', localOverride: true,
  commit: 'warn', remote: 'na', auth: 'na', policy: 'na', overall: 'warning' };
const doctor: DoctorResult = { overall: 'warning', commitIdentity: diagnosed,
  configuredIdentity: { local: role, global: {} },
  scope: { effective: 'local', hasLocalOverride: true }, repository: { isInsideWorkTree: true }, checks: [] };

function assertEscaped(output: string): void {
  for (const code of codes) {
    assert.ok(!output.includes(String.fromCharCode(code)), `raw U+${code.toString(16)}`);
    assert.ok(output.includes(`\\u${code.toString(16).padStart(4, '0')}`), `missing visible U+${code.toString(16)}`);
  }
}

for (const field of ['fullName', 'email'] as const) {
  const input = { ...role, [field]: text };
  const outputs: Record<string, () => string> = {
    saved: () => renderSavedRole(input),
    used: () => renderUsedRole({ role: input, scope: 'local' }),
    imported: () => renderImportedCurrentRole({ role: input, scope: 'local' }),
    list: () => renderRoleList({ roles: [input] }),
    'matched current': () => renderCurrentRole({ role: input, identity: input, scope: 'local' }),
    'unmatched current': () => renderCurrentRole({ identity: input, scope: 'local' }),
    'doctor effective': () => renderDoctor({ ...doctor, commitIdentity: {
      ...diagnosed, [field]: { value: text, source: 'local' } } }),
    'doctor hidden global': () => renderDoctor({ ...doctor,
      configuredIdentity: { local: role, global: input } }, 'doctor', { verbose: true })
  };
  for (const [name, render] of Object.entries(outputs)) {
    test(`${name} escapes all bidi controls in ${field}`, () => assertEscaped(render()));
  }
  for (const kind of ['author', 'committer'] as const) {
    test(`commit diagnostic escapes bidi controls in ${kind} ${field}`, () => {
      const identity: EffectiveGitIdentity = { author: diagnosed, committer: diagnosed, scope: doctor.scope };
      identity[kind] = { ...diagnosed, [field]: { value: text, source: 'local' } };
      const before = JSON.stringify(identity);
      assertEscaped(renderCommitCheck({ exitCode: 2, reasons: ['identity mismatch'], identity }));
      assert.equal(JSON.stringify(identity), before);
    });
  }
}

for (const field of ['commitIdentity', 'envNote', 'historyNote'] as const) {
  test(`status escapes bidi in ${field} without mutating machine fields`, () => {
    const result = { ...status, [field]: text };
    const before = JSON.stringify(result);
    assertEscaped(renderStatus(result));
    assert.equal(JSON.stringify(result), before);
    assert.equal(renderShortStatus(result), 'role=no-role scope=local override=true commit=warn remote=na auth=na policy=na overall=warning');
  });
}

for (const label of ['role', 'fix', 'commit', 'identity', 'env']) {
  test(`doctor escapes bidi in ${label} diagnostics in both modes`, () => {
    const result: DoctorResult = { ...doctor, checks: [{ status: 'warn', label, message: text }] };
    const before = JSON.stringify(result);
    for (const verbose of [false, true]) assertEscaped(renderDoctor(result, 'doctor', { verbose }));
    assert.equal(JSON.stringify(result), before);
  });
}

test('legacy bidi role cannot satisfy commit policy or become a suggested role', async () => {
  for (const code of codes) {
    for (const field of ['fullName', 'email'] as const) {
      const value = `Fixture${String.fromCharCode(code)}Identity`;
      const invalid = { ...role, [field]: value };
      const ident = { ...diagnosed, [field]: { value, source: 'local' as const } };
      const result = await checkCommit(async () => ({ context: 'worktree', roles: [invalid],
        identity: { author: ident, committer: ident, scope: doctor.scope },
        policy: { version: 1, defaultRole: 'work', allowedRoles: ['work'] } }));
      assert.equal(result.exitCode, 2);
      assert.equal(result.suggestedRole, undefined);
    }
  }
});

test('human output preserves multilingual letters, combining marks and join controls', () => {
  const fullName = 'ليلى שרה Jose\u0301 می\u200cنا क्\u200dष';
  assert.ok(renderSavedRole({ ...role, fullName }).includes(fullName));
});

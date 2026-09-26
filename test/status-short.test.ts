/*
 * Locks the status --short field order against the status-short-baseline fixture.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderShortStatus } from '../src/interface/renderer.js';
import {
  statusShortBaseline,
  statusShortFieldOrder,
  statusShortPolicyOk,
  statusShortPolicyWarn
} from './fixtures/status-short.js';

test('status-short-baseline locks field order including policy', () => {
  const line = renderShortStatus({
    roleName: 'work',
    scope: 'local',
    localOverride: true,
    overall: 'aligned',
    commit: 'ok',
    remote: 'ok',
    auth: 'ok',
    policy: 'na'
  });

  assert.equal(line, statusShortBaseline.line, statusShortBaseline.id);
  assert.deepEqual(
    line.split(' ').map((field) => field.split('=')[0]),
    [...statusShortFieldOrder]
  );
});

test('status --short policy values stay warn or ok without changing auth', () => {
  const warned = renderShortStatus({
    roleName: 'client-acme',
    scope: 'local',
    localOverride: true,
    overall: 'warning',
    commit: 'ok',
    remote: 'ok',
    auth: 'ok',
    policy: 'warn'
  });
  const satisfied = renderShortStatus({
    roleName: 'work',
    scope: 'local',
    localOverride: true,
    overall: 'aligned',
    commit: 'ok',
    remote: 'ok',
    auth: 'ok',
    policy: 'ok'
  });

  assert.equal(warned, statusShortPolicyWarn.line, statusShortPolicyWarn.id);
  assert.equal(satisfied, statusShortPolicyOk.line, statusShortPolicyOk.id);
  assert.match(warned, /auth=ok policy=warn overall=warning/);
  assert.match(satisfied, /auth=ok policy=ok overall=aligned/);
});

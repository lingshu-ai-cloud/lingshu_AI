import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkMobileWorkbenchRelease } from './check-mobile-workbench-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('repository contract passes while missing external release evidence fails closed', () => {
  const report = checkMobileWorkbenchRelease(root, {});
  assert.equal(report.status, 'blocked');
  assert.deepEqual(report.blockers.map(item => item.code), [
    'request_domain_unverified',
    'privacy_declaration_unverified',
    'real_device_acceptance_unverified',
  ]);
  assert.ok(report.checks.some(item => item.code === 'server_derived_scope'));
  assert.ok(report.checks.some(item => item.code === 'network_domain_types' && item.detail === 'request'));
  assert.ok(report.checks.some(item => item.code === 'record_permission_description'));
  assert.ok(report.checks.some(item => item.code === 'privacy_api_inventory' && /chooseMedia/.test(item.detail) && /getRecorderManager/.test(item.detail)));
});

test('explicit external evidence can complete the preflight', () => {
  const report = checkMobileWorkbenchRelease(root, {
    WECHAT_REQUEST_DOMAIN_VERIFIED: '1',
    WECHAT_PRIVACY_DECLARATION_VERIFIED: '1',
    WECHAT_REAL_DEVICE_ACCEPTANCE_VERIFIED: '1',
  });
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.blockers, []);
});

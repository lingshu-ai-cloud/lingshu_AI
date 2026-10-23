import test from 'node:test';
import assert from 'node:assert/strict';
import { whatsappTokenExpiry } from './tokenAuthority.js';
const base = { is_valid: true, app_id: 'app', expires_at: 0, scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'] };
test('business integration expiry uses actual token/data-access deadlines; invalid authority never assumes 60 days', () => {
  assert.equal(whatsappTokenExpiry(base, 'app'), '');
  const now = Math.floor(Date.now() / 1000), deadline = now + 3600;
  assert.equal(whatsappTokenExpiry({ ...base, expires_at: deadline + 3600, data_access_expires_at: deadline }, 'app'), new Date(deadline * 1000).toISOString());
  for (const patch of [{ expires_at: undefined }, { expires_at: '0' }, { expires_at: NaN }, { expires_at: -1 },
    { expires_at: 1e100 }, { data_access_expires_at: '0' }]) assert.throws(() => whatsappTokenExpiry({ ...base, ...patch }, 'app'), /expiry_unknown/);
  assert.throws(() => whatsappTokenExpiry({ ...base, data_access_expires_at: now - 1 }, 'app'), /expired/);
  for (const patch of [{ is_valid: false }, { app_id: 'foreign' }, { scopes: ['whatsapp_business_management'] }])
    assert.throws(() => whatsappTokenExpiry({ ...base, ...patch }, 'app'), /authority_invalid/);
});

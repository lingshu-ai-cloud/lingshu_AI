import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-connections-'));
process.env.LOCAL_STORE_DIR = dir;
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.NODE_ENV = 'test';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.DATA_BACKEND = 'pocketbase';
process.env.META_ADS_API_VERSION = 'v25.0';
const originalFetch = globalThis.fetch;

try {
  let requestedFields: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://graph.facebook.com') return originalFetch(input, init);
    requestedFields = url.searchParams.get('fields')?.split(',') || [];
    return Response.json({
      id: 'act_123', account_id: '123', name: 'Meta US', business_name: 'Lingshu Demo', currency: 'USD',
      account_status: 1, timezone_id: 1, timezone_name: 'America/Los_Angeles', timezone_offset_hours_utc: -8,
    });
  }) as typeof fetch;
  const { connectAccount, listConnections } = await import('./connections.js');
  const connection = await connectAccount('tenant-a', { provider: 'meta', accountId: 'act_123', accessToken: 'test-token' });
  assert.equal(connection.accountId, '123', JSON.stringify(connection));
  assert.equal(connection.status, 'connected');
  assert.equal(connection.businessName, 'Lingshu Demo');
  assert.equal(connection.accountStatus, 1);
  assert.equal(connection.timezoneId, 1);
  assert.equal(connection.timezoneName, 'America/Los_Angeles');
  assert.equal(connection.timezoneOffsetHoursUtc, -8);
  assert.ok(requestedFields.includes('timezone_name'));
  assert.ok(requestedFields.includes('timezone_offset_hours_utc'));
  const listed = await listConnections('tenant-a');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].timezoneName, 'America/Los_Angeles');
  assert.equal('tokenCipher' in listed[0], false, 'public connection responses must not expose encrypted credentials');
  assert.equal((await listConnections('tenant-b')).length, 0, 'account context must remain tenant isolated');
  console.log('platform ad connection account-context tests passed');
} finally {
  globalThis.fetch = originalFetch;
  fs.rmSync(dir, { recursive: true, force: true });
}

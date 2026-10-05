import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, createHmac } from 'node:crypto';
import { VolcengineArkAssets } from './volcengineArkAssets.js';

test('Ark client uses the documented validation, image creation and status actions', async () => {
  const original = globalThis.fetch; const calls: Array<{ action: string; body: any }> = [];
  const responses: Record<string, unknown> = {
    CreateVisualValidateSession: { BytedToken: 'token-1', H5Link: 'https://ark.example.test/verify' },
    GetVisualValidateResult: { GroupId: 'group-person-1' },
    CreateAsset: { Id: 'asset-image-1' },
    GetAsset: { Id: 'asset-image-1', GroupId: 'group-person-1', AssetType: 'Image', Status: 'Active' },
  };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); const action = String(url.searchParams.get('Action'));
    calls.push({ action, body: JSON.parse(String(init?.body || '{}')) });
    const headers = init?.headers as Record<string, string>;
    assert.match(String(headers?.authorization), /^HMAC-SHA256 Credential=/);
    const sha = (value: string) => createHash('sha256').update(value).digest('hex');
    const mac = (key: string | Buffer, value: string) => createHmac('sha256', key).update(value).digest();
    const date = headers['x-date']; const day = date.slice(0, 8); const scope = `${day}/cn-beijing/ark/request`;
    const body = String(init?.body || '{}'); const digest = sha(body);
    const canonical = `POST\n/\nAction=${action}&Version=2024-01-01\ncontent-type:application/json\nhost:ark.cn-beijing.volcengineapi.com\nx-content-sha256:${digest}\nx-date:${date}\n\ncontent-type;host;x-content-sha256;x-date\n${digest}`;
    const key = mac(mac(mac(mac('sk-test', day), 'cn-beijing'), 'ark'), 'request');
    const signature = createHmac('sha256', key).update(`HMAC-SHA256\n${date}\n${scope}\n${sha(canonical)}`).digest('hex');
    assert.match(headers.authorization, new RegExp(`Signature=${signature}$`));
    return new Response(JSON.stringify({ Result: responses[action] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const client = new VolcengineArkAssets('ak-test', 'sk-test');
    assert.equal((await client.createValidationSession('default', 'https://app.example.test/callback')).BytedToken, 'token-1');
    assert.equal((await client.validationResult('default', 'token-1')).GroupId, 'group-person-1');
    assert.equal(await client.createImage('default', 'group-person-1', 'https://assets.example.test/photo.jpg', 'lingshu-test'), 'asset-image-1');
    assert.equal((await client.getAsset('default', 'asset-image-1')).Status, 'Active');
    assert.equal((await client.findImage('default', 'group-person-1', 'asset-image-1'))?.Id, 'asset-image-1');
    assert.equal(await client.findImage('default', 'group-other', 'asset-image-1'), undefined);
    assert.deepEqual(calls.map(item => item.action), ['CreateVisualValidateSession', 'GetVisualValidateResult', 'CreateAsset', 'GetAsset', 'GetAsset', 'GetAsset']);
    assert.deepEqual(calls[2]?.body, { ProjectName: 'default', GroupId: 'group-person-1', URL: 'https://assets.example.test/photo.jpg', AssetType: 'Image', Name: 'lingshu-test' });
  } finally { globalThis.fetch = original; }
});

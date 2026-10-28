import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sealAccountCredential } from '../lib/accountCredentials.js';
import { store } from '../storage/index.js';
import { publishLinkedInWithDurableReceipt, type LinkedInAccountRecord } from './linkedInPublisher.js';

test('LinkedIn image and multi-image use the existing guarded publisher and persist the post receipt', async () => {
  process.env.PLATFORM_TOKEN_ENCRYPTION_KEY = 'linkedin-image-publisher-test-key';
  const originalGet = store.getById, originalUpdate = store.update;
  const row = { id: 'post', tenant_id: 'tenant-a', stats: { publishResults: { account: { attemptId: 'attempt', status: 'in_flight' } } } };
  const account: LinkedInAccountRecord = { id: 'account', tenantId: 'tenant-a', platform: 'linkedin', providerAccountId: 'member', accessToken: sealAccountCredential('test-token'), status: 'connected', scope: 'w_member_social' };
  const sequence: string[] = [];
  try {
    store.getById = (async () => structuredClone(row)) as typeof store.getById;
    store.update = (async (_collection, _id, patch) => { Object.assign(row, patch); return true; }) as typeof store.update;
    const input = { tenantId: 'tenant-a', accountId: 'account', account, imagePaths: ['/one.jpg', '/two.png'], title: 'Image', commentary: 'Text', tracked: row as never,
      directAttempt: { attemptId: 'attempt' }, beforeEffect: async () => { sequence.push('lease'); }, revalidate: async () => { sequence.push('source'); },
      markProviderStarted: () => { sequence.push('started'); }, onProviderReceipt: async (id: string) => { sequence.push(id); },
      publishImages: async (args: Parameters<NonNullable<Parameters<typeof publishLinkedInWithDurableReceipt>[0]['publishImages']>>[0]) => {
        assert.deepEqual(args.imagePaths, ['/one.jpg', '/two.png']); assert.equal(args.accessToken, 'test-token');
        await args.beforeInitialize!('/one.jpg', 0); await args.beforeUpload!('/one.jpg', 0); await args.beforePublish!();
        await args.onProviderReceipt!('urn:li:share:123');
        return { id: 'urn:li:share:123', providerReceiptId: 'urn:li:share:123', imageUrns: [], authorUrn: 'urn:li:person:member', url: '' };
      } };
    await publishLinkedInWithDurableReceipt(input);
    assert.deepEqual(sequence, ['lease', 'source', 'started', 'lease', 'source', 'lease', 'source', 'urn:li:share:123']);
    assert.equal((row.stats.publishResults.account as { providerReceiptId?: string }).providerReceiptId, 'urn:li:share:123');
    await assert.rejects(publishLinkedInWithDurableReceipt({ ...input, account: { ...account, scope: '' } }), /缺少.*发布权限/);
    await assert.rejects(publishLinkedInWithDurableReceipt({ ...input, filePath: '/video.mp4' }), /不能同时包含视频和图片/);
  } finally { store.getById = originalGet; store.update = originalUpdate; }
});

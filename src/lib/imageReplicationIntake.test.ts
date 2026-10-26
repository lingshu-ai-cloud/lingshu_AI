import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveImageReplicationIntake } from './imageReplicationIntake';
import { assistantCreationPortalSchema } from '../../shared/contracts/assistantCreationPortal';
import { assistantImageReplicationPortal } from '../components/assistant/assistantImageReplicationIntent';
import { parseMessages } from '../../server/routes/assistantThreadMessageInput';

test('known product facts remove redundant questions; missing facts remain missing', () => {
  const empty = { objective: '', audience: '', callToAction: '' };
  const defaults = resolveImageReplicationIntake({ id: 'p', name: '面膜', highlights: '独立包装' }, empty);
  assert.equal(defaults.objective, '独立包装');
  assert.equal(defaults.callToAction, '咨询产品详情');
  assert.match(defaults.audience, /资料不足.*不假设客户画像/);
  assert.equal(resolveImageReplicationIntake({ id: 'p', name: '面膜' }, empty).objective, '');
  assert.deepEqual(resolveImageReplicationIntake({ id: 'p', name: '面膜', highlights: '旧卖点' }, {
    objective: '  已确认新卖点 ', audience: '采购负责人', callToAction: '申请样品',
  }), { objective: '已确认新卖点', audience: '采购负责人', callToAction: '申请样品' });
});

test('conversation checkpoint preserves editable intake and task pointer but rejects executable fields', () => {
  const portal = assistantImageReplicationPortal('复刻一张图文海报')!;
  const intake = { step: 2, productId: 'p', objective: '已确认卖点', audience: '', callToAction: '',
    platform: 'instagram', aspectRatio: '4:5', language: 'en', submitted: true, imageTaskId: 'image-1' };
  const value = { ...portal, imageReplication: { intake } };
  assert.ok(assistantCreationPortalSchema.safeParse(value).success);
  const message = { role: 'assistant' as const, content: '图文复刻', creationPortal: value };
  assert.deepEqual(parseMessages([message]), [message]);
  assert.ok(assistantCreationPortalSchema.safeParse({ ...value, imageReplication: { intake, reference: { sourceRecordId: 'post-1', name: 'Collected post' } } }).success);
  assert.equal(assistantCreationPortalSchema.safeParse({ ...value, imageReplication: { intake, reference: { sourceRecordId: 'post-1', materialId: 'asset-1', name: 'Ambiguous' } } }).success, false);
  assert.equal(assistantCreationPortalSchema.safeParse({ ...value, imageReplication: { intake: { ...intake, paidApproved: true } } }).success, false);
});

import '../server/loadEnvironment.js';
import fs from 'node:fs';
import path from 'node:path';
import { store } from '../server/storage/index.js';
import { pbCreateStrict, pbPatchStrict } from '../server/storage/pb.js';

const tenantId = 'f6939c3ae3de0c9';
const approvalId = 'mwseedapproval1';
const postId = 'mobilemockpost1';
const videoFile = 'mobile-mock-product-demo.mp4';
const source = path.resolve('data/media/object-storage/materials/tenants/dA/272f4b0468f21a73c61980ea37d8325fbf3776a88c16ca6fe0f382100e2e772c.mp4');
const targetDir = path.resolve('data/publishing-uploads', tenantId);
const target = path.join(targetDir, videoFile);

if (!fs.existsSync(source)) throw new Error('mobile_operator_mock_source_missing');
fs.mkdirSync(targetDir, { recursive: true });
if (!fs.existsSync(target)) fs.copyFileSync(source, target);

const approval = await store.getById<any>('approval_requests', approvalId);
if (!approval || approval.tenant_id !== tenantId) throw new Error('mobile_operator_mock_approval_missing');
const evidence = typeof approval.evidence === 'string' ? JSON.parse(approval.evidence || '{}') : approval.evidence || {};
await pbPatchStrict('approval_requests', approvalId, { run_id: String(approval.run_id || 'mobilemockrun1'), evidence: { ...evidence, mock: true, mockLabel: 'Mock 演示成片', localVideoFile: videoFile } });

const post = {
  id: postId, tenant_id: tenantId, content_id: 'mobile-mock-content-1', title: 'Mock · 工厂新品竖屏演示', platform: 'tiktok',
  platform_post_id: 'mock-local-post-20261015', published_at: '2026-10-15T10:30:00+08:00',
  stats: { status: 'published', views: 12860, likes: 936, comments: 48, mock: true, stage: 'published' },
  inquiries: 6, deals: 1, track_code: 'MOBILE-MOCK-1', wa_link: '',
};
const existing = await store.getById<any>('posts', postId);
if (existing) await pbPatchStrict('posts', postId, post);
else await pbCreateStrict('posts', post);
console.log(JSON.stringify({ ok: true, tenantId, approvalId, postId, videoFile }));

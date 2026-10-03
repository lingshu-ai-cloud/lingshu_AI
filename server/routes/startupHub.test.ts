import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { startupHubRouter } from './startupHub.js';

const directory = await mkdtemp(path.join(os.tmpdir(), 'startup-hub-route-'));
const previousDataRoot = process.env.STARTUP_HUB_DATA_DIR;
const previousFileRoot = process.env.STARTUP_HUB_FILE_DIR;
const previousChatRoot = process.env.STARTUP_HUB_LEAD_CHAT_DIR;
const previousNodeEnv = process.env.NODE_ENV;
process.env.STARTUP_HUB_DATA_DIR = path.join(directory, 'records');
process.env.STARTUP_HUB_FILE_DIR = path.join(directory, 'files');
process.env.STARTUP_HUB_LEAD_CHAT_DIR = path.join(directory, 'lead-chats');
process.env.NODE_ENV = 'test';

const app = express();
app.use(express.json());
app.use('/hub', startupHubRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});

try {
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/hub`;
  const headers = { 'x-startup-hub-preview': 'local-preview' };
  const savedCompany = await fetch(`${base}/company`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '最小公司草稿', taxpayerType: '未确认', taxRegion: '', taxContact: '' }),
  });
  assert.equal(savedCompany.status, 200);
  const companyPayload = await savedCompany.json() as { company: { name: string; taxRegion: string } };
  assert.equal(companyPayload.company.name, '最小公司草稿');
  assert.equal(companyPayload.company.taxRegion, '');

  const productResponse = await fetch(`${base}/products`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '开发协作中台', owner: '产品负责人', status: 'active', customerProblem: '统一研发协作信息' }),
  });
  assert.equal(productResponse.status, 201);
  const productPayload = await productResponse.json() as { record: { id: string } };
  const prdResponse = await fetch(`${base}/productDocuments`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: productPayload.record.id, title: '开发协作 PRD', owner: '产品负责人', reviewers: ['技术负责人'], status: 'review', version: 'v0.1', content: '# 开发协作\n\n## 验收标准' }),
  });
  assert.equal(prdResponse.status, 201);
  const prdPayload = await prdResponse.json() as { record: { id: string } };
  const reviewResponse = await fetch(`${base}/productReviews`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: productPayload.record.id, documentId: prdPayload.record.id, type: 'technical', title: '技术评审', owner: '技术负责人', reviewers: ['开发负责人'], status: 'pending', checklist: ['接口边界明确'] }),
  });
  assert.equal(reviewResponse.status, 201);
  const taskResponse = await fetch(`${base}/developmentTasks`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: productPayload.record.id, documentId: prdPayload.record.id, title: '实现协作看板', type: 'fullstack', assignee: '开发负责人', reviewer: '产品负责人', status: 'ready', priority: 'high', acceptanceCriteria: '任务状态可修改' }),
  });
  assert.equal(taskResponse.status, 201);
  const taskPayload = await taskResponse.json() as { record: { id: string } };
  const issueResponse = await fetch(`${base}/issues`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '看板状态未刷新', severity: 'high', status: 'open', source: '测试', assignee: '开发负责人', productId: productPayload.record.id, linkedTaskId: taskPayload.record.id, reproductionSteps: '修改任务状态', expectedBehavior: '立即刷新', actualBehavior: '仍显示旧状态' }),
  });
  assert.equal(issueResponse.status, 201);

  const createdSopResponse = await fetch(`${base}/sops`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '客户反馈闭环',
      trigger: '收到客户问题',
      owner: '产品负责人',
      version: '1.0',
      status: 'active',
      steps: ['记录证据', '分配负责人', '验证结果'],
      successCriteria: '客户确认问题已解决',
    }),
  });
  assert.equal(createdSopResponse.status, 201);
  const createdSopPayload = await createdSopResponse.json() as { record: { id: string; name: string } };
  assert.equal(createdSopPayload.record.name, '客户反馈闭环');

  const createdRunResponse = await fetch(`${base}/sopRuns`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sopId: createdSopPayload.record.id,
      sopName: createdSopPayload.record.name,
      owner: '产品负责人',
      status: 'running',
      completedSteps: [],
    }),
  });
  assert.equal(createdRunResponse.status, 201);
  const createdRunPayload = await createdRunResponse.json() as { record: { id: string } };
  const updatedRunResponse = await fetch(`${base}/sopRuns/${createdRunPayload.record.id}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ completedSteps: [0], status: 'running' }),
  });
  assert.equal(updatedRunResponse.status, 200);
  const updatedRunPayload = await updatedRunResponse.json() as { record: { completedSteps: number[] } };
  assert.deepEqual(updatedRunPayload.record.completedSteps, [0]);

  const resourceResponse = await fetch(`${base}/resources`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '生产主机', type: '云服务器', environment: '生产', owner: '技术负责人', status: 'healthy', provider: '腾讯云',
      billingCycle: 'annual', subscriptionAmount: 3600, currency: 'CNY', renewalDate: '2027-09-22', storageUsedGb: 40, storageTotalGb: 100,
    }),
  });
  assert.equal(resourceResponse.status, 201);
  const resourcePayload = await resourceResponse.json() as { record: { id: string } };
  const deploymentResponse = await fetch(`${base}/deployments`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '领小鼠 API', resourceId: resourcePayload.record.id, environment: '生产', serviceType: 'api', owner: '技术负责人', status: 'running' }),
  });
  assert.equal(deploymentResponse.status, 201);

  const leadResponse = await fetch(`${base}/leads`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyName: '某美妆工厂', resourceType: 'customer', industry: '美妆 / 个护', country: '中国', province: '广东', city: '广州',
      contactName: '客户联系人', contactMethod: 'wechat', source: '展会 / 峰会', owner: '商务负责人', stage: 'qualified', intention: 'high', tags: ['ODM'],
    }),
  });
  assert.equal(leadResponse.status, 201);
  const leadPayload = await leadResponse.json() as { record: { id: string } };
  const activityResponse = await fetch(`${base}/leadActivities`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId: leadPayload.record.id, type: 'wechat', owner: '商务负责人', summary: '已确认初步需求', happenedAt: '2026-09-22T10:00:00.000Z' }),
  });
  assert.equal(activityResponse.status, 201);

  const chatBytes = Buffer.from('2026-09-20 10:00 客户：需要了解方案\n2026-09-20 10:05 BD：稍后发送');
  const chatUpload = await fetch(`${base}/lead-chats/file?name=${encodeURIComponent('微信聊天.txt')}&leadId=${leadPayload.record.id}&mimeType=${encodeURIComponent('text/plain')}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: chatBytes,
  });
  assert.equal(chatUpload.status, 201);
  const chatUploaded = await chatUpload.json() as { chatImport: { id: string; messageCount: number } };
  assert.equal(chatUploaded.chatImport.messageCount, 2);

  const bytes = Buffer.from('company document');
  const upload = await fetch(`${base}/documents/file?name=${encodeURIComponent('营业执照.pdf')}&category=license&mimeType=${encodeURIComponent('application/pdf')}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/octet-stream' },
    body: bytes,
  });
  assert.equal(upload.status, 201);
  const uploaded = await upload.json() as { document: { id: string; name: string } };
  assert.equal(uploaded.document.name, '营业执照.pdf');

  const snapshotResponse = await fetch(`${base}/snapshot`, { headers });
  assert.equal(snapshotResponse.status, 200);
  const snapshot = await snapshotResponse.json() as { snapshot: { productDocuments: Array<{ id: string }>; productReviews: Array<{ id: string }>; developmentTasks: Array<{ id: string }>; issues: Array<{ id: string; linkedTaskId?: string }>; documents: Array<{ id: string }>; sops: Array<{ id: string }>; sopRuns: Array<{ id: string; completedSteps: number[] }>; resources: Array<{ id: string }>; deployments: Array<{ id: string }>; leads: Array<{ id: string }>; leadActivities: Array<{ id: string }>; leadChatImports: Array<{ id: string }> } };
  assert.equal(snapshot.snapshot.productDocuments[0]?.id, prdPayload.record.id);
  assert.equal(snapshot.snapshot.productReviews.length, 1);
  assert.equal(snapshot.snapshot.developmentTasks[0]?.id, taskPayload.record.id);
  assert.equal(snapshot.snapshot.issues[0]?.linkedTaskId, taskPayload.record.id);
  assert.equal(snapshot.snapshot.documents[0]?.id, uploaded.document.id);
  assert.equal(snapshot.snapshot.sops[0]?.id, createdSopPayload.record.id);
  assert.deepEqual(snapshot.snapshot.sopRuns[0]?.completedSteps, [0]);
  assert.equal(snapshot.snapshot.resources[0]?.id, resourcePayload.record.id);
  assert.equal(snapshot.snapshot.deployments.length, 1);
  assert.equal(snapshot.snapshot.leads[0]?.id, leadPayload.record.id);
  assert.equal(snapshot.snapshot.leadActivities.length, 1);
  assert.equal(snapshot.snapshot.leadChatImports[0]?.id, chatUploaded.chatImport.id);

  const download = await fetch(`${base}/documents/${uploaded.document.id}/content`, { headers });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);

  const chatDownload = await fetch(`${base}/lead-chats/${chatUploaded.chatImport.id}/content`, { headers });
  assert.equal(chatDownload.status, 200);
  assert.deepEqual(Buffer.from(await chatDownload.arrayBuffer()), chatBytes);

  const deleted = await fetch(`${base}/documents/${uploaded.document.id}`, { method: 'DELETE', headers });
  assert.equal(deleted.status, 204);
  const deletedChat = await fetch(`${base}/lead-chats/${chatUploaded.chatImport.id}`, { method: 'DELETE', headers });
  assert.equal(deletedChat.status, 204);
  console.log('startup hub document, infrastructure and lead route tests passed');
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  if (previousDataRoot === undefined) delete process.env.STARTUP_HUB_DATA_DIR;
  else process.env.STARTUP_HUB_DATA_DIR = previousDataRoot;
  if (previousFileRoot === undefined) delete process.env.STARTUP_HUB_FILE_DIR;
  else process.env.STARTUP_HUB_FILE_DIR = previousFileRoot;
  if (previousChatRoot === undefined) delete process.env.STARTUP_HUB_LEAD_CHAT_DIR;
  else process.env.STARTUP_HUB_LEAD_CHAT_DIR = previousChatRoot;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  await rm(directory, { recursive: true, force: true });
}

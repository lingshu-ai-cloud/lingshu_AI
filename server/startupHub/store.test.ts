import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  acknowledgeStartupAnnouncement,
  createStartupHubRecord,
  deleteStartupLeadChatImport,
  deleteStartupCompanyDocument,
  readStartupHubSnapshot,
  resolveStartupCompanyDocument,
  resolveStartupLeadChatImport,
  saveStartupLeadChatImport,
  saveStartupCompanyDocument,
  updateStartupCompany,
  updateStartupHubRecord,
} from './store.js';

const directory = await mkdtemp(path.join(os.tmpdir(), 'startup-hub-store-'));
const previousRoot = process.env.STARTUP_HUB_DATA_DIR;
const previousFileRoot = process.env.STARTUP_HUB_FILE_DIR;
const previousChatRoot = process.env.STARTUP_HUB_LEAD_CHAT_DIR;
process.env.STARTUP_HUB_DATA_DIR = directory;
process.env.STARTUP_HUB_FILE_DIR = path.join(directory, 'files');
process.env.STARTUP_HUB_LEAD_CHAT_DIR = path.join(directory, 'lead-chats');

try {
  const empty = await readStartupHubSnapshot('tenant-a');
  assert.equal(empty.company, null);
  assert.deepEqual(empty.products, []);
  assert.deepEqual(empty.members, []);
  assert.deepEqual(empty.documents, []);
  assert.deepEqual(empty.decisions, []);
  assert.deepEqual(empty.sops, []);
  assert.deepEqual(empty.sopRuns, []);
  assert.deepEqual(empty.capabilities, []);
  assert.deepEqual(empty.deployments, []);
  assert.deepEqual(empty.leads, []);
  assert.deepEqual(empty.leadActivities, []);
  assert.deepEqual(empty.leadChatImports, []);

  await updateStartupCompany('tenant-a', 'owner-a', {
    name: '测试公司',
    taxpayerType: '一般纳税人',
    taxRegion: '上海',
    taxContact: '财务负责人',
  });
  const product = await createStartupHubRecord('tenant-a', 'owner-a', 'products', {
    name: '真实产品',
    owner: '产品负责人',
    status: 'active',
    customerProblem: '减少创业团队在多个工具间切换的成本',
    successMetric: '由真实使用结果验证',
    targetDate: '2027-01-31',
  });
  const member = await createStartupHubRecord('tenant-a', 'owner-a', 'members', {
    name: '协作者',
    email: 'member@example.com',
    role: 'operator',
    status: 'active',
  });
  const updatedMember = await updateStartupHubRecord('tenant-a', 'owner-a', 'members', member.id, { role: 'viewer' });
  assert.equal(updatedMember.role, 'viewer');

  const announcement = await createStartupHubRecord('tenant-a', 'owner-a', 'announcements', {
    title: '同步事项',
    body: '需要团队确认',
    audience: '全员',
    priority: 'important',
    requireConfirm: true,
    acknowledgedBy: [],
  });
  await acknowledgeStartupAnnouncement('tenant-a', 'member-a', announcement.id);
  await acknowledgeStartupAnnouncement('tenant-a', 'member-a', announcement.id);

  const decision = await createStartupHubRecord('tenant-a', 'owner-a', 'decisions', {
    title: '统一使用发布门禁',
    context: '产品发布缺少统一检查',
    decision: '高风险问题未关闭时不可进入发布确认',
    owner: '产品负责人',
    impact: 'product',
    status: 'active',
    reviewDate: '2027-02-01',
  });
  const sop = await createStartupHubRecord('tenant-a', 'owner-a', 'sops', {
    name: '线上事故处理',
    trigger: '出现生产环境告警',
    owner: '技术负责人',
    version: '1.0',
    status: 'active',
    steps: ['确认影响范围', '建立事故记录', '修复并复盘'],
    successCriteria: '服务恢复且复盘完成',
  });
  const sopRun = await createStartupHubRecord('tenant-a', 'owner-a', 'sopRuns', {
    sopId: sop.id,
    sopName: sop.name,
    owner: sop.owner,
    status: 'running',
    completedSteps: [],
  });
  const updatedRun = await updateStartupHubRecord('tenant-a', 'owner-a', 'sopRuns', sopRun.id, { completedSteps: [0, 1], status: 'blocked', note: '等待第三方恢复' });
  assert.deepEqual(updatedRun.completedSteps, [0, 1]);
  assert.equal(updatedRun.status, 'blocked');
  const capability = await createStartupHubRecord('tenant-a', 'owner-a', 'capabilities', {
    name: '客户访谈模板',
    type: 'template',
    owner: '产品负责人',
    status: 'active',
    description: '用于统一记录问题、证据和结论',
    locationUrl: 'https://example.com/template',
    reuseCount: 0,
  });
  const reusedCapability = await updateStartupHubRecord('tenant-a', 'owner-a', 'capabilities', capability.id, { reuseCount: 1 });
  assert.equal(reusedCapability.reuseCount, 1);

  const resource = await createStartupHubRecord('tenant-a', 'owner-a', 'resources', {
    name: '生产 API 主机', type: '云服务器', environment: '生产', owner: '技术负责人', status: 'healthy',
    provider: '腾讯云', region: 'ap-shanghai', billingCycle: 'annual', subscriptionAmount: 3600, currency: 'CNY',
    renewalDate: '2027-09-22', cpuCores: 4, memoryTotalGb: 8, storageUsedGb: 60, storageTotalGb: 100,
  });
  const deployment = await createStartupHubRecord('tenant-a', 'owner-a', 'deployments', {
    name: '领小鼠 API', resourceId: resource.id, environment: '生产', serviceType: 'api', owner: '技术负责人',
    status: 'running', version: 'v1.0.0', branch: 'main', deployedAt: '2026-09-22T10:00:00.000Z',
  });
  const lead = await createStartupHubRecord('tenant-a', 'owner-a', 'leads', {
    companyName: '某美妆制造企业', resourceType: 'customer', industry: '美妆 / 个护', country: '中国', province: '浙江', city: '杭州',
    contactName: '业务联系人', contactRole: '品牌负责人', contactMethod: 'wechat', source: '主动 BD', owner: '商务负责人',
    stage: 'needs', intention: 'high', nextAction: '安排需求会', nextFollowUpDate: '2026-10-01T09:00:00.000Z', estimatedValue: 100000, currency: 'CNY', tags: ['ODM'],
  });
  const leadActivity = await createStartupHubRecord('tenant-a', 'owner-a', 'leadActivities', {
    leadId: lead.id, type: 'wechat', owner: '商务负责人', summary: '客户确认需要查看解决方案', happenedAt: '2026-09-22T11:00:00.000Z', nextAction: '发送方案',
  });

  const chatSourcePath = path.join(directory, 'wechat.txt');
  await writeFile(chatSourcePath, '2026-09-20 10:00 客户：需要了解方案\n2026-09-20 10:05 BD：稍后发送');
  const chatImport = await saveStartupLeadChatImport('tenant-a', 'owner-a', {
    sourcePath: chatSourcePath, leadId: lead.id, name: '微信聊天.txt', mimeType: 'text/plain', sizeBytes: 78,
    sha256: 'b'.repeat(64), messageCount: 2, startedAt: '2026-09-20T10:00:00.000Z', endedAt: '2026-09-20T10:05:00.000Z',
  });
  assert.equal((await resolveStartupLeadChatImport('tenant-a', chatImport.id)).chatImport.messageCount, 2);

  const sourcePath = path.join(directory, 'license.pdf');
  await writeFile(sourcePath, 'real document bytes');
  const document = await saveStartupCompanyDocument('tenant-a', 'owner-a', {
    sourcePath,
    name: '营业执照.pdf',
    category: 'license',
    mimeType: 'application/pdf',
    sizeBytes: 19,
    sha256: 'a'.repeat(64),
  });
  const resolved = await resolveStartupCompanyDocument('tenant-a', document.id);
  assert.equal(resolved.document.name, '营业执照.pdf');

  const populated = await readStartupHubSnapshot('tenant-a');
  assert.equal(populated.company?.name, '测试公司');
  assert.equal(populated.products[0]?.id, product.id);
  assert.equal(populated.products[0]?.customerProblem, '减少创业团队在多个工具间切换的成本');
  assert.deepEqual(populated.announcements[0]?.acknowledgedBy, ['member-a']);
  assert.equal(populated.documents[0]?.id, document.id);
  assert.equal(populated.decisions[0]?.id, decision.id);
  assert.equal(populated.sops[0]?.id, sop.id);
  assert.equal(populated.sopRuns[0]?.status, 'blocked');
  assert.equal(populated.capabilities[0]?.reuseCount, 1);
  assert.equal(populated.resources[0]?.storageTotalGb, 100);
  assert.equal(populated.deployments[0]?.id, deployment.id);
  assert.equal(populated.leads[0]?.id, lead.id);
  assert.equal(populated.leadActivities[0]?.id, leadActivity.id);
  assert.equal(populated.leadChatImports[0]?.id, chatImport.id);
  await deleteStartupCompanyDocument('tenant-a', document.id);
  assert.deepEqual((await readStartupHubSnapshot('tenant-a')).documents, []);
  await deleteStartupLeadChatImport('tenant-a', chatImport.id);
  assert.deepEqual((await readStartupHubSnapshot('tenant-a')).leadChatImports, []);

  const isolated = await readStartupHubSnapshot('tenant-b');
  assert.equal(isolated.company, null);
  assert.deepEqual(isolated.products, []);

  assert.throws(
    () => createStartupHubRecord('tenant-a', 'owner-a', 'resources', {
      name: '资源', type: '服务器', environment: '生产', owner: '运维', status: 'healthy', apiKey: 'must-not-be-stored',
    }),
    /Sensitive field is not allowed/,
  );

  console.log('startup hub store tests passed');
} finally {
  if (previousRoot === undefined) delete process.env.STARTUP_HUB_DATA_DIR;
  else process.env.STARTUP_HUB_DATA_DIR = previousRoot;
  if (previousFileRoot === undefined) delete process.env.STARTUP_HUB_FILE_DIR;
  else process.env.STARTUP_HUB_FILE_DIR = previousFileRoot;
  if (previousChatRoot === undefined) delete process.env.STARTUP_HUB_LEAD_CHAT_DIR;
  else process.env.STARTUP_HUB_LEAD_CHAT_DIR = previousChatRoot;
  await rm(directory, { recursive: true, force: true });
}

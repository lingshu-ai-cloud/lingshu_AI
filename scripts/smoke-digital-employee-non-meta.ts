import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { createLocalInviteTenant } from '../server/lib/localTenants.js';
import { cleanupLocalE2ETenant } from '../server/digitalEmployees/e2eCleanup.js';
import { buildDigitalEmployeeAcceptanceReport } from '../server/digitalEmployees/e2eAcceptance.js';
import { handleMetaWebhook } from '../server/whatsapp/historyImport.js';
import { store } from '../server/storage/index.js';

type JsonRecord = Record<string, any>;

const baseUrl = String(process.env.DIGITAL_EMPLOYEE_E2E_BASE_URL || 'http://127.0.0.1:8790/api/overseas').replace(/\/$/, '');

function firstExisting(candidates: string[]): string {
  const found = candidates.find(candidate => candidate && fs.existsSync(candidate));
  if (!found) throw new Error(`real_local_asset_required:${candidates.join(',')}`);
  return found;
}

async function request(pathname: string, options: RequestInit = {}, token = ''): Promise<JsonRecord> {
  const startedAt = Date.now();
  process.stdout.write(`[smoke] start ${options.method || 'GET'} ${pathname}\n`);
  const headers = new Headers(options.headers || {});
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (options.body && typeof options.body === 'string' && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${baseUrl}/${pathname.replace(/^\//, '')}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(300_000),
  });
  const body = await response.json().catch(() => ({})) as JsonRecord;
  process.stdout.write(`[smoke] end ${pathname} status=${response.status} elapsedMs=${Date.now() - startedAt}\n`);
  if (!response.ok) throw new Error(`${pathname}:${response.status}:${JSON.stringify(body)}`);
  return body;
}

async function rows(collection: string, tenantId: string, field: 'tenant_id' | 'tenantId' = 'tenant_id'): Promise<JsonRecord[]> {
  return (await store.list<JsonRecord>(collection, { where: { [field]: tenantId }, perPage: 1_000 })).items;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('production_environment_not_allowed');
  const root = process.cwd();
  const configuredVideo = String(process.env.DIGITAL_EMPLOYEE_E2E_OWNED_VIDEO || '');
  const ownedVideoFiles = (configuredVideo ? [configuredVideo] : [
    '4a6cf758-ef47-48be-b513-d3d4574754cb.mp4',
    '796b46c5-1b86-48ea-a5cd-d8bfbb6f7c34.mp4',
    'a7daea56-a06a-4409-b025-dd0bd1b852af.mp4',
  ].map(file => path.join(root, 'data/media/tenants/local_tenant_admin_lingshu_admin_local_test', file)))
    .map(file => firstExisting([file]));
  const artifactRoot = String(process.env.DIGITAL_EMPLOYEE_E2E_PREVIEW_DIR || '').trim()
    || fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-e2e-artifacts-'));
  fs.mkdirSync(artifactRoot, { recursive: true });
  process.stdout.write(`[smoke] artifacts ${artifactRoot}\n`);
  const marker = randomUUID().replaceAll('-', '');
  const whatsappImportStatusFile = path.join(root, 'data/whatsapp-import-status.json');
  const whatsappImportStatusBefore = fs.existsSync(whatsappImportStatusFile)
    ? fs.readFileSync(whatsappImportStatusFile)
    : null;
  const inviteCode = `E2E-${randomBytes(8).toString('hex')}`;
  const email = `digital-employee-full-${marker}@local.test`;
  const password = `E2e-${randomBytes(18).toString('base64url')}`;
  const tenant = createLocalInviteTenant({
    companyName: `数字员工非Meta验收-${marker.slice(0, 8)}`,
    contactName: 'Local E2E',
    industry: '智能制造',
    notes: 'ephemeral non-Meta upper-bound acceptance tenant; removed by this run',
    inviteCode,
  });
  try {
    const registration = await request('auth/register', { method: 'POST', body: JSON.stringify({ email, password, inviteCode }) });
    const token = String(registration.token || '');
    assert.ok(token, 'registration must return an auth token');
    assert.equal(registration.tenant?.id, tenant.id);

    const visualNames = ['生产线控制面板.mp4', '自动化贴装工位.mp4', '设备机械机构.mp4'];
    const productAssets: JsonRecord[] = [];
    for (const [index, videoFile] of ownedVideoFiles.entries()) {
      const asset = await request('enterprise/assets', {
        method: 'POST',
        body: JSON.stringify({
          name: visualNames[index] || `电子制造设备素材${index + 1}.mp4`,
          type: 'video/mp4',
          dataUrl: `data:video/mp4;base64,${fs.readFileSync(videoFile).toString('base64')}`,
        }),
      }, token);
      assert.match(String(asset.url || ''), /^\/api\/overseas\/enterprise\/assets\//);
      productAssets.push(asset);
    }

    await request('enterprise/profile', {
      method: 'POST',
      body: JSON.stringify({
        company: { name: tenant.companyName, industry: tenant.industry, companyType: '制造商', mainMarkets: '美国', primaryLanguages: '英语', founded: '2018', description: '面向海外经销商的电子制造生产线设备供应商' },
        products: {
          categories: '电子制造生产线设备', priceRange: '按方案报价', moq: '1 套', certifications: '以已确认资料为准', highlights: '提供真实设备与生产工位视频，具体工艺和参数由人工确认',
          items: [{
            sku: 'LINE-AUTO',
            name: '电子制造生产线设备', category: '电子制造生产线设备', material: '以已确认资料为准', priceRange: '按方案报价', moq: '1 套',
            highlights: '已提供PCB板处理、控制面板、自动化工位和机械机构的真实视频；不据此推断未确认的型号、产能或精度',
            videos: productAssets.map(asset => ({ name: asset.name, type: asset.type, size: asset.size, updatedAt: asset.updatedAt, url: asset.url })),
          }],
        },
        brand: { tone: '专业、克制', style: '展示真实产品与应用场景', taboos: '不承诺未经确认的价格和交期', usp: '真实产品资料与可追溯生产流程', preferredLanguages: '英语' },
        strategy: { currentGoal: '获取经销商询盘', focusProducts: '电子制造生产线设备', focusMarkets: '美国', excludedMarkets: '', pricingStrategy: '人工报价', minMargin: '', agentAutonomy: '托管', aiAutonomy: 'draft' },
        customers: { targetProfiles: '美国工业设备经销商', highValueSignals: '明确应用场景与采购时间', lowQualitySignals: '拒绝提供基本需求', commonQuestions: '规格、MOQ、交期', followupStyle: '简洁、先澄清需求' },
        operations: { leadTime: '以人工确认结果为准', customization: '支持需求评估', logistics: '按项目确认', paymentTerms: '人工确认', riskNotes: '价格、付款、交期必须人工审批' },
        knowledge: '所有商业承诺均以人工确认和企业知识库资料为准。',
      }),
    }, token);

    await handleMetaWebhook(tenant.id, {
      entry: [{ changes: [{ field: 'history', value: {
        contacts: [{ wa_id: '15555550101', profile: { name: '授权验收联系人' } }],
        messages: [{ id: `e2e_inbound_${marker}`, from: '15555550101', timestamp: String(Math.floor(Date.now() / 1_000)), type: 'text', text: { body: 'I am evaluating electronics production-line equipment for distribution. Please follow up with verified product details.' } }],
      } }] }],
    });

    const config = {
      companyName: tenant.companyName,
      industry: tenant.industry,
      primaryBusiness: '电子制造生产线设备供应与海外经销商合作',
      targetMarkets: '美国',
      customerProfile: '工业设备进口商与本地经销商',
      autonomyMode: 'managed',
      approvalOwner: 'Local E2E Owner',
      primaryGoal: 'leads',
      focusProducts: '电子制造生产线设备',
      enabledWorkflows: ['scheduled_social', 'product_content', 'material_content', 'customer_segmentation', 'batch_followup'],
      socialCadence: 'YouTube；关键词：industrial laser cleaning machine、distributor；近 7 天；每天 09:00；每次最多 3 条；按链接与标题去重 30 天；每周生成 2 条内容草稿',
      followupCadence: '每周五 09:00 生成分层跟进草稿；17:00 前审批；客户当地工作日 09:00–18:00；同一客户 7 天最多 1 次',
      reviewSchedule: '周五 17:30（北京时间）',
      publishingTargets: [],
      allowGeneratedVisuals: false,
      allowRealPublishing: false,
      allowRealCustomerMessages: false,
      constraints: ['不做广告投流', '无发布账号时不发布', 'Meta 未接通时不得发送', '价格、付款和交期必须人工确认'],
      team: ['planner', 'knowledge', 'content', 'customer', 'risk', 'review'],
    };
    const afterOnboarding = await request('digital-employees/onboarding/complete', { method: 'POST', body: JSON.stringify(config) }, token);
    assert.ok(afterOnboarding.config);
    assert.equal(afterOnboarding.goal, null, 'onboarding must stop at weekly goal');

    const crawl = await request('videos/crawl', {
      method: 'POST',
      body: JSON.stringify({ platform: 'youtube', keyword: 'https://www.youtube.com/watch?v=nXNzxFuMp_Y', limit: 1 }),
    }, token);
    const crawledSources = await rows('trend_videos', tenant.id, 'tenantId');
    assert.ok(
      Number(crawl.imported || 0) > 0 && crawledSources.some(item => /^https?:\/\//i.test(String(item.sourceUrl || ''))),
      `public crawl must persist a traceable source even while video analysis is still pending: ${JSON.stringify(crawl)}`,
    );

    const start = new Date();
    const end = new Date(start.getTime() + 6 * 86_400_000);
    const afterGoal = await request('digital-employees/goals', {
      method: 'POST',
      body: JSON.stringify({
        businessLine: 'full_funnel', contentPlatforms: ['youtube'], title: '首周非 Meta 全链路验收',
        objective: '基于真实产品和自有素材完成内容生产，并为已授权验收联系人生成逐客跟进草稿',
        metric: 'approved_content_packages', baseline: 0, target: 2, unit: '项',
        startsAt: start.toISOString().slice(0, 10), endsAt: end.toISOString().slice(0, 10), scope: '美国工业设备经销商',
        constraints: ['无发布账号不发布', 'Meta 未接通不发送'],
      }),
    }, token);
    assert.equal(afterGoal.goal?.status, 'draft');
    assert.equal(afterGoal.run, null);
    let overview = await request(`digital-employees/goals/${afterGoal.goal.id}/approve`, { method: 'POST', body: '{}' }, token);
    const runId = String(overview.run?.id || '');
    assert.ok(runId, 'approved goal must create a run');

    await request(`digital-employees/runs/${runId}/customer-segments`, {
      method: 'POST', body: JSON.stringify({ name: '授权验收客户', criteria: { match: 'any', minIntentScore: 0, stages: ['inquiry', 'quoted', 'silent30', 'silent60'], excludeStages: ['won'] } }),
    }, token);
    const segments = await rows('customer_segments', tenant.id);
    const segment = segments.find(item => item.run_id === runId);
    assert.ok(segment?.id, 'customer segment must be persisted');
    await request(`digital-employees/customer-segments/${segment.id}/followup-batches`, { method: 'POST', body: JSON.stringify({ name: '授权验收逐客草稿' }) }, token);

    let contentDone = false;
    let followupApprovalId = '';
    for (let attempt = 0; attempt < 80; attempt += 1) {
      overview = await request(`digital-employees/runs/${runId}/reconcile`, { method: 'POST', body: '{}' }, token);
      const taskList = Array.isArray(overview.tasks) ? overview.tasks : [];
      contentDone = taskList.find((item: JsonRecord) => item.task_key === 'content_quality_gate')?.status === 'succeeded';
      followupApprovalId = String((overview.approvals || []).find((item: JsonRecord) => item.status === 'pending' && taskList.find((task: JsonRecord) => task.id === item.task_id)?.task_key === 'followup_batch_approval')?.id || '');
      if (contentDone && followupApprovalId) break;
      const production = taskList.find((item: JsonRecord) => item.task_key === 'content_production');
      if (/^(?:成片质检未通过|脚本事实质检未通过|素材覆盖缺口|内容订单覆盖不完整)/.test(String(production?.blocked_reason || production?.blocker || ''))) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const taskDiagnostics = (Array.isArray(overview.tasks) ? overview.tasks : []).map((item: JsonRecord) => ({
      key: item.task_key,
      status: item.status,
      blocker: item.blocked_reason || item.blocker,
      output: item.output,
      lastError: item.last_error || item.lastError,
    }));
    assert.equal(contentDone, true, `real owned inputs must produce quality-passed MP4 outputs: ${JSON.stringify(taskDiagnostics)}`);
    assert.ok(followupApprovalId, `follow-up drafts must reach human approval: ${JSON.stringify(taskDiagnostics)}`);
    const generatedProjects = (await rows('studio_projects', tenant.id)).filter(project => {
      const spec = typeof project.spec === 'string' ? JSON.parse(project.spec) : (project.spec || {});
      return spec.workflowRunId === runId && spec.automation?.stage === 'completed';
    });
    assert.equal(generatedProjects.length, 2, 'the balanced content batch must produce both planned content orders');
    assert.ok(generatedProjects.every(project => project.status === 'ready_for_approval'), 'completed works must be ready for approval, never falsely marked as published');
    const generatedSpecs = generatedProjects.map(project => typeof project.spec === 'string' ? JSON.parse(project.spec) : (project.spec || {}));
    assert.equal(new Set(generatedSpecs.map(spec => spec.automation?.route)).size, 2, 'product and material routes must remain visibly distinct');
    assert.equal(new Set(generatedSpecs.map(spec => spec.automation?.contentHash)).size, generatedSpecs.length, 'different orders must not emit duplicate scripts');
    assert.ok(generatedSpecs.every(spec => spec.evidenceSnapshot?.product?.name === '电子制造生产线设备'), 'every generated work must freeze its real product identity');
    assert.ok(generatedSpecs.every(spec => Array.isArray(spec.sceneSourcePlan) && spec.sceneSourcePlan.length >= 4), 'every generated work must retain a per-scene source plan');
    assert.doesNotMatch(JSON.stringify(generatedSpecs), /E2E-|local\.test|mock|placeholder|工业激光清洁/i, 'customer-facing content must not leak internal markers or an unrelated product');
    overview = await request(`digital-employees/approvals/${followupApprovalId}/decide`, { method: 'POST', body: JSON.stringify({ decision: 'approved', note: '仅批准草稿；Meta 未接通，不允许发送' }) }, token);

    const batches = await rows('followup_batches', tenant.id);
    const batch = batches.find(item => item.run_id === runId);
    assert.ok(batch?.id, 'follow-up batch must exist');
    const preflightResponse = await fetch(`${baseUrl}/digital-employees/followup-batches/${batch.id}/dispatch-preflight`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    const preflight = await preflightResponse.json() as JsonRecord;
    assert.equal(preflightResponse.ok, true, `dispatch preflight should return an inspectable result: ${JSON.stringify(preflight)}`);
    assert.equal(preflight.ready, false, 'Meta-unavailable dispatch must fail closed');

    overview = await request(`digital-employees/runs/${runId}/reviews/generate`, { method: 'POST', body: '{}' }, token);
    assert.ok(overview.review, 'weekly review must be generated from the run snapshot');
    const report = await buildDigitalEmployeeAcceptanceReport({
      tenantId: tenant.id,
      runId,
      waiveWhatsAppRealSend: true,
      whatsAppWaiverReason: '用户明确说明当前暂时无法连接 Meta；本轮验收到审批与发送预检为止',
    });
    assert.equal(report.overall, 'passed', JSON.stringify({ blockers: report.blockers, failures: report.failures }, null, 2));
    assert.equal(report.checks.find(item => item.key === 'whatsapp_real_send')?.status, 'waived');

    const previewRoot = artifactRoot;
    const previewPaths: string[] = [];
    if (previewRoot) {
      const projects = await rows('studio_projects', tenant.id);
      fs.mkdirSync(previewRoot, { recursive: true });
      for (const [index, project] of projects.filter(item => report.checks.find(check => check.key === 'content_output')?.evidence.projectIds instanceof Array
        && (report.checks.find(check => check.key === 'content_output')!.evidence.projectIds as string[]).includes(item.id)).entries()) {
        const spec = typeof project.spec === 'string' ? JSON.parse(project.spec) : (project.spec || {});
        const source = String(spec?.automation?.renderOutputPath || spec?.renderOutputPath || '');
        if (!source || !fs.existsSync(source)) continue;
        const route = String(spec?.automation?.route || `content-${index + 1}`).replace(/[^a-z0-9_-]+/gi, '-');
        const destination = path.join(previewRoot, `${index + 1}-${route}.mp4`);
        fs.copyFileSync(source, destination);
        previewPaths.push(destination);
      }
      assert.equal(previewPaths.length, report.counters.completedProjects, 'every completed project must be exported before cleanup');
      fs.writeFileSync(path.join(previewRoot, 'acceptance.json'), JSON.stringify({ report, previewPaths }, null, 2));
    }

    process.stdout.write(`${JSON.stringify({
      ok: true,
      tenantId: tenant.id,
      runId,
      sourceCount: report.counters.realSources,
      completedProjects: report.counters.completedProjects,
      approvedFollowups: report.counters.approvedFollowups,
      dispatchPreflight: preflight,
      report,
      previewPaths,
      qaCustomer: { kind: 'ephemeral_authorized_test_contact', realExternalSendPerformed: false },
    }, null, 2)}\n`);
  } finally {
    // Preserve failed as well as passed outputs before tenant cleanup. Without
    // this snapshot, investigating a gate failure requires another paid run.
    try {
      const projects = await rows('studio_projects', tenant.id);
      const diagnostics = projects.map(project => {
        const spec = typeof project.spec === 'string' ? JSON.parse(project.spec) : (project.spec || {});
        const source = String(spec?.automation?.renderOutputPath || spec?.renderOutputPath || '');
        const artifact = source && fs.existsSync(source) ? path.join(artifactRoot, `${project.id}.mp4`) : '';
        if (artifact) fs.copyFileSync(source, artifact);
        return { id: project.id, status: project.status, artifact, script: spec.script, duration: spec.duration,
          voiceoverDur: spec.voiceoverDur, cues: spec.alignedCuesByLang, sceneSourcePlan: spec.sceneSourcePlan, sourceSegments: spec.sourceSegments,
          automation: spec.automation };
      });
      fs.writeFileSync(path.join(artifactRoot, 'projects.json'), JSON.stringify(diagnostics, null, 2));
      process.stdout.write(`[smoke] retained diagnostics ${artifactRoot}\n`);
    } catch (error) {
      process.stderr.write(`[smoke] artifact capture failed: ${String(error)}\n`);
    }
    const cleanup = cleanupLocalE2ETenant({ root, tenantId: tenant.id, apply: true });
    if (!cleanup.verifiedClean) throw new Error(`e2e_cleanup_failed:${cleanup.remainingReferences.join(',')}`);
    if (cleanup.backupDir) fs.rmSync(cleanup.backupDir, { recursive: true, force: true });
    if (whatsappImportStatusBefore) fs.writeFileSync(whatsappImportStatusFile, whatsappImportStatusBefore);
    else fs.rmSync(whatsappImportStatusFile, { force: true });
    process.stdout.write(`${JSON.stringify({ cleanup: { tenantId: tenant.id, removedRecords: cleanup.removedRecords, movedDirectories: cleanup.movedDirectories, verifiedClean: true } }, null, 2)}\n`);
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});

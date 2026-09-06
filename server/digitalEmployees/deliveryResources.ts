import { contentAcceptanceHash, contentAccepted } from './contentAcceptance.js';
import { createHash } from 'node:crypto';
import { listSocialMetricSnapshots } from '../socialMetrics/store.js';
import { currentMetricTotal } from '../socialMetrics/aggregation.js';
import { getWhatsAppCustomers } from '../whatsapp/historyImport.js';
import fs from 'node:fs';
import path from 'node:path';
import { store } from '../storage/index.js';
import { signAssetUrl } from '../lib/assetAccess.js';
import { fallbackDelivery, safeDeliveryUrl, type DeliveryResource, type DeliveryArtifact } from '../../src/lib/delivery.js';
import type { WorkflowTask } from '../../src/lib/digitalEmployees.js';

type RecordData = { id: string; [key: string]: unknown };
export function object(value: unknown): Record<string, any> {
  if (typeof value === 'string') { try { return object(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}
const string = (value: unknown) => typeof value === 'string' ? value : '';
const success = (task: WorkflowTask) => ['succeeded', 'completed'].includes(task.status);
const contentKeys = ['content_mode_routing', 'content_production', 'content_quality_gate'];
const draftKeys = ['followup_batch_draft', 'followup_batch_approval'];
const referenceTypes: Record<string, [string, string]> = {
  studio_project: ['studio_projects', 'tenant_id'], followup_batch: ['followup_batches', 'tenant_id'],
  customer_segment: ['customer_segments', 'tenant_id'], trend_video: ['trend_videos', 'tenantId'], post: ['posts', 'tenant_id'],
};

export function projectDelivery(project: RecordData, tasks: WorkflowTask[], videoUrl: string): DeliveryResource {
  const spec = object(project.spec), automation = object(spec.automation), quality = object(automation.quality), order = object(spec.contentOrder);
  const related = tasks.filter(task => contentKeys.includes(task.task_key));
  const task = related.find(task => task.id === spec.workflowTaskId) || related.find(task => task.task_key === 'content_production')!;
  const base = fallbackDelivery(task, '');
  const stageNames: Record<string, string> = { script: '编写脚本', material_match: '匹配分镜素材', voice_subtitles: '生成配音与字幕', heygen: 'HeyGen 数字人生成与预览确认', render: '渲染成片', quality: '质量检查', completed: '成片与质检结果已就绪', blocked: '制作受阻' };
  const blocked = automation.status === 'blocked' || automation.stage === 'blocked';
  const ready = Boolean(videoUrl) && quality.passed === true && automation.stage === 'completed';
  const artifacts: DeliveryArtifact[] = [];
  if (string(spec.script)) artifacts.push({ id: 'script', label: '脚本', kind: 'text', text: spec.script, version: string(spec.scriptVersion) });
  if (safeDeliveryUrl(spec.voiceoverUrl)) artifacts.push({ id: 'voice', label: '配音试听', kind: 'audio', url: safeDeliveryUrl(spec.voiceoverUrl) });
  if (videoUrl) artifacts.push({ id: 'video', label: ready ? '成片' : '成片待检', kind: 'video', url: videoUrl });
  if (Object.keys(quality).length) artifacts.push({ id: 'quality', label: '质检结果', kind: 'text', text: `${quality.passed === true ? '质检通过' : '质检尚未通过'}\n${Array.isArray(quality.failures) ? quality.failures.join('\n') : ''}\n${string(quality.checkedAt)}`.trim() });
  const stages = ['script', 'material_match', 'voice_subtitles', 'render', 'quality'];
  const current = stages.indexOf(blocked ? automation.resumeStage : automation.stage);
  return { ...base, ...(spec.script ? { narrationEdit: { hash: contentAcceptanceHash(spec), lines: String(spec.script).split('\n').flatMap(line => { const match = line.trim().match(/^(?:台词|口播|voiceover|vo)[：:]\s*(.+)$/i); return match ? [match[1]] : []; }) } } : {}), ...(ready ? { contentApproval: { hash: contentAcceptanceHash(spec), approved: contentAccepted(spec) } } : {}), id: `studio_project:${project.id}`, taskIds: related.map(item => item.id), kind: '内容成片',
    title: order.productName && object(order.theme).label ? `${order.productName} · ${object(order.theme).label}` : string(project.title) || '内容创作项目', subject: [string(order.accountLabel), string(order.productName) || string(object(automation.routePlan).productName), string(spec.platform)].filter(Boolean).join(' · ') || '内容项目',
    acceptance: '成片可播放、可下载，且质量检查通过',
    stage: ready && !contentAccepted(spec) ? '等待人工确认成片' : stageNames[automation.stage] || '等待制作', column: ready ? contentAccepted(spec) ? 'done' : 'human' : blocked || automation.stage === 'completed' ? 'human' : automation.status === 'queued' && current <= 0 && !string(spec.script) ? 'todo' : 'active',
    reason: string(automation.blocker) || (automation.stage === 'completed' && !videoUrl ? '成片文件不可访问，请重新导出或恢复文件。' : ''),
    exception: blocked || (automation.stage === 'completed' && !videoUrl),
    updatedAt: string(project.updated_at) || string(automation.updatedAt), deliveredAt: ready ? string(automation.completedAt) || string(project.updated_at) : undefined,
    artifacts, steps: stages.map((stage, index) => ({ label: stageNames[stage], state: ready || (current >= 0 && index < current) ? 'done' : index === current ? 'active' : 'pending' })),
    link: { page: 'smartAssets', view: 'create', studioPanel: 'projects', runId: task.run_id, taskId: task.id, businessRef: { taskKey: 'content_production', entityId: project.id, resources: [{ type: 'studio_project', id: project.id }] } },
    actionLabel: ready ? '打开成片项目' : blocked ? '修正制作内容' : '进入制作页面', effect: project.status === 'published' ? '发布回执待核验' : '尚未发布', metrics: [{ label: '播放', value: null }, { label: '询盘', value: null }],
  };
}

export function draftDelivery(item: RecordData, batch: RecordData, tasks: WorkflowTask[]): DeliveryResource {
  const related = tasks.filter(task => draftKeys.includes(task.task_key));
  const task = related.find(task => task.task_key === 'followup_batch_draft')!;
  const text = string(item.draft_body), status = string(item.status);
  const sent = Boolean(item.provider_message_id) && ['sent', 'delivered', 'read'].includes(status);
  const approvalCurrent = batch.status === 'approved' && Number(batch.version) > 0
    && Number(batch.approved_version) === Number(batch.version)
    && Boolean(batch.approval_id || batch.approved_by === 'approval_policy');
  const contentCurrent = Boolean(text) && item.content_hash === createHash('sha256').update(JSON.stringify(text)).digest('hex');
  const approved = contentCurrent && (sent || (approvalCurrent && Boolean(item.approved_at) && !['draft', 'rejected', 'blocked', 'excluded'].includes(status)));
  const needsReview = Boolean(text) && !approved;
  const blocked = ['rejected', 'blocked', 'excluded'].includes(status) && !approved;
  return { ...fallbackDelivery(task, ''), id: `followup_batch_item:${item.id}`, taskIds: related.map(t => t.id), kind: '客服草稿',
    title: `跟进 ${string(item.customer_name) || '客户'} 的回复草稿`, subject: string(item.customer_name) || string(item.customer_id),
    acceptance: '逐客回复草稿可查看，并完成必要的人工审核', stage: blocked ? '草稿需要修正' : needsReview ? '草稿待审核' : text ? '草稿已审核' : '生成草稿',
    column: blocked || needsReview ? 'human' : text ? 'done' : 'active', reason: (blocked ? string(item.exclusion_reason) : '') || (needsReview ? item.approved_at && (!approvalCurrent || !contentCurrent) ? '草稿或批次版本已变化，需要重新审核。' : '请核对回复内容与承诺；审批按所属批次执行。' : ''), exception: blocked,
    updatedAt: string(item.updated_at), deliveredAt: !needsReview && text ? string(item.approved_at) || string(item.updated_at) : undefined,
    artifacts: text ? [{ id: 'draft', label: '回复草稿', kind: 'text', text, version: `v${Number(item.draft_version) || 1}` }, { id: 'basis', label: '审核依据', kind: 'text', text: `所属批次：${string(batch.name)}\n语言：${string(item.language) || '未记录'}\n风险等级：${string(item.risk_level) || '未记录'}\n${string(item.guard_rule) || '请结合客户会话核对事实与交期承诺。'}` }] : [],
    link: { page: 'conversion', runId: task.run_id, taskId: task.id, businessRef: { taskKey: task.task_key, entityId: string(item.customer_id), batchId: batch.id, itemId: item.id, resources: [{ type: 'followup_batch', id: batch.id }, { type: 'customer', id: item.customer_id }] } },
    actionLabel: '查看客户会话', effect: sent ? '已有发送回执' : '尚未发送', metrics: [{ label: '客户回复', value: null }, { label: '成交', value: null }],
    steps: [{ label: '生成草稿', state: text ? 'done' : 'active' }, { label: '审核草稿', state: needsReview || blocked ? 'active' : text ? 'done' : 'pending' }],
  };
}

async function allRecords(collection: string, where: Record<string, string>): Promise<RecordData[]> {
  const result: RecordData[] = [];
  for (let page = 1; ; page++) {
    const batch = await store.list<RecordData>(collection, { where, page, perPage: 200 });
    result.push(...batch.items);
    if (page >= batch.totalPages || batch.items.length === 0) return result;
  }
}

export async function buildDeliveryResources(tenantId: string, tasks: WorkflowTask[], goalTitle: string): Promise<DeliveryResource[]> {
  if (!tasks.length) return [];
  const cards: DeliveryResource[] = [], covered = new Set<string>();
  const refs: Array<Record<string, unknown> & { taskId: string }> = tasks.flatMap(task => (Array.isArray(task.business_refs) ? task.business_refs : []).map(ref => ({ ...ref, taskId: task.id })));
  const cache = new Map<string, Promise<RecordData | null>>();
  const get = (type: string, id: string) => {
    const key = `${type}:${id}`;
    if (!cache.has(key)) cache.set(key, (async () => {
      const mapping = referenceTypes[type]; if (!mapping) return null;
      const record = await store.getById<RecordData>(mapping[0], id);
      return record && record[mapping[1]] === tenantId ? record : null;
    })());
    return cache.get(key)!;
  };
  const add = (card: DeliveryResource) => { cards.push(card); card.taskIds.forEach(id => covered.add(id)); };
  const runProjects = (await allRecords('studio_projects', { tenant_id: tenantId })).filter(project => object(project.spec).workflowRunId === tasks[0].run_id);
  for (const project of runProjects) cache.set(`studio_project:${project.id}`, Promise.resolve(project));
  const projectIds = [...new Set([...runProjects.map(project => project.id), ...refs.filter(ref => ref.type === 'studio_project').map(ref => String(ref.id))])];
  for (const id of projectIds) {
    const project = await get('studio_project', id);
    if (!project || !tasks.some(t => t.task_key === 'content_production')) continue;
    const spec = object(project.spec), automation = object(spec.automation);
    if (spec.workflowRunId !== tasks[0].run_id) continue;
    const output = string(automation.renderOutputPath) || string(spec.renderOutputPath);
    const root = path.resolve(process.cwd(), 'data', 'publishing-uploads', tenantId.replace(/[^\w.-]+/g, '-'));
    const accessible = output && path.dirname(path.resolve(output)) === root && fs.existsSync(output) && fs.statSync(output).isFile() && path.dirname(fs.realpathSync(output)) === fs.realpathSync(root);
    const url = accessible ? signAssetUrl(`/api/overseas/publishing/local-videos/${encodeURIComponent(path.basename(output))}`, tenantId) : '';
    add(projectDelivery(project, tasks, url));
  }
  const batchIds = [...new Set(refs.filter(ref => ref.type === 'followup_batch').map(ref => String(ref.id)))];
  for (const id of batchIds) {
    const batch = await get('followup_batch', id);
    if (!batch || batch.run_id !== tasks[0].run_id || ['superseded', 'cancelled'].includes(string(batch.status)) || !tasks.some(t => t.task_key === 'followup_batch_draft')) continue;
    const items = await allRecords('followup_batch_items', { tenant_id: tenantId, batch_id: id });
    items.forEach(item => {
      const draft = draftDelivery(item, batch, tasks);
      add(draft);
      const dispatch = tasks.find(task => task.task_key === 'followup_dispatch');
      if (!dispatch) return;
      const sent = Boolean(item.provider_message_id) && ['sent', 'delivered', 'read'].includes(string(item.status));
      const failed = ['failed', 'blocked', 'excluded', 'partial_sent'].includes(string(item.status));
      const due = string(item.scheduled_at);
      const card = fallbackDelivery(dispatch, goalTitle);
      add({ ...card, id: `followup_dispatch:${item.id}`, kind: '客户发送', title: `发送给 ${string(item.customer_name) || '客户'} 的跟进消息`, subject: string(item.customer_name) || string(item.customer_id),
        acceptance: '取得这位客户的渠道发送回执', column: sent ? 'done' : failed ? 'human' : draft.column !== 'done' || Date.parse(due) > Date.now() ? 'todo' : 'active',
        stage: sent ? '发送回执已返回' : failed ? '发送受阻' : draft.column !== 'done' ? '等待草稿审核' : due ? '等待预约发送' : '等待发送条件核验',
        reason: sent ? '' : string(item.last_error) || string(item.exclusion_reason) || (due ? `预约时间：${due}` : card.reason), exception: failed,
        updatedAt: string(item.updated_at), deliveredAt: sent ? string(item.sent_at) : undefined, effect: sent ? '已有发送回执' : '尚未完整发送',
        artifacts: sent ? [{ id: 'receipt', kind: 'text', label: '发送回执', text: `客户：${string(item.customer_name)}\n发送时间：${string(item.sent_at)}\n渠道回执：${string(item.provider_message_id)}` }] : [],
        link: { ...draft.link!, taskId: dispatch.id, businessRef: { ...draft.link!.businessRef, taskKey: dispatch.task_key } }, actionLabel: '查看客户会话', metrics: [{ label: '客户回复', value: null }],
      });
    });
  }
  const contentTasks = tasks.filter(task => contentKeys.includes(task.task_key));
  const routing = contentTasks.find(task => task.task_key === 'content_mode_routing');
  const orders = object(routing?.output).orders;
  if (Array.isArray(orders)) {
    const boundOrders = new Set<string>();
    for (const id of projectIds) { const project = await get('studio_project', id); if (project) boundOrders.add(string(object(project.spec).contentOrderId)); }
    for (const order of orders.filter(entry => entry && typeof entry === 'object')) {
      if (!order.id || boundOrders.has(order.id)) continue;
      const task = contentTasks.find(item => item.task_key === 'content_production') || routing!;
      const card = fallbackDelivery(task, goalTitle);
      add({ ...card, id: `content_order:${order.id}`, taskIds: contentTasks.map(item => item.id), kind: '内容成片', title: `${string(order.productName) || '产品'} · ${string(object(order.theme).label) || '内容制作'}`, subject: [string(order.accountLabel), string(order.platform)].filter(Boolean).join(' · ') || goalTitle,
        acceptance: '成片可播放、可下载，且质量检查通过', column: task.status === 'failed' || success(task) ? 'human' : 'todo', stage: '等待创建制作项目', reason: task.blocked_reason || (success(task) ? '制作步骤已结束，但该订单没有关联项目，请核对。' : ''),
      });
    }
  }
  if (contentTasks.length && !contentTasks.some(task => covered.has(task.id))) {
    const task = contentTasks.find(item => ['failed', 'waiting_human', 'waiting_approval'].includes(item.status)) || contentTasks.find(item => !success(item)) || contentTasks[0];
    const card = fallbackDelivery(task, goalTitle);
    add({ ...card, id: `content_setup:${task.run_id}`, taskIds: contentTasks.map(item => item.id), title: `准备「${goalTitle}」的内容生产`, kind: '内容准备', acceptance: '明确产品、账号与制作订单后，为每个成片建立独立项目', artifacts: [] });
  }
  const scheduled = refs.some(ref => ref.type === 'scheduled_task') ? await allRecords('scheduled_tasks', { tenant_id: tenantId }) : [];
  for (const task of tasks) {
    if (covered.has(task.id)) continue;
    const card = fallbackDelivery(task, goalTitle);
    const taskRefs = refs.filter(ref => ref.taskId === task.id);
    for (const ref of taskRefs) {
      const type = String(ref.type), id = String(ref.id || '');
      if (type === 'scheduled_task') {
        const record = scheduled.find(item => item.id === id || item.task_id === id);
        if (!record) continue;
        card.kind = '监测任务'; card.title = string(record.name) || '社媒内容监测'; card.acceptance = '监测配置已建立，运行结果单独记录';
        card.artifacts.push({ id, kind: 'text', label: '监测配置与运行记录', text: `监测名称：${card.title}\n执行计划：${string(record.cron_label) || string(record.cronLabel) || string(record.cron_expr)}\n最近运行：${string(record.last_run) || string(record.lastRun) || '尚未运行'}\n结果：${string(record.last_result) || string(record.lastResult) || '尚未产生采集结果'}` });
        card.effect = record.enabled === false ? '监测已暂停' : '监测已建立';
        card.link = { page: 'scheduled', runId: task.run_id, taskId: task.id, businessRef: { taskKey: task.task_key, entityId: id, resources: [{ type, id }] } };
      } else if (['trend_video', 'customer_segment', 'post'].includes(type)) {
        const record = await get(type, id); if (!record) continue;
        if (type === 'trend_video') {
          const analysis = object(record.aiAnalysis);
          card.kind = '选题研究'; card.acceptance = '参考视频、入选依据与改编建议可查阅';
          const url = safeDeliveryUrl(record.url) || safeDeliveryUrl(record.videoUrl);
          if (url) card.artifacts.push({ id, label: string(record.title) || '参考视频', kind: 'link', url });
          if (Object.keys(analysis).length) card.artifacts.push({ id: `${id}:analysis`, label: '视频分析与改编依据', kind: 'text', text: JSON.stringify(analysis, null, 2) });
        } else if (type === 'customer_segment') {
          card.kind = '客户分层'; card.title = string(record.name) || task.title;
          const members = await allRecords('customer_segment_members', { tenant_id: tenantId, segment_id: id });
          card.artifacts.push({ id, kind: 'text', label: '客户分层清单', text: members.map(item => `${string(item.customer_name) || string(item.customer_id)} · ${item.membership === 'included' ? '已纳入' : '已排除'}`).join('\n') || '本次筛选没有匹配客户。' });
        } else {
          const stats = object(record.stats);
          card.kind = '内容发布'; card.acceptance = task.task_key === 'platform_publish' ? '取得平台发布回执' : '可查阅的发布计划';
          card.artifacts.push({ id, kind: 'text', label: '发布记录', text: `${string(record.content) || string(record.title)}\n状态：${string(stats.status) || '尚未确认'}\n平台回执：${string(record.platform_post_id) || '尚未返回'}` });
          card.effect = record.platform_post_id ? '已有平台发布回执' : '尚未发布';
          card.metrics = ['views', 'likes', 'comments'].map(key => ({ label: ({ views: '播放', likes: '点赞', comments: '评论' })[key]!, value: typeof stats[key] === 'number' ? stats[key] : null }));
        }
      }
    }
    const output = object(task.output);
    const fields: Record<string, string[]> = { context_readiness: ['company', 'companyName', 'industry', 'targetMarkets', 'constraints'], goal_decomposition: ['objective', 'successMetric', 'target', 'checkpoints', 'scope'], content_mode_routing: ['themes', 'routes', 'orders'], weekly_review: ['summary', 'businessSnapshot', 'dataGaps', 'recommendations'] };
    const labels: Record<string, string> = { company: '企业', companyName: '企业', industry: '行业', targetMarkets: '目标市场', constraints: '行动边界', objective: '目标', successMetric: '验收指标', target: '目标值', checkpoints: '检查点', scope: '范围', summary: '复盘结论', businessSnapshot: '经营结果', dataGaps: '待回收数据', recommendations: '后续建议', themes: '内容主题', routes: '制作路径', orders: '内容订单' };
    const details = (fields[task.task_key] || []).filter(key => output[key] !== undefined).map(key => `${labels[key]}：${typeof output[key] === 'string' ? output[key] : JSON.stringify(output[key], null, 2)}`).join('\n');
    if (details && success(task)) card.artifacts.push({ id: 'result', label: '业务结果', kind: 'text', text: details });
    if (success(task) && card.artifacts.length && (task.task_key !== 'platform_publish' || card.effect === '已有平台发布回执')) {
      card.column = 'done'; card.reason = ''; card.stage = '交付结果已就绪'; card.deliveredAt = task.updated_at;
    }
    card.actionLabel = card.column === 'done' ? '查看交付结果' : card.column === 'human' ? '处理当前问题' : '查看生产实况';
    add(card);
  }
  const referencedPostIds = [...new Set(refs.filter(ref => ref.type === 'post').map(ref => String(ref.id)))];
  const posts = (await Promise.all(referencedPostIds.map(id => get('post', id)))).filter((post): post is RecordData => Boolean(post));
  if (posts.length) {
    const snapshots = await listSocialMetricSnapshots(tenantId).catch(() => []);
    const customers = getWhatsAppCustomers(tenantId);
    for (const card of cards.filter(item => item.id.startsWith('studio_project:'))) {
      const projectId = card.id.slice('studio_project:'.length);
      const relatedPosts = posts.filter(post => object(post.stats).sourceProjectId === projectId);
      const published = relatedPosts.filter(post => Boolean(post.platform_post_id));
      if (published.length) card.effect = `已取得 ${published.length} 条平台发布回执`;
      const metrics = snapshots.filter(snapshot => published.some(post =>
        snapshot.contentId === post.platform_post_id && snapshot.platform === post.platform &&
        Array.isArray(object(post.stats).targetAccountIds) && object(post.stats).targetAccountIds.includes(snapshot.accountId)));
      const attributed = customers.filter(customer => published.some(post => customer.sourcePostId === post.id));
      card.metrics = [{ label: '播放', value: currentMetricTotal(metrics, 'views') }, { label: '询盘', value: published.length ? attributed.length : null }, { label: '成交', value: published.length ? attributed.filter(customer => customer.stage === 'won').length : null }];
    }
  }
  return cards;
}

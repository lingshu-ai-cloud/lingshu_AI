const labels = { running: '进行中', succeeded: '已完成', failed: '失败', waiting_approval: '待确认', waiting_external: '等待外部结果', waiting_review: '待验收', producing: '制作中', planned: '已计划', queued: '排队中', blocked: '受阻', pending: '待开始', idle: '空闲', completed: '已完成', handed_off: '等待人工', cancelled: '已取消', skipped: '已跳过', published: '已发布', scheduled: '已排期' };
const roles = { orchestrator: '灵小枢', customer: '客服 Agent', business: '经营 Agent', director: '编导 Agent', content: '内容 Agent', customer_service: '客服 Agent', strategy: '经营 Agent', traffic: '流量 Agent', conversion: '销售 Agent', retention: '客户 Agent' };
function day(value) { const n = Date.parse(value); return Number.isFinite(n) ? new Date(n + 8 * 3600000).toISOString().slice(0, 10) : ''; }
function time(value) { const n = Date.parse(value); if (!Number.isFinite(n)) return '时间待定'; const d = new Date(n + 8 * 3600000); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); }
function scheduleNextAction(post) { const status = String(post?.status || ''); if (['failed','partial'].includes(status)) return '查看失败原因并重试'; if (status === 'awaiting_reapproval') return '重新审核发布内容'; if (status === 'awaiting_manual_publish') return '下载发布包并回填链接'; if (['needs_attention','finalize_pending'].includes(status)) return '核对平台回执'; if (status === 'scheduled') return '确认内容与发布时间'; if (status === 'published') return '查看回执与业务结果'; return '查看当前节点'; }
function week(now = Date.now(), offset = 0) { const date = new Date(now + 8 * 3600000); const weekday = (date.getUTCDay() + 6) % 7; date.setUTCDate(date.getUTCDate() - weekday + offset * 7); const start = date.toISOString().slice(0, 10); const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(date); d.setUTCDate(d.getUTCDate() + i); return { date: d.toISOString().slice(0, 10), label: ['一', '二', '三', '四', '五', '六', '日'][i], number: d.getUTCDate() }; }); return { start, end: days[6].date, days }; }
function sortUrgency(items, now = Date.now()) { const rank = { urgent: 0, critical: 0, high: 1, medium: 2, normal: 2, low: 3 }; return [...items].sort((a, b) => { const overdue = x => Number.isFinite(Date.parse(x.dueAt)) && Date.parse(x.dueAt) < now ? 0 : 1; return overdue(a) - overdue(b) || (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2) || (Date.parse(a.dueAt) || Infinity) - (Date.parse(b.dueAt) || Infinity) || (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || String(a.id).localeCompare(String(b.id)); }); }
function swipe(dx, dy) { return Math.abs(dx) >= 85 && Math.abs(dx) > Math.abs(dy) * 1.4 ? dx > 0 ? 'process' : 'later' : ''; }
function taskView(t) { return { ...t, statusLabel: labels[t.status] || t.status || '未知', agentLabel: roles[t.agent_role] || t.agent_role || '未指定', reason: t.blocked_reason || t.description || '', date: day(t.due_at || t.output?.scheduledAt) }; }
function first(...values) { return values.find(value => value !== undefined && value !== null && value !== ''); }
function list(value) { return Array.isArray(value) ? value : []; }
function money(value) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? `¥${n.toFixed(2)}` : ''; }
function humanValue(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.map(humanValue).filter(Boolean).join('、');
  if (typeof value === 'object') return humanValue(first(value.summary, value.message, value.reason, value.title, value.label, value.value, value.status));
  return '';
}
function failedShots(task) {
  const output = task?.output || {};
  const quality = output.qualityReport || output.quality || output.quality_report || {};
  const source = first(output.failedShots, output.failed_shots, output.failedCueIds, output.failed_cue_ids, quality.failedShots, quality.failed_shots, quality.failures, output.shots, []);
  return list(source).map((shot, index) => {
    const value = typeof shot === 'object' && shot ? shot : { reason: shot };
    const state = String(first(value.state, value.status, 'failed'));
    if (source === output.shots && !['failed', 'rework', 'rejected', 'blocked'].includes(state)) return null;
    const id = String(first(value.id, value.shotId, value.shot_id, value.cueId, value.cue_id, index + 1));
    return {
      id,
      label: humanValue(first(value.title, value.label, value.name, `分镜 ${index + 1}`)),
      reason: humanValue(first(value.reason, value.message, value.detail, value.failure, '未通过质检')),
      evidence: humanValue(first(value.evidence, value.measurement, value.check, value.source)),
      previewUrl: humanValue(first(value.previewUrl, value.videoUrl, value.url)),
      estimatedCostCny: Number(first(value.estimatedCostCny, value.estimated_cost_cny, 0)) || 0,
      selected: true,
    };
  }).filter(Boolean);
}
function actionDetail(task) {
  const output = task?.output || {};
  const shots = failedShots(task);
  const estimate = Number(first(output.reworkEstimatedCostCny, output.rework_estimated_cost_cny, output.estimatedCostCny, output.estimated_cost_cny, shots.reduce((sum, shot) => sum + shot.estimatedCostCny, 0)));
  const deadline = humanValue(first(output.reworkCompletedAt, output.estimatedCompletionAt, output.estimated_completion_at));
  const publishAt = humanValue(first(output.scheduledAt, output.publishAt, output.publish_at, task?.due_at));
  const evidence = list(first(output.evidence, output.qualityEvidence, output.quality_evidence, [])).map((item, index) => ({ id: String(first(item?.id, index)), label: humanValue(item) })).filter(item => item.label);
  return {
    failedShots: shots,
    selectedShotIds: shots.map(shot => shot.id),
    evidence,
    impact: [
      estimate > 0 ? `重做预计新增 ${money(estimate)}` : '新增费用需由后端核算，提交前不会扣费',
      deadline ? `预计 ${deadline} 完成重新合成` : '完成时间将在后端受理后返回',
      publishAt ? `当前发布目标：${publishAt}` : '发布时间影响尚未核算',
    ],
    costEstimateLabel: estimate > 0 ? money(estimate) : '待后端核算',
    canSubmitShotRetry: shots.length > 0,
  };
}
function intervention(task) {
  const text = [task?.blocked_reason, task?.description, task?.capability_key, task?.output?.stage, task?.output?.interventionType].filter(Boolean).join(' ').toLowerCase();
  if (task?.status === 'handed_off' || task?.status === 'blocked') {
    const mentionsQuality = /质检|验收|分镜|quality|review/.test(text);
    const needsQualityRecovery = failedShots(task).length > 0 || /未通过|失败|异常|不合格|重做|修复耗尽|retry exhausted/.test(text);
    if (mentionsQuality && needsQualityRecovery) return 'quality_recovery';
    if (mentionsQuality && !needsQualityRecovery) return '';
    if (/预算|额度|费用|budget|quota|cost/.test(text)) return 'budget';
    if (/素材|镜头|资料|material|asset|shot/.test(text)) return 'material';
    if (/授权|账号|登录|oauth|token|credential/.test(text)) return 'authorization';
    if (task.requires_approval || task.output?.requiresUserInput || task.blocked_reason) return 'instruction';
  }
  if (task?.status === 'failed') {
    if (/授权|账号|登录|oauth|token|credential/.test(text)) return 'authorization';
    if (/预算|额度|费用|budget|quota|cost/.test(text)) return 'budget';
    if (/素材|镜头|资料|material|asset|shot/.test(text)) return 'material';
    if (/质检|验收|分镜|quality|review/.test(text)) return 'quality_recovery';
    if (task.output?.manualRecoveryRequired === true || task.output?.safeToRetry === false) return 'recovery_choice';
  }
  return '';
}
function actionRoute(item) {
  if (item.type === 'approval') return { kind: 'decision', title: '这次需要你的判断', cta: '现在决定', steps: ['查看质检证据和不合格分镜', '通过成片，或选择局部重做/提高预算', '系统保存决定并从对应节点继续'] };
  if (item.type === 'shoot') return { title: '补齐素材后继续制作', cta: '去拍摄上传', steps: ['查看缺少的镜头和拍摄要求', '拍摄或从相册上传素材', '上传成功后 Agent 自动继续制作'] };
  if (item.interventionType === 'authorization') return { kind: 'authorization', title: '恢复账号连接后继续', cta: '修复授权并重试', steps: ['查看受影响账号和排期', '完成重新授权并回到此页', '确认连接恢复，从失败节点重试'] };
  if (item.interventionType === 'budget') return { kind: 'budget', title: '决定是否追加本次预算', cta: '调整预算并继续', steps: ['查看已产生成本和缺口', '输入本次允许增加的预算上限', '仅重试未通过的生成步骤'] };
  if (item.interventionType === 'quality_recovery') return { kind: 'quality_recovery', title: '处理未通过的质检项', cta: '选择修复方式', steps: ['查看未通过的分镜和质检证据', '选择局部重做、追加预算或接受当前版本', '只从选中的分镜继续并重新合成'] };
  if (item.task?.status === 'failed') return { kind: 'recovery_choice', title: '选择安全的恢复方式', cta: '选择恢复方式', steps: ['查看失败节点和已保留成果', '选择仅重试失败步骤或重跑下游', '提交后持续显示真实执行回执'] };
  if (item.task?.status === 'handed_off' || item.task?.status === 'blocked') return { kind: 'instruction', title: '补充 Agent 无法决定的信息', cta: '补充指令并继续', steps: ['查看 Agent 缺少的决定', '在本页补充目标、选项或约束', '提交指令后从阻塞节点继续'] };
  return { title: '完成当前所需操作', cta: '查看处理路线', steps: ['查看阻塞原因', '完成页面提示的操作', '回到工作页确认结果'] };
}
function withRoute(item) { const route = actionRoute(item); return { ...item, action: route.cta, route }; }
function managerAnswer(value) {
  const replacements = { handed_off: '需要人工决定', waiting_approval: '等待确认', waiting_external: '等待外部结果', awaiting_reapproval: '等待重新审核', awaiting_manual_publish: '等待手动发布', succeeded: '已完成', failed: '未成功', blocked: '受阻', running: '进行中' };
  let text = String(value || '').replace(/```[a-zA-Z0-9_-]*\s*/g, '').replace(/```/g, '').replace(/^\s*#{1,6}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '• ').replace(/^\s*(?:next|status|task(?:_id)?|run(?:_id)?)\s*[:：]?\s*$/gim, '').replace(/\[object Object\]/g, '相关业务资料').replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '对应任务').replace(/\b(?:task|run|approval)[-_][a-z0-9_-]{6,}\b/gi, '对应任务');
  Object.keys(replacements).forEach(key => { text = text.replace(new RegExp('\\b' + key + '\\b', 'gi'), replacements[key]); });
  return text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/\n{3,}/g, '\n\n').trim() || '暂时没有足够的工作数据来回答。';
}
function assistantActions(input, matters) {
  const query = String(input || '').toLowerCase(); const available = Array.isArray(matters) ? matters : [];
  const matched = available.filter(item => { const text = [item.title,item.reason,item.interventionType,item.task?.agentLabel].filter(Boolean).join(' ').toLowerCase(); return (/质检|分镜|成片|验收/.test(query) && /质检|分镜|成片|验收|quality/.test(text)) || (/授权|账号|登录/.test(query) && /授权|账号|登录|authorization/.test(text)) || (/预算|费用|额度/.test(query) && /预算|费用|额度|budget/.test(text)); });
  const actions = (matched.length ? matched : available).slice(0,2).map(item => ({id:'matter:'+item.id,kind:'matter',matterId:item.id,label:'处理：'+item.title,hint:item.route?.cta || item.action || '查看并处理'}));
  if (/询盘|客户|跟进/.test(query)) actions.push({id:'metric:inquiries',kind:'metric',metric:'inquiries',label:'查看有效询盘',hint:'打开本周询盘明细'});
  if (/视频|发布|内容/.test(query)) actions.push({id:'metric:videos',kind:'metric',metric:'videos',label:'查看发布记录',hint:'核对视频和平台回执'});
  return actions.slice(0,3);
}
function matters(overview, shooting) { const tasks = overview.tasks || []; const approvals = (overview.approvals || []).filter(a => { if (a.status !== 'pending') return false; const task = tasks.find(t => String(t.id) === String(a.task_id)); if (!task) return true; const taskText = [task.title, task.description, task.blocked_reason, task.output?.stage].filter(Boolean).join(' '); const kind = intervention(task); if (/成片|验收|质检|分镜|quality|review/i.test(taskText) && !kind) return false; return Boolean(kind) || a.risk_level === 'high' || /发布|发送|报价|合同|费用|预算|承诺/.test(String(a.action_summary || '')); }); const approvalTaskIds = new Set(approvals.map(a => String(a.task_id))); const items = approvals.map(a => { const t = tasks.find(t => t.id === a.task_id); return withRoute({ id: 'approval:' + a.id, title: t?.title || '任务待确认', reason: a.action_summary, type: 'approval', interventionType: intervention(t) || 'decision', approval: a, task: t && taskView(t), priority: a.risk_level === 'high' ? 'high' : t?.priority, dueAt: t?.due_at || t?.output?.dueAt, createdAt: a.created_at }); }); tasks.forEach(t => { const kind = intervention(t); if (kind && !approvalTaskIds.has(String(t.id))) items.push(withRoute({ id: 'task:' + t.id, title: t.title, reason: t.blocked_reason || t.description || '需要人工处理', type: 'task', interventionType: kind, task: taskView(t), priority: t.priority, dueAt: t.due_at || t.output?.dueAt, createdAt: t.updated_at })); }); shooting.filter(t => !t.uploadedMaterialIds?.length).forEach(t => items.push(withRoute({ id: 'shoot:' + t.id, title: t.title, reason: t.shotBrief, type: 'shoot', interventionType: 'material', shootingId: t.id, priority: t.priority || 'normal', dueAt: t.dueAt, createdAt: t.createdAt }))); return sortUrgency(items); }
module.exports = { labels, roles, day, time, week, sortUrgency, swipe, taskView, intervention, scheduleNextAction, actionRoute, actionDetail, humanValue, withRoute, managerAnswer, assistantActions, matters };

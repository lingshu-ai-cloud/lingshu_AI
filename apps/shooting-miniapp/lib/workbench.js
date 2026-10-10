const labels = { running: '进行中', succeeded: '已完成', failed: '失败', waiting_approval: '待确认', waiting_external: '等待外部结果', waiting_review: '待验收', producing: '制作中', planned: '已计划', queued: '排队中', blocked: '受阻', pending: '待开始', idle: '空闲', completed: '已完成', handed_off: '等待人工', cancelled: '已取消', skipped: '已跳过', published: '已发布', scheduled: '已排期' };
const roles = { orchestrator: '灵小枢', customer: '客服 Agent', business: '经营 Agent', director: '编导 Agent', content: '内容 Agent', customer_service: '客服 Agent', strategy: '经营 Agent', traffic: '流量 Agent', conversion: '销售 Agent', retention: '客户 Agent' };
function day(value) { const n = Date.parse(value); return Number.isFinite(n) ? new Date(n + 8 * 3600000).toISOString().slice(0, 10) : ''; }
function time(value) { const n = Date.parse(value); if (!Number.isFinite(n)) return '时间待定'; const d = new Date(n + 8 * 3600000); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); }
function scheduleNextAction(post) { const status = String(post?.status || ''); if (['failed','partial'].includes(status)) return '查看失败原因并重试'; if (status === 'awaiting_reapproval') return '重新审核发布内容'; if (status === 'awaiting_manual_publish') return '下载发布包并回填链接'; if (['needs_attention','finalize_pending'].includes(status)) return '核对平台回执'; if (status === 'scheduled') return '确认内容与发布时间'; if (status === 'published') return '查看回执与业务结果'; return '查看当前节点'; }
function week(now = Date.now(), offset = 0) { const date = new Date(now + 8 * 3600000); const weekday = (date.getUTCDay() + 6) % 7; date.setUTCDate(date.getUTCDate() - weekday + offset * 7); const start = date.toISOString().slice(0, 10); const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(date); d.setUTCDate(d.getUTCDate() + i); return { date: d.toISOString().slice(0, 10), label: ['一', '二', '三', '四', '五', '六', '日'][i], number: d.getUTCDate() }; }); return { start, end: days[6].date, days }; }
function sortUrgency(items, now = Date.now()) { const rank = { urgent: 0, critical: 0, high: 1, medium: 2, normal: 2, low: 3 }; return [...items].sort((a, b) => { const overdue = x => Number.isFinite(Date.parse(x.dueAt)) && Date.parse(x.dueAt) < now ? 0 : 1; return overdue(a) - overdue(b) || (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2) || (Date.parse(a.dueAt) || Infinity) - (Date.parse(b.dueAt) || Infinity) || (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || String(a.id).localeCompare(String(b.id)); }); }
function swipe(dx, dy) { return Math.abs(dx) >= 85 && Math.abs(dx) > Math.abs(dy) * 1.4 ? dx > 0 ? 'process' : 'later' : ''; }
function taskView(t) { return { ...t, statusLabel: labels[t.status] || t.status || '未知', agentLabel: roles[t.agent_role] || t.agent_role || '未指定', reason: t.blocked_reason || t.description || '', date: day(t.due_at || t.output?.scheduledAt) }; }
function intervention(task) {
  const text = [task?.blocked_reason, task?.description, task?.capability_key, task?.output?.stage, task?.output?.interventionType].filter(Boolean).join(' ').toLowerCase();
  if (task?.status === 'handed_off' || task?.status === 'blocked') {
    if (/质检|验收|分镜|quality|review/.test(text)) return 'quality_recovery';
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
function matters(overview, shooting) { const tasks = overview.tasks || []; const approvals = (overview.approvals || []).filter(a => a.status === 'pending'); const approvalTaskIds = new Set(approvals.map(a => String(a.task_id))); const items = approvals.map(a => { const t = tasks.find(t => t.id === a.task_id); return withRoute({ id: 'approval:' + a.id, title: t?.title || '任务待确认', reason: a.action_summary, type: 'approval', interventionType: intervention(t) || 'decision', approval: a, task: t && taskView(t), priority: a.risk_level === 'high' ? 'high' : t?.priority, dueAt: t?.due_at || t?.output?.dueAt, createdAt: a.created_at }); }); tasks.forEach(t => { const kind = intervention(t); if (kind && !approvalTaskIds.has(String(t.id))) items.push(withRoute({ id: 'task:' + t.id, title: t.title, reason: t.blocked_reason || t.description || '需要人工处理', type: 'task', interventionType: kind, task: taskView(t), priority: t.priority, dueAt: t.due_at || t.output?.dueAt, createdAt: t.updated_at })); }); shooting.filter(t => !t.uploadedMaterialIds?.length).forEach(t => items.push(withRoute({ id: 'shoot:' + t.id, title: t.title, reason: t.shotBrief, type: 'shoot', interventionType: 'material', shootingId: t.id, priority: t.priority || 'normal', dueAt: t.dueAt, createdAt: t.createdAt }))); return sortUrgency(items); }
module.exports = { labels, roles, day, time, week, sortUrgency, swipe, taskView, intervention, scheduleNextAction, actionRoute, withRoute, matters };

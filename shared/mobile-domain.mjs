// Shared pure presentation rules. No browser, React or WeChat dependencies.
const labels = { running: '进行中', succeeded: '已完成', failed: '失败', waiting_approval: '待确认', waiting_external: '等待外部结果', waiting_review: '待验收', producing: '制作中', planned: '已计划', queued: '排队中', blocked: '受阻', pending: '待开始', idle: '空闲', completed: '已完成', handed_off: '等待人工', cancelled: '已取消', skipped: '已跳过', published: '已发布', scheduled: '已排期' };
const roles = { orchestrator: '灵小枢', customer: '客服 Agent', business: '经营 Agent', director: '编导 Agent', content: '内容 Agent', customer_service: '客服 Agent', strategy: '经营 Agent', traffic: '流量 Agent', conversion: '销售 Agent', retention: '客户 Agent' };
function day(value) { const n = Date.parse(value); return Number.isFinite(n) ? new Date(n + 8 * 3600000).toISOString().slice(0, 10) : ''; }
function time(value) { const n = Date.parse(value); if (!Number.isFinite(n)) return '时间待定'; const d = new Date(n + 8 * 3600000); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); }
function scheduleNextAction(post) { const status = String(post?.status || ''); if (['failed','partial'].includes(status)) return '查看失败原因并重试'; if (status === 'awaiting_reapproval') return '重新审核发布内容'; if (status === 'awaiting_manual_publish') return '下载发布包并回填链接'; if (['needs_attention','finalize_pending'].includes(status)) return '核对平台回执'; if (status === 'scheduled') return '确认内容与发布时间'; if (status === 'published') return '查看回执与业务结果'; return '查看当前节点'; }
function week(now = Date.now(), offset = 0) { const date = new Date(now + 8 * 3600000); const weekday = (date.getUTCDay() + 6) % 7; date.setUTCDate(date.getUTCDate() - weekday + offset * 7); const start = date.toISOString().slice(0, 10); const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(date); d.setUTCDate(d.getUTCDate() + i); return { date: d.toISOString().slice(0, 10), label: ['一', '二', '三', '四', '五', '六', '日'][i], number: d.getUTCDate() }; }); return { start, end: days[6].date, days }; }
function sortUrgency(items, now = Date.now()) { const rank = { urgent: 0, critical: 0, high: 1, medium: 2, normal: 2, low: 3 }; return [...items].sort((a, b) => { const overdue = x => Number.isFinite(Date.parse(x.dueAt)) && Date.parse(x.dueAt) < now ? 0 : 1; return overdue(a) - overdue(b) || (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2) || (Date.parse(a.dueAt) || Infinity) - (Date.parse(b.dueAt) || Infinity) || (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || String(a.id).localeCompare(String(b.id)); }); }
function text(value) { if (typeof value === 'string' || typeof value === 'number') return String(value); if (value && typeof value === 'object') return text(value.label || value.title || value.summary); return ''; }
function timestamp(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(5).replace('-', '/');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '';
  const date = new Date(parsed + 8 * 3600000);
  return date.toISOString().slice(5, 10).replace('-', '/') + ' ' + date.toISOString().slice(11, 16);
}
function buildAgentSchedule(schedule, agents = []) {
  const items = schedule?.availability === 'available' && Array.isArray(schedule?.items) ? schedule.items : [];
  const groups = new Map();
  agents.forEach(agent => groups.set(agent.role, {role: agent.role, label: agent.label || roles[agent.role] || agent.role, unavailable: schedule?.availability !== 'available', items: []}));
  items.forEach((item, index) => {
    const role = item.role || 'unassigned';
    if (!groups.has(role)) groups.set(role, {role, label: roles[role] || text(item.agentLabel) || (role === 'unassigned' ? '待分配 Agent' : role), items: []});
    const planned = timestamp(item.plannedAt), due = timestamp(item.dueAt), observed = timestamp(item.observedAt);
    groups.get(role).items.push({...item, id: item.taskId || item.runId || 'assignment-' + index, title: text(item.title) || '未命名任务', statusLabel: labels[item.status] || text(item.status) || '状态未提供', stageLabel: labels[item.stage] || (/^[a-z0-9_]+$/i.test(text(item.stage)) ? '当前节点待同步' : text(item.stage)) || '当前节点未提供', timeLabel: planned ? '计划 ' + planned : '计划时间未提供', dueLabel: due ? '截止 ' + due : '', observedLabel: observed ? '更新于 ' + observed : '更新时间未提供', blockedLabel: text(item.blockedReason), nextLabel: text(item.nextAction) || text(item.waitMessage) || '下一步未提供', ownerLabel:text(item.ownerName) || roles[role] || role, lastEventLabel:text(item.lastEvent?.summary), needsIntervention: Boolean(item.matterId)});
  });
  groups.forEach(group => group.items.sort((a, b) => (Date.parse(a.plannedAt) || Date.parse(a.dueAt) || Infinity) - (Date.parse(b.plannedAt) || Date.parse(b.dueAt) || Infinity) || String(a.id).localeCompare(String(b.id))));
  return [...groups.values()];
}
export { labels, roles, day, time, week, sortUrgency, scheduleNextAction, timestamp, buildAgentSchedule };

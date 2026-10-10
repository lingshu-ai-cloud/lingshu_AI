const model = require('./workbench');
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
  agents.forEach(agent => groups.set(agent.role, {role: agent.role, label: agent.label || model.roles[agent.role] || agent.role, unavailable: schedule?.availability !== 'available', items: []}));
  items.forEach((item, index) => {
    const role = item.role || 'unassigned';
    if (!groups.has(role)) groups.set(role, {role, label: model.roles[role] || text(item.agentLabel) || (role === 'unassigned' ? '待分配 Agent' : role), items: []});
    const planned = timestamp(item.plannedAt), due = timestamp(item.dueAt), observed = timestamp(item.observedAt);
    groups.get(role).items.push({...item, id: item.taskId || item.runId || 'assignment-' + index, title: text(item.title) || '未命名任务', statusLabel: model.labels[item.status] || text(item.status) || '状态未提供', stageLabel: model.labels[item.stage] || (/^[a-z0-9_]+$/i.test(text(item.stage)) ? '当前节点待同步' : text(item.stage)) || '当前节点未提供', timeLabel: planned ? '计划 ' + planned : '计划时间未提供', dueLabel: due ? '截止 ' + due : '', observedLabel: observed ? '更新于 ' + observed : '更新时间未提供', blockedLabel: text(item.blockedReason), nextLabel: text(item.nextAction) || text(item.waitMessage) || '下一步未提供', ownerLabel:text(item.ownerName) || model.roles[role] || role, lastEventLabel:text(item.lastEvent?.summary), needsIntervention: Boolean(item.matterId)});
  });
  groups.forEach(group => group.items.sort((a, b) => (Date.parse(a.plannedAt) || Date.parse(a.dueAt) || Infinity) - (Date.parse(b.plannedAt) || Date.parse(b.dueAt) || Infinity) || String(a.id).localeCompare(String(b.id))));
  return [...groups.values()];
}
function project(schedule, agents = [], matters = []) {
  const agentScheduleGroups = buildAgentSchedule(schedule, agents);
  const agentScheduleItems = agentScheduleGroups.reduce((all, group) => all.concat(group.items), []);
  agentScheduleItems.forEach(item => {
    const matter = matters.find(m => (item.matterId && (m.matterId || m.id) === item.matterId) || (item.taskId && (m.source?.entityId || m.task?.id || m.taskId) === item.taskId));
    item.matterId = matter ? (matter.matterId || matter.id) : item.matterId;
    item.needsIntervention = Boolean(matter);
  });
  return {agentScheduleGroups, agentScheduleItems};
}
module.exports = {buildAgentSchedule, project, timestamp};

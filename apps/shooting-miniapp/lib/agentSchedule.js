const { buildAgentSchedule, timestamp } = require('./generated/mobile-domain');
function project(schedule, agents = [], matters = []) {
  const agentScheduleGroups = [];
  buildAgentSchedule(schedule, agents).forEach(group => {
    const role = group.role === 'orchestrator' ? 'business' : group.role;
    const existing = agentScheduleGroups.find(item => item.role === role);
    if (existing) {
      existing.items = existing.items.concat(group.items || []);
      existing.unavailable = existing.unavailable && group.unavailable;
      return;
    }
    agentScheduleGroups.push({ ...group, role, label: role === 'business' ? '经营 Agent' : group.label, items: (group.items || []).slice() });
  });
  const agentScheduleItems = agentScheduleGroups.reduce((all, group) => all.concat(group.items), []);
  agentScheduleItems.forEach(item => {
    const matter = matters.find(m => (item.matterId && (m.matterId || m.id) === item.matterId) || (item.taskId && (m.source?.entityId || m.task?.id || m.taskId) === item.taskId));
    item.matterId = matter ? (matter.matterId || matter.id) : item.matterId;
    item.needsIntervention = Boolean(matter);
  });
  return {agentScheduleGroups, agentScheduleItems};
}
module.exports = {buildAgentSchedule, project, timestamp};

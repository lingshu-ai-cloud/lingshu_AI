const { buildAgentSchedule, timestamp } = require('./generated/mobile-domain');
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

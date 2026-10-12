const workbench = require('./workbench')
const agentSchedule = require('./agentSchedule')

function organization(profile = {}, overview = {}) {
  const user = profile.user || {}
  const workspace = overview.workspace || {}
  return workspace.name || workspace.title || user.organizationName || user.tenantName || '灵枢工作台'
}

function project(profile = {}, overview = {}, queue = {}, selectedDay = '') {
  const shooting = Array.isArray(queue.shooting) ? queue.shooting : []
  const queueMatters = Array.isArray(queue.matters) ? queue.matters : []
  const matters = queueMatters.length
    ? workbench.sortUrgency(queueMatters.map(item => ({ ...item, type: item.type || 'command' })))
    : workbench.matters(queue || {}, shooting)
  const agents = (overview.agents?.items || []).map(agent => ({
    ...agent,
    label: workbench.roles[agent.role] || agent.role,
    currentTask: agent.currentTask?.title || ''
  }))
  const schedule = agentSchedule.project(overview.agentSchedule, agents, matters)
  const blockers = schedule.agentScheduleItems
    .filter(item => item.needsIntervention)
    .filter(item => !selectedDay || !item.plannedAt || String(item.plannedAt).startsWith(selectedDay) || String(item.dueAt || '').startsWith(selectedDay))
    .map(item => ({
      id: item.taskId || item.matterId,
      matterId: item.matterId,
      title: item.title || '待处理任务',
      date: String(item.plannedAt || item.dueAt || '').slice(0, 10),
      agent: item.ownerLabel || item.agentLabel || item.roleLabel || workbench.roles[item.role] || item.role || '数字员工',
      blocker: item.blockedLabel || item.blockedReason || item.reason || item.stageLabel || item.stage || '需要人工介入',
      time: item.timeLabel || (item.dueAt ? workbench.time(item.dueAt) : '时间待定'),
      next: item.nextLabel || item.nextAction || '查看并处理'
    }))
  const pendingShots = shooting.filter(item => !(item.uploadedMaterialIds || []).length)
  const pendingConfirmations = matters.filter(item => item.type === 'approval' || /confirm|approval|decision|确认|审核/.test(String(item.interventionType || item.type || item.reason || '')))
  return {
    organization: organization(profile, overview),
    counts: {
      pending: matters.length,
      shooting: pendingShots.length,
      confirmation: pendingConfirmations.length
    },
    blockers,
    matters,
    pendingShots,
    scheduleAvailable: overview.agentSchedule?.availability !== 'unavailable'
  }
}

module.exports = { organization, project }

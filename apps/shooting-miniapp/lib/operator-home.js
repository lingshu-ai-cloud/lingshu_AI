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
  const taskItems = Array.isArray(overview.taskDrilldown?.items) ? overview.taskDrilldown.items : []
  const contentItems = Array.isArray(overview.contentSchedule?.items) ? overview.contentSchedule.items : []
  const plannedFilms = overview.contentSchedule?.availability === 'unavailable' ? '—' : contentItems.length
  const acceptanceTasks = taskItems.filter(item => /waiting_review|handed_off|待验收|验收|review/i.test([item.status, item.title, item.stage].filter(Boolean).join(' ')))
  const acceptanceApprovals = (Array.isArray(queue.approvals) ? queue.approvals : []).filter(item => /成片|验收|review|film|video/i.test([item.title, item.action_summary, item.reason].filter(Boolean).join(' ')))
  const deliveryItems = Array.isArray(overview.deliveries) ? overview.deliveries : null
  const exportedPendingAcceptance = deliveryItems && deliveryItems.filter(item => item && item.kind === '内容成片'
    && Array.isArray(item.artifacts) && item.artifacts.some(artifact => artifact && artifact.kind === 'video' && artifact.url)
    && item.contentApproval?.approved !== true)
  const pendingAcceptance = exportedPendingAcceptance
    ? exportedPendingAcceptance.length
    : new Set([...acceptanceTasks.map(item => String(item.id)), ...acceptanceApprovals.map(item => String(item.task_id || item.id))]).size
  const todayShots = pendingShots.filter(item => {
    const date = String(item.dueAt || item.plannedAt || item.scheduledAt || item.createdAt || '').slice(0, 10)
    return !selectedDay || !date || date === selectedDay
  }).map(item => ({
    ...item,
    date: String(item.dueAt || item.plannedAt || item.scheduledAt || item.createdAt || '').slice(0, 10),
    title: item.title || '待拍镜头',
    requirement: item.shotBrief || item.requirements || item.description || '按分镜要求完成拍摄',
    durationText: item.durationText || (item.duration ? `${item.duration} 秒` : '时长不限'),
    ratioText: item.ratio || '9:16', soundText: item.soundText || item.soundMode || '按任务要求'
  }))
  return {
    organization: organization(profile, overview),
    counts: {
      pending: matters.length,
      shooting: pendingShots.length,
      confirmation: pendingConfirmations.length,
      plannedFilms, pendingAcceptance, pendingShots: pendingShots.length
    },
    blockers,
    matters,
    pendingShots,
    todayShots,
    scheduleAvailable: overview.agentSchedule?.availability !== 'unavailable'
  }
}

module.exports = { organization, project }

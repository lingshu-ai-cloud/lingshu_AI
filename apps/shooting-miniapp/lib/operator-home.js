const workbench = require('./workbench')
const agentSchedule = require('./agentSchedule')

function organization(profile = {}, overview = {}) {
  const user = profile.user || {}
  const workspace = overview.workspace || {}
  return workspace.name || workspace.title || user.organizationName || user.tenantName || '灵枢工作台'
}

function platformLabel(value) {
  return ({ tiktok:'TikTok', instagram:'Instagram', youtube:'YouTube', facebook:'Facebook', x:'X' })[String(value || '').toLowerCase()] || String(value || '平台待同步')
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
  const producedFilms = overview.contentSchedule?.availability === 'unavailable' ? '—' : contentItems.filter(item =>
    /succeeded|completed|produced|published|delivered|approved/i.test(String(item.status || item.stage || ''))
    || Boolean(item.completedAt || item.producedAt || item.publishedAt)
  ).length
  const pendingProduction = plannedFilms === '—' ? '—' : Math.max(0, plannedFilms - producedFilms)
  const acceptanceTasks = taskItems.filter(item => /waiting_review|handed_off|待验收|验收|review/i.test([item.status, item.title, item.stage].filter(Boolean).join(' ')))
  const acceptanceApprovals = (Array.isArray(queue.approvals) ? queue.approvals : []).filter(item => /成片|验收|review|film|video/i.test([item.title, item.action_summary, item.reason].filter(Boolean).join(' ')))
  const databaseFilms = Array.isArray(queue.films) ? queue.films : null
  const deliveryItems = databaseFilms ? databaseFilms.map(item => ({
    id: item.id, kind: '内容成片', title: item.title, subject: item.subject, deliveredAt: item.deliveredAt,
    artifacts: item.videoUrl ? [{ kind: 'video', url: item.videoUrl }] : [], contentApproval: { approved: item.approved === true },
    thumbnailUrl: item.thumbnailUrl || ''
  })) : Array.isArray(overview.deliveries) ? overview.deliveries : null
  const exportedPendingAcceptance = deliveryItems && deliveryItems.filter(item => item && item.kind === '内容成片'
    && Array.isArray(item.artifacts) && item.artifacts.some(artifact => artifact && artifact.kind === 'video' && artifact.url)
    && item.contentApproval?.approved !== true)
  const pendingFilmItems = exportedPendingAcceptance || []
  const pendingAcceptanceIds = new Set([
    ...pendingFilmItems.map(item => String(item.id)),
    ...acceptanceTasks.map(item => String(item.id)),
    ...acceptanceApprovals.map(item => String(item.task_id || item.id))
  ])
  const pendingAcceptance = pendingAcceptanceIds.size
  const acceptedFilms = deliveryItems
    ? deliveryItems.filter(item => item && item.kind === '内容成片'
      && Array.isArray(item.artifacts) && item.artifacts.some(artifact => artifact && artifact.kind === 'video' && artifact.url)
      && item.contentApproval?.approved === true).length
    : taskItems.filter(item => /成片|验收|review|film|video/i.test([item.title, item.stage].filter(Boolean).join(' '))
      && /succeeded|completed|approved|accepted/i.test(String(item.status || ''))).length
  const completedShots = shooting.length - pendingShots.length
  const filmAcceptanceItems = (deliveryItems || []).filter(item => item && item.kind === '内容成片'
    && Array.isArray(item.artifacts) && item.artifacts.some(artifact => artifact && artifact.kind === 'video' && artifact.url)
    && item.contentApproval?.approved !== true).map(item => {
      const video = item.artifacts.find(artifact => artifact && artifact.kind === 'video' && artifact.url)
      return { id: String(item.id || video.id || ''), title: String(item.title || '未命名成片'), subject: String(item.subject || '内容成片'), videoUrl: String(video.url || ''), thumbnailUrl: String(item.thumbnailUrl || ''), deliveredAt: String(item.deliveredAt || item.updatedAt || '') }
    })
  const queueTasks = Array.isArray(queue.tasks) ? queue.tasks : []
  const acceptanceItems = [...filmAcceptanceItems]
  acceptanceApprovals.forEach(approval => {
    const taskId = String(approval.task_id || '')
    if (acceptanceItems.some(item => String(item.id) === taskId || String(item.id) === String(approval.id))) return
    const task = queueTasks.find(item => String(item.id) === taskId)
    acceptanceItems.push({
      id: String(approval.id || taskId), title: String(task?.title || approval.title || '待验收成片'),
      subject: String(approval.action_summary || approval.reason || '请预览成片并确认验收结果'),
      videoUrl: String(approval.videoUrl || ''), thumbnailUrl: String(approval.thumbnailUrl || ''), mock: approval.mock === true,
      deliveredAt: String(approval.created_at || task?.updated_at || '')
    })
  })
  const todayAcceptance = acceptanceItems.filter(item => {
    const date = String(item.deliveredAt || '').slice(0, 10)
    return !selectedDay || !date || date <= selectedDay
  })
  const publishedVideos = contentItems.filter(item => item && item.publishReceipt === 'verified').map(item => ({
    id: String(item.id || ''), title: String(item.title || '未命名视频'), platform: platformLabel(item.platform),
    thumbnailUrl: String(item.thumbnailUrl || ''),
    views: item.views !== null && item.views !== undefined && item.views !== '' && Number.isFinite(Number(item.views)) ? Number(item.views) : null,
    mock: item.mock === true,
  }))
  const todayShots = pendingShots.filter(item => {
    const date = String(item.dueAt || item.plannedAt || item.scheduledAt || item.createdAt || '').slice(0, 10)
    return !selectedDay || !date || date <= selectedDay
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
      plannedFilms, pendingProduction, producedFilms,
      pendingAcceptance, acceptedFilms,
      pendingShots: pendingShots.length, completedShots
    },
    blockers,
    matters,
    pendingShots,
    todayShots,
    acceptanceItems,
    todayAcceptance,
    films: deliveryItems || [],
    publishedVideos,
    scheduleAvailable: overview.agentSchedule?.availability !== 'unavailable'
  }
}

module.exports = { organization, project }

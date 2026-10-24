function metricValue(entry) {
  return entry?.availability === 'available' && typeof entry.value === 'number' ? String(entry.value) : '—'
}

function shanghaiDay(now = Date.now()) {
  return new Date(Number(now) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function dailyStorageKey(scope) {
  return `lingxiaoshu:daily-open:${String(scope || 'anonymous')}`
}

function welcomeStorageKey(scope, sessionId) {
  return `lingxiaoshu:welcome:${String(scope || 'anonymous')}:${String(sessionId || '')}`
}

function noticeId(item) {
  return String(item.matterId || item.id || item.source?.entityId || '')
}

function unique(items) {
  const seen = new Set()
  return items.filter(item => {
    const id = noticeId(item)
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function projectNotices(overview = {}, queue = {}, now = Date.now()) {
  const metrics = overview.metrics || {}
  const report = [
    `本周任务 ${metricValue(metrics.tasks)}`,
    `已完成 ${metricValue(metrics.completed)}`,
    `已发布视频 ${metricValue(metrics.publishedVideos)}`,
    `有效询盘 ${metricValue(metrics.qualifiedInquiries)}`,
  ].join(' · ')
  const highlighted = Array.isArray(queue.urgentMatters) ? queue.urgentMatters : []
  const highlightedIds = new Set(highlighted.map(noticeId))
  const matters = unique([
    ...highlighted,
    ...(Array.isArray(queue.matters) ? queue.matters : []),
    ...(Array.isArray(queue.approvals) ? queue.approvals.map(item => ({ ...item, type: 'approval' })) : []),
  ])
  const approvals = matters.filter(item => item.type === 'approval' || /approval|decision|确认|审批|验收/i.test([item.type, item.interventionType, item.title, item.reason].filter(Boolean).join(' ')))
  const approvalIds = new Set(approvals.map(noticeId))
  const urgent = matters.filter(item => {
    if (approvalIds.has(noticeId(item))) return false
    const signal = [item.priority, item.severity, item.status, item.reason].filter(Boolean).join(' ')
    const due = Date.parse(item.dueAt || item.due_at || '')
    return highlightedIds.has(noticeId(item)) || /urgent|high|critical|紧急|阻塞|失败/i.test(signal) || (Number.isFinite(due) && due <= Number(now))
  })
  return [
    { id: `daily-${shanghaiDay(now)}`, type: 'daily', label: '今日工作日报', title: overview.workspace?.name || '灵枢工作台', summary: report, timeLabel: '今日首次打开自动送达' },
    ...urgent.map(item => ({ id: `urgent-${noticeId(item)}`, targetId: noticeId(item), type: 'urgent', label: '紧急任务', title: item.title || item.starterItem?.title || '有任务需要立即处理', summary: item.reason || item.subtitle || '请查看任务卡点与下一步', timeLabel: item.timeLabel || '待处理' })),
    ...approvals.map(item => ({ id: `approval-${noticeId(item)}`, targetId: noticeId(item), type: 'approval', label: '任务审批', title: item.title || item.starterItem?.title || '有结果等待审批', summary: item.reason || item.action_summary || item.subtitle || '请核对证据后确认或退回', timeLabel: item.timeLabel || '等待你的决定' })),
  ]
}

function projectBriefing(overview = {}, queue = {}, now = Date.now()) {
  const notices = projectNotices(overview, queue, now)
  const matters = notices.slice(1)
  const urgentCount = matters.filter(item => item.type === 'urgent').length
  const approvalCount = matters.filter(item => item.type === 'approval').length
  const metrics = overview.metrics || {}
  const report = [
    ['本周任务', metrics.tasks], ['已完成', metrics.completed],
    ['已发布视频', metrics.publishedVideos], ['有效询盘', metrics.qualifiedInquiries],
  ].filter(([, item]) => item?.availability === 'available' && typeof item.value === 'number')
    .slice(0, 2).map(([label, item]) => `${label} ${item.value}`).join(' · ')
  return {
    report,
    primary: matters[0] || null,
    total: matters.length,
    remaining: Math.max(0, matters.length - 1),
    summary: [urgentCount ? `${urgentCount} 项紧急任务` : '', approvalCount ? `${approvalCount} 项待审批` : ''].filter(Boolean).join(' · '),
  }
}

function projectContentSupplement(currentContentTask) {
  const card = currentContentTask?.availability === 'available' ? currentContentTask.card : null
  if (!card || card.readState === 'unavailable' || card.overallState !== 'needs_input' || card.nextAction !== 'supply_input' || !card.contentTaskId) return null
  const missing = Array.isArray(card.blockingItems) ? card.blockingItems.filter(item => item?.value) : []
  if (!missing.length) return null
  return {
    taskId: card.contentTaskId,
    title: card.title || '当前内容任务',
    required: missing.slice(0, 2),
    remaining: Math.max(0, missing.length - 2),
    known: (Array.isArray(card.knownItems) ? card.knownItems : []).filter(item => item?.value).slice(0, 2),
  }
}

module.exports = { dailyStorageKey, welcomeStorageKey, projectNotices, projectBriefing, projectContentSupplement, shanghaiDay }

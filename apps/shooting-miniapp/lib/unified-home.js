function metric(key, label, value, compared, comparedLabel, tone) {
  return { key, label, value: value ?? '—', compared: compared ?? '—', comparedLabel, tone, active: Number(value) > 0 }
}

function unique(items, keyOf) {
  const seen = new Set()
  return (items || []).filter(item => {
    const key = String(keyOf(item) || '')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function project(operator = {}, customer = {}) {
  const operatorCounts = operator.counts || {}
  const customerCounts = customer.counts || {}
  const metrics = [
    metric('production', '待生产内容', operatorCounts.pendingProduction, operatorCounts.producedFilms, '已完成', 'blue'),
    metric('acceptance', '待验收成片', operatorCounts.pendingAcceptance, operatorCounts.acceptedFilms, '已通过', 'violet'),
    metric('shooting', '待拍镜头', operatorCounts.pendingShots, operatorCounts.completedShots, '已完成', 'amber'),
    metric('reply', '待回复询盘', customerCounts.pendingReply, customerCounts.replied, '已回复', 'blue'),
    metric('followup', '待跟进客户', customerCounts.pendingFollowup, customerCounts.followedUp, '已跟进', 'violet'),
    metric('intent', '高意向客户', customerCounts.highIntent, customerCounts.converted, '已转化', 'green'),
  ]
  const urgentMatters = unique([
    ...(operator.matters || []).map(item => ({
      ...item,
      id: item.matterId || item.id,
      title: item.title || item.starterItem?.title || '待处理任务',
      summary: item.reason || item.subtitle || item.description || '需要你确认下一步',
      kindLabel: item.type === 'approval' ? '待审批' : '紧急任务',
    })),
    ...(operator.blockers || []).map(item => ({ ...item, id: item.matterId || item.id, summary: item.blocker, kindLabel: '任务卡点' })),
  ], item => item.id)
  const customerTodos = unique([
    ...(customer.pendingReply || []).map(item => ({ ...item, todoType: '待回复' })),
    ...(customer.pendingFollowup || []).map(item => ({ ...item, todoType: '待跟进' })),
    ...(customer.highIntent || []).map(item => ({ ...item, todoType: '高意向' })),
  ], item => item.id)
  const metricGroups = [
    { key: 'production', title: '内容生产', metrics: metrics.slice(0, 3) },
    { key: 'customer', title: '客户经营', metrics: metrics.slice(3) }
  ]
  const customerUnreadCount = (customer.customers || []).filter(item => item.unread).length
  return { metrics, metricGroups, urgentMatters, customerTodos, customerUnreadCount }
}

function dailyPlan(view = {}, selectedDay = '', currentDay = '') {
  const acceptance = view.todayAcceptance || []
  const acceptanceIds = new Set(acceptance.map(item => String(item.id)))
  const matters = (view.urgentMatters || []).filter(item => {
    if (item.type === 'shoot' || item.shootingId || String(item.id || '').startsWith('shoot:')) return false
    const dueDay = String(item.dueAt || '').slice(0, 10)
    const id = String(item.id || '').replace(/^approval:/, '')
    return (!selectedDay || !dueDay || dueDay <= selectedDay) && !acceptanceIds.has(id)
  })
  const shots = view.todayShots || []
  const customers = view.customerTodos || []
  const customerCounts = view.counts || {}
  const dayWord = selectedDay && selectedDay === currentDay ? '今天' : '当日'
  const groups = [
    { key: 'shooting', count: shots.length, title: `${dayWord}需要拍摄 ${shots.length} 条`, note: '查看镜头要求和拍摄参考', action: '去拍摄', tone: 'shooting' },
    { key: 'matters', count: matters.length, title: `${matters.length} 项任务与审批待处理`, note: '按优先级查看并处理', action: '查看事项', tone: 'matters' },
    {
      key: 'customers', count: customers.length, title: '客户消息',
      note: `待回复 ${customerCounts.pendingReply || 0} · 待跟进 ${customerCounts.pendingFollowup || 0} · 高意向 ${customerCounts.highIntent || 0}`,
      action: '进入会话', tone: 'customers', badge: Number(view.customerUnreadCount) || 0, alwaysVisible: true
    },
    { key: 'acceptance', count: acceptance.length, title: `${acceptance.length} 条成片待验收`, note: '核对成片和质检依据', action: '查看成片', tone: 'acceptance' }
  ].filter(group => group.count > 0 || group.alwaysVisible)
  return { groups, matters, total: groups.reduce((sum, group) => sum + group.count, 0) }
}

module.exports = { project, dailyPlan }

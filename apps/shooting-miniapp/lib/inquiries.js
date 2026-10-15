function text(value) { return String(value == null ? '' : value).trim() }
function timestamp(value) { const n = Number(value); if (Number.isFinite(n) && n > 0) return n; const parsed = Date.parse(text(value)); return Number.isFinite(parsed) ? parsed : 0 }
function lastMessage(customer) {
  const timeline = Array.isArray(customer.timeline) ? customer.timeline : []
  return [...timeline].sort((a, b) => timestamp(b.timestamp || b.createdAt) - timestamp(a.timestamp || a.createdAt))[0] || null
}
function statusOf(customer) { return customer.handlingMode === 'ai_draft' || text(customer.pendingDraft) ? 'confirm' : 'followup' }
function normalizeCustomer(customer) {
  const latest = lastMessage(customer) || {}
  const activeAt = timestamp(customer.lastActiveAt || latest.timestamp || customer.updatedAt)
  const source = text(customer.source).toLowerCase()
  const channel = source.includes('instagram') || text(customer.id).startsWith('instagram_') ? 'Instagram' : 'Messenger'
  const name = text(customer.name || customer.whatsappProfileName || customer.username || customer.messengerUserId || customer.instagramUserId) || '新询盘客户'
  return {
    id: text(customer.id), name, initial: name.slice(0, 1).toUpperCase(), channel,
    status: statusOf(customer), statusLabel: statusOf(customer) === 'confirm' ? '待确认' : '待跟进',
    country: text(customer.country || customer.countryName || customer.region), language: text(customer.language),
    stage: text(customer.stage), tags: Array.isArray(customer.tags) ? customer.tags.map(text).filter(Boolean) : [],
    unread: Boolean(customer.hasUnread || customer.unreadCount), unreadCount: Number(customer.unreadCount || (customer.hasUnread ? 1 : 0)),
    activeAt, timeLabel: formatRelative(activeAt), preview: text(latest.body || customer.lastMessage || customer.pendingDraft) || '暂无消息内容',
    pendingDraft: text(customer.pendingDraft), timeline: Array.isArray(customer.timeline) ? customer.timeline : [], raw: customer
  }
}
function formatRelative(value, now = Date.now()) { if (!value) return ''; const gap = Math.max(0, now - value); if (gap < 60000) return '刚刚'; if (gap < 3600000) return Math.floor(gap / 60000) + '分钟前'; if (gap < 86400000) return Math.floor(gap / 3600000) + '小时前'; const d = new Date(value); return `${d.getMonth() + 1}/${d.getDate()}` }
function filterInquiries(items, filters) {
  const query = text(filters.query).toLowerCase()
  return items.filter(item => (!filters.status || item.status === filters.status)
    && (!filters.unreadOnly || item.unread)
    && (!filters.channel || item.channel === filters.channel)
    && (!query || [item.name, item.preview, item.country, item.language, item.stage, ...item.tags].join(' ').toLowerCase().includes(query)))
    .sort((a, b) => Number(b.unread) - Number(a.unread) || b.activeAt - a.activeAt)
}
function messagesOf(customer) {
  return (Array.isArray(customer.timeline) ? customer.timeline : []).map((item, index) => ({
    id: text(item.id) || 'message-' + index,
    body: text(item.body || item.text || item.content),
    mine: ['seller', 'agent', 'out', 'outbound', 'msg_out', 'msg_out_human'].includes(text(item.actor || item.direction || item.type).toLowerCase()),
    time: formatRelative(timestamp(item.timestamp || item.createdAt)), timestamp: timestamp(item.timestamp || item.createdAt)
  })).filter(item => item.body).sort((a, b) => a.timestamp - b.timestamp)
}
module.exports = { normalizeCustomer, filterInquiries, messagesOf, statusOf, formatRelative }

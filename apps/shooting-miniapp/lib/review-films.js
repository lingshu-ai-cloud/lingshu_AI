function text(value) { return typeof value === 'string' ? value.trim() : '' }

function projectFinishedFilms(overview, resolveUrl = value => value) {
  const deliveries = Array.isArray(overview && overview.deliveries) ? overview.deliveries : []
  return deliveries.flatMap(delivery => {
    if (!delivery || delivery.kind !== '内容成片') return []
    const artifacts = Array.isArray(delivery.artifacts) ? delivery.artifacts : []
    const video = artifacts.find(item => item && item.kind === 'video' && text(item.url))
    if (!video) return []
    const approved = delivery.contentApproval && delivery.contentApproval.approved === true
    const pending = !approved
    const timestamp = text(delivery.deliveredAt) || text(delivery.updatedAt)
    return [{
      id: text(delivery.id) || text(video.id),
      title: text(delivery.title) || '未命名成片',
      subject: text(delivery.subject) || '内容成片',
      videoUrl: resolveUrl(video.url),
      status: pending ? 'pending' : 'approved',
      statusLabel: pending ? '待验收' : '已验收',
      deliveredAt: timestamp,
      deliveredLabel: timestamp ? timestamp.slice(0, 16).replace('T', ' ') : '导出时间待同步',
      effect: text(delivery.effect),
    }]
  }).sort((left, right) => String(right.deliveredAt).localeCompare(String(left.deliveredAt)))
}

module.exports = { projectFinishedFilms }

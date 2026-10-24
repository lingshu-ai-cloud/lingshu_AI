const artifactStates = {
  draft: '草稿', review_required: '待验收', approved: '已采纳',
  changes_requested: '已要求修改', superseded: '已被新版本替代'
}

function stableHash(value) {
  let hash = 2166136261
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function operationKey(action, taskId, objectId, version, note = '') {
  return `miniapp:${action}:${stableHash([taskId, objectId, version, note].join('|'))}`
}

function artifactMediaPath(taskId, artifactId) {
  return `starter-198/social-content/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/media`
}

function artifactDecisionPath(taskId, artifactId) {
  return `starter-198/social-content/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/decision`
}

function deliveryPackagePath(taskId) {
  return `starter-198/social-content/tasks/${encodeURIComponent(taskId)}/delivery-packages`
}

function present(card) {
  const states = { needs_input:'待我处理', needs_approval:'待我验收', processing:'生产处理中', paused:'已暂停', failed:'需要处理', completed:'已完成', cancelled:'已取消' }
  const progress = card.progress && card.progress.mode === 'units' ? `${card.progress.completed} / ${card.progress.total}` : '总量尚未核实'
  const cost = card.cost
  const costLabel = !cost ? '暂无可核实费用' : cost.status === 'unknown' ? '费用暂时无法核实'
    : cost.actualCny !== null && cost.actualCny !== undefined ? `已结算 ¥${Number(cost.actualCny).toFixed(2)}`
      : cost.upperBoundCny !== null && cost.upperBoundCny !== undefined ? `上限 ¥${Number(cost.upperBoundCny).toFixed(2)}，待结算`
        : cost.expectedCny !== null && cost.expectedCny !== undefined ? `预计 ¥${Number(cost.expectedCny).toFixed(2)}，待结算`
          : cost.status === 'free' ? '费用 ¥0.00' : '暂无可核实费用'
  const artifacts = (card.artifacts || []).map(item => ({ ...item,
    statusLabel: artifactStates[item.status] || '状态待核实',
    reviewable: item.status === 'review_required', approved: item.status === 'approved',
    previewType: /video|reel|short|视频/i.test(item.kind) ? 'video' : 'image'
  }))
  const currentArtifact = artifacts.find(item => item.reviewable && item.previewAvailable)
    || artifacts.find(item => item.approved && item.previewAvailable)
    || artifacts.find(item => item.status !== 'superseded' && item.previewAvailable) || null
  const deliveryReceipts = card.deliveryReceipts || []
  const readyReceipt = deliveryReceipts.filter(item => ['ready', 'confirmed'].includes(item.status) && item.downloadHref)
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0] || null
  const approvedArtifactIds = artifacts.filter(item => item.approved).map(item => item.artifactId)
  return { ...card, stateLabel:states[card.overallState] || '状态待核实', progressLabel:progress, costLabel,
    knownItems:[...(card.knownItems || []), ...(card.defaultedItems || []).map(item => ({...item,label:`默认 · ${item.label}`}))],
    artifacts, deliveryReceipts, currentArtifact, readyReceipt, approvedArtifactIds,
    canPackage: approvedArtifactIds.length > 0 && !readyReceipt }
}

module.exports = { artifactDecisionPath, artifactMediaPath, deliveryPackagePath, operationKey, present }

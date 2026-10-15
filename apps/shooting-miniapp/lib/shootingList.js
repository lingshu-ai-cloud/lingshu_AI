function validDate(value) { const time = Date.parse(String(value || '')); return Number.isFinite(time) ? new Date(time) : null }
function taskDate(task) { return validDate(task.dueAt) || validDate(task.scheduledAt) || validDate(task.createdAt) || null }
function dayKey(date) { return date ? [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-') : 'undated' }
function dayLabel(date, now) {
  if (!date) return '未设置日期'
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  if (dayKey(date) === dayKey(now)) return '今天'
  if (dayKey(date) === dayKey(tomorrow)) return '明天'
  return (date.getMonth() + 1) + '月' + date.getDate() + '日'
}
function timeLabel(date) { return date ? String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0') : '待安排' }
function groupShootingTasks(tasks, nowValue) {
  const now = validDate(nowValue) || new Date()
  const rows = (Array.isArray(tasks) ? tasks : []).map((task, index) => ({ task, index, date: taskDate(task) }))
  rows.sort((a, b) => !a.date && !b.date ? a.index - b.index : !a.date ? 1 : !b.date ? -1 : a.date.getTime() - b.date.getTime() || a.index - b.index)
  const groups = []
  rows.forEach(row => {
    const key = dayKey(row.date)
    let group = groups[groups.length - 1]
    if (!group || group.key !== key) { group = { key, label: dayLabel(row.date, now), dateText: key === 'undated' ? '' : key, tasks: [] }; groups.push(group) }
    group.tasks.push({ ...row.task, timeText: timeLabel(row.date) })
  })
  return groups
}
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function finite(value) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null }
function referencePreview(task, project) {
  const spec = plain(project && project.spec)
  const slotId = String(task && (task.sourceStoryboardSlotId || task.sourceShotId) || '')
  if (!slotId || !task || String(project && project.id || '') !== String(task.sourceProjectId || '')) return null
  const slots = Array.isArray(spec.shootingSlots) ? spec.shootingSlots : []
  const slot = slots.find(item => item && (String(item.slotId || '') === slotId || String(item.id || '') === String(task.sourceShotId || '')))
  if (!slot) return null
  const assignments = plain(spec.storyboardAssignments)
  const materialId = String(assignments[String(slot.slotId || '')] || assignments[String(slot.id || '')] || '')
  const materials = Array.isArray(spec.materialSnapshots) ? spec.materialSnapshots : []
  const material = materials.find(item => item && String(item.id || '') === materialId)
  if (!material || !materialId || String(material.type || '') !== 'video' || !String(material.url || '')) return null
  const edit = plain(plain(spec.clipEdits)[String(slot.slotId || slotId) + ':' + materialId])
  const start = finite(edit.trimStart)
  const end = finite(edit.trimEnd)
  return {
    materialId,
    url: String(material.url),
    poster: String(material.poster || ''),
    start: start === null ? 0 : start,
    end: end !== null && end > (start === null ? 0 : start) ? end : null,
    rangeText: end !== null && end > (start === null ? 0 : start) ? (start === null ? 0 : start).toFixed(1) + '–' + end.toFixed(1) + ' 秒' : '完整参考素材',
  }
}
module.exports = { groupShootingTasks, taskDate, referencePreview }

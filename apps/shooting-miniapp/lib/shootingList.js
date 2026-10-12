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
module.exports = { groupShootingTasks, taskDate }

const statusLabels = { accepted:'已接收', queued:'排队中', running:'执行中', waiting_user:'需要补充决定', succeeded:'已完成', failed:'执行失败' }
function options(detail) { return (detail.actionOptions || []).map(option => ({...option, disabled:option.enabled === false || Boolean(option.disabledReason), fields:(option.fields || []).map(field=>({...field,key:field.key || field.id}))})) }
function buildPayload(option, state) {
  const payload = {...(option.payload || {})}
  const fields = (option.fields || []).map(field=>({...field,key:field.key || field.id}))
  for (const field of fields) {
    let value = state[field.key]
    if (field.type === 'number') {
      value = Number(value)
      if (!Number.isFinite(value) || value < (field.min || 0)) throw Error('请填写有效的' + field.label)
    } else if (field.type === 'scenes' || field.type === 'materials') {
      value = Array.isArray(value) ? value.map(String) : []
      if (!value.length) throw Error(field.type === 'materials' ? '请选择素材' : '请选择需要处理的分镜')
    } else { value = String(value || '').trim(); if (field.required && !value) throw Error('请填写' + field.label) }
    if (field.type === 'url' && value && !/^https:\/\/[^\s]+$/.test(value)) throw Error('请填写有效的 HTTPS 公开链接')
    payload[field.key] = value
  }
  return payload
}
module.exports = {statusLabels,options,buildPayload}

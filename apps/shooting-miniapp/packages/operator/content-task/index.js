const api = require('../../../lib/api')

function present(card) {
  const states = { needs_input:'待我处理', needs_approval:'待我验收', processing:'生产处理中', paused:'已暂停', failed:'需要处理', completed:'已完成', cancelled:'已取消' }
  const progress = card.progress?.mode === 'units' ? `${card.progress.completed} / ${card.progress.total}` : '总量尚未核实'
  const cost = card.cost
  const costLabel = !cost ? '暂无可核实费用' : cost.status === 'unknown' ? '费用暂时无法核实'
    : cost.actualCny !== null && cost.actualCny !== undefined ? `已结算 ¥${Number(cost.actualCny).toFixed(2)}`
      : cost.upperBoundCny !== null && cost.upperBoundCny !== undefined ? `上限 ¥${Number(cost.upperBoundCny).toFixed(2)}，待结算`
        : cost.expectedCny !== null && cost.expectedCny !== undefined ? `预计 ¥${Number(cost.expectedCny).toFixed(2)}，待结算`
          : cost.status === 'free' ? '费用 ¥0.00' : '暂无可核实费用'
  return { ...card, stateLabel:states[card.overallState] || '状态待核实', progressLabel:progress, costLabel,
    knownItems:[...(card.knownItems || []), ...(card.defaultedItems || []).map(item => ({...item,label:`默认 · ${item.label}`}))] }
}

Page({
  data: { loading:true, error:'', card:null },
  onLoad(options = {}) {
    this.taskId = decodeURIComponent(String(options.taskId || ''))
    if (!api.token()) { wx.reLaunch({ url:'/pages/workbench/index' }); return }
    this.refresh()
  },
  onShow() { if (this.loaded && api.token()) this.refresh() },
  async refresh() {
    if (!this.taskId || this.data.loading && this.loaded) return
    this.setData({ loading:true, error:'' })
    try {
      const result = await api.request(`mobile-workbench/assistant/content-tasks/${encodeURIComponent(this.taskId)}`)
      if (!result.card || result.card.contentTaskId !== this.taskId) throw new Error('任务回执无法核实，请返回后重试')
      this.loaded = true
      this.setData({ card:present(result.card) })
    } catch (error) {
      const errorText = error && error.status === 404 ? '任务不存在或当前账号无权查看'
        : error && error.status === 503 ? '任务状态暂时无法读取，已保留当前页面，请稍后重试'
          : error && error.message || '任务详情暂时无法读取'
      this.setData({ error:errorText })
    } finally { this.setData({ loading:false }) }
  }
})

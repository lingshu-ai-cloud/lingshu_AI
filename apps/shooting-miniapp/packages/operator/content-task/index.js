const api = require('../../../lib/api')
const taskModel = require('../../../lib/content-task')

Page({
  data: { loading:true, actionLoading:false, previewLoading:false, error:'', actionError:'', previewError:'', card:null, previewArtifact:null },
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
      const card = taskModel.present(result.card)
      this.setData({ card, actionError:'' })
      await this.loadPreview(card.currentArtifact)
    } catch (error) {
      const errorText = error && error.status === 404 ? '任务不存在或当前账号无权查看'
        : error && error.status === 503 ? '任务状态暂时无法读取，已保留当前页面，请稍后重试'
          : error && error.message || '任务详情暂时无法读取'
      this.setData({ error:errorText })
    } finally { this.setData({ loading:false }) }
  },
  async loadPreview(artifact) {
    if (!artifact || !artifact.previewAvailable) { this.setData({ previewArtifact:null, previewError:'' }); return }
    const current = this.data.previewArtifact
    if (current && current.artifactId === artifact.artifactId && current.version === artifact.version && current.previewPath) return
    this.setData({ previewLoading:true, previewError:'' })
    try {
      const previewPath = await api.downloadPrivate(taskModel.artifactMediaPath(this.taskId, artifact.artifactId))
      this.setData({ previewArtifact:{ ...artifact, previewPath } })
    } catch (error) {
      this.setData({ previewArtifact:artifact, previewError:error && error.message || '成品预览暂时无法加载' })
    } finally { this.setData({ previewLoading:false }) }
  },
  chooseArtifact(event) {
    const artifact = (this.data.card && this.data.card.artifacts || []).find(item => item.artifactId === event.currentTarget.dataset.id)
    if (artifact) this.loadPreview(artifact)
  },
  approveArtifact(event) {
    const artifact = this.artifactFromEvent(event)
    if (!artifact) return
    wx.showModal({ title:'采纳此版本？', content:'采纳后将以这个精确版本继续整理交付；此操作不会发布内容。',
      confirmText:'确认采纳', success:result => { if (result.confirm) this.decideArtifact(artifact, 'approved', '') } })
  },
  requestChanges(event) {
    const artifact = this.artifactFromEvent(event)
    if (!artifact) return
    wx.showModal({ title:'说明需要修改的内容', editable:true, placeholderText:'请写明要修改的画面、文案或细节', confirmText:'提交修改',
      success:result => { const note=String(result.content || '').trim(); if (!result.confirm) return
        if (!note) { wx.showToast({ title:'请填写修改要求', icon:'none' }); return }
        this.decideArtifact(artifact, 'changes_requested', note)
      } })
  },
  artifactFromEvent(event) {
    return (this.data.card && this.data.card.artifacts || []).find(item => item.artifactId === event.currentTarget.dataset.id && item.reviewable)
  },
  async decideArtifact(artifact, decision, note) {
    if (this.data.actionLoading) return
    this.setData({ actionLoading:true, actionError:'' })
    try {
      await api.requestWithIdempotency(taskModel.artifactDecisionPath(this.taskId, artifact.artifactId), 'POST',
        { expectedVersion:artifact.version, decision, note:note || null },
        taskModel.operationKey(decision, this.taskId, artifact.artifactId, artifact.version, note))
      wx.showToast({ title:decision === 'approved' ? '已采纳此版本' : '修改要求已提交', icon:'success' })
      await this.refresh()
    } catch (error) { this.setData({ actionError:error && error.message || '验收操作失败，请重试' }) }
    finally { this.setData({ actionLoading:false }) }
  },
  async createDeliveryPackage() {
    const card = this.data.card
    if (!card || !card.canPackage || this.data.actionLoading) return
    this.setData({ actionLoading:true, actionError:'' })
    try {
      await api.requestWithIdempotency(taskModel.deliveryPackagePath(this.taskId), 'POST',
        { expectedTaskVersion:card.cardVersion, artifactIds:card.approvedArtifactIds },
        taskModel.operationKey('package', this.taskId, card.approvedArtifactIds.join(','), card.cardVersion))
      wx.showToast({ title:'交付包已生成', icon:'success' })
      await this.refresh()
    } catch (error) { this.setData({ actionError:error && error.message || '交付包生成失败，请重试' }) }
    finally { this.setData({ actionLoading:false }) }
  },
  async downloadDelivery() {
    const receipt = this.data.card && this.data.card.readyReceipt
    if (!receipt || !receipt.downloadHref || this.data.actionLoading) return
    this.setData({ actionLoading:true, actionError:'' })
    try {
      const tempFilePath = await api.downloadPrivate(receipt.downloadHref)
      const savedFilePath = await new Promise((resolve, reject) => wx.saveFile({ tempFilePath,
        success:result => resolve(result.savedFilePath), fail:error => reject(new Error(error.errMsg || '交付包保存失败')) }))
      wx.openDocument({ filePath:savedFilePath, showMenu:true,
        fail:() => wx.showModal({ title:'交付包已保存', content:'交付包已经保存到小程序文件，可从文件菜单继续处理。', showCancel:false }) })
    } catch (error) { this.setData({ actionError:error && error.message || '交付包下载失败，请重试' }) }
    finally { this.setData({ actionLoading:false }) }
  }
})

const api = require('../../../lib/api')
const { shootingTaskPresentation } = require('../../../lib/shootingWorkflow')

function guidanceOf(task) {
  if (task.shotBrief) return task.shotBrief
  if (task.instructions) return task.instructions
  if (typeof task.requirements === 'string') {
    try {
      const requirements = JSON.parse(task.requirements)
      if (requirements && requirements.detail) return requirements.detail
    } catch (_) {
      if (task.requirements.trim()) return task.requirements
    }
  }
  return task.title || '保持画面稳定，主体置于安全区内'
}

Page({
  data: {
    task: null,
    platform: 'tiktok',
    recording: false,
    busy: false,
    elapsed: 0,
    message: '',
    flash: 'off',
    devicePosition: 'back'
  },
  onLoad(options) {
    this.taskId = options && options.taskId ? decodeURIComponent(options.taskId) : ''
    this.loadTask()
  },
  onReady() { this.camera = wx.createCameraContext() },
  onUnload() { this.clearTimer() },
  async loadTask() {
    if (!this.taskId) return this.setData({ message: '缺少拍摄任务' })
    try {
      const tasks = await api.tasks()
      const source = tasks.find(item => String(item.id) === String(this.taskId))
      if (!source) throw new Error('没有找到对应的待拍任务')
      this.setData({ task: { ...source, ...shootingTaskPresentation(source), shotBrief: guidanceOf(source) } })
    } catch (error) { this.setData({ message: error.message || '无法读取拍摄任务' }) }
  },
  choosePlatform(event) {
    if (!this.data.recording) this.setData({ platform: event.currentTarget.dataset.platform })
  },
  toggleFlash() {
    if (!this.data.recording) this.setData({ flash: this.data.flash === 'off' ? 'torch' : 'off' })
  },
  switchCamera() {
    if (!this.data.recording) this.setData({ devicePosition: this.data.devicePosition === 'back' ? 'front' : 'back' })
  },
  back() {
    if (!this.data.recording && !this.data.busy) wx.navigateBack()
  },
  handleCameraError(event) {
    const detail = event.detail || {}
    this.setData({ message: /auth|permission|authorize/i.test(detail.errMsg || '') ? '请在系统设置中允许微信使用相机' : (detail.errMsg || '相机暂时不可用') })
  },
  toggleRecord() {
    if (!this.camera || !this.data.task || this.data.busy) return
    if (this.data.recording) return this.stopRecord()
    this.setData({ recording: true, elapsed: 0, message: '' })
    this.timer = setInterval(() => this.setData({ elapsed: this.data.elapsed + 1 }), 1000)
    this.camera.startRecord({
      timeoutCallback: result => this.finishRecord(result),
      fail: error => {
        this.clearTimer()
        this.setData({ recording: false, message: error.errMsg || '无法开始拍摄，请检查相机权限' })
      }
    })
  },
  stopRecord() {
    this.setData({ busy: true })
    this.camera.stopRecord({
      success: result => this.finishRecord(result),
      fail: error => {
        this.clearTimer()
        this.setData({ recording: false, busy: false, message: error.errMsg || '无法结束拍摄' })
      }
    })
  },
  clearTimer() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  },
  fileInfo(path) {
    return new Promise((resolve, reject) => wx.getFileInfo({ filePath: path, success: resolve, fail: reject }))
  },
  async finishRecord(result) {
    if (this.finishing) return
    this.finishing = true
    this.clearTimer()
    const path = result && result.tempVideoPath
    this.setData({ recording: false, busy: true, message: '正在保存拍摄素材…' })
    try {
      if (!path) throw new Error('没有生成视频，请重新拍摄')
      const info = await this.fileInfo(path)
      if (!info.size || info.size > 30 * 1024 * 1024) throw new Error('视频超过 30 MB，请缩短拍摄时长')
      const material = await api.uploadVideo({ tempFilePath: path, size: info.size, name: 'shoot-' + this.taskId + '.mp4', mimeType: 'video/mp4' })
      await api.attach(this.taskId, material.id)
      wx.showToast({ title: '拍摄已完成', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 700)
    } catch (error) {
      this.setData({ message: error.message || error.errMsg || '保存失败，请重新拍摄' })
    } finally {
      this.finishing = false
      this.setData({ busy: false })
    }
  }
})

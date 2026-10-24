const api = require('../../../lib/api')
const { shootingTaskPresentation } = require('../../../lib/shootingWorkflow')
const { materialSourceCategoryOf, materialThemeTagsOf, MATERIAL_SOURCE_LABELS, MATERIAL_THEME_LABELS } = require('../../../lib/materialTaxonomy')
const { groupShootingTasks, referencePreview, cardPreview } = require('../../../lib/shootingList')

Page({
  data: { loggedIn: false, loading: false, referenceLoading: false, referencePreview: null, activePreviewId: '', email: '', password: '', userName: '', tasks: [], taskGroups: [], visibleTaskGroups: [], taskFilter: 'all', taskFilters: [], pendingCount: 0, completedCount: 0, selected: null, busy: false, progress: 0, progressStep: '', message: '', uploadedMaterialSummary: '', pendingMaterialId: '' },
  onLoad(options) {
    this.initialTaskId = options && options.taskId
    this.initialAutoShoot = !!(options && (options.autoShoot === true || options.autoShoot === '1'))
    if (api.token()) this.restore()
  },
  onShow() { if (this.data.loggedIn && !this.data.busy) this.refresh() },
  openAssistant() { this.selectComponent('#lingxiaoshu-sheet')?.open() },
  inputEmail(e) { this.setData({ email: e.detail.value }) },
  inputPassword(e) { this.setData({ password: e.detail.value }) },
  async signIn() {
    if (this.data.loading) return
    this.setData({ loading: true, message: '' })
    try {
      const session = await api.login(this.data.email.trim(), this.data.password)
      this.setData({ loggedIn: true, userName: session.user && (session.user.name || session.user.email) || '', password: '' })
      await this.refresh()
    } catch (e) { this.setData({ message: e.message }) }
    finally { this.setData({ loading: false }) }
  },
  async restore() {
    try {
      const session = await api.me()
      this.setData({ loggedIn: true, userName: session.user && (session.user.name || session.user.email) || '' })
      await this.refresh()
    } catch (e) {
      if (!api.token()) this.setData({ loggedIn: false })
      else this.setData({ message: e.message })
    }
  },
  canLeaveTask() {
    if (this.data.busy) return false
    if (this.data.pendingMaterialId) { this.setData({ message: '素材已经保存，只需重新关联后再离开' }); return false }
    return true
  },
  signOut() {
    if (this.data.busy) return
    const finish = () => {
      api.clearToken()
      this.setData({ loggedIn: false, userName: '', tasks: [], taskGroups: [], visibleTaskGroups: [], pendingCount: 0, completedCount: 0, selected: null, progress: 0, progressStep: '', message: '', uploadedMaterialSummary: '', pendingMaterialId: '' })
    }
    if (this.data.pendingMaterialId) wx.showModal({ title: '退出账号？', content: '素材已保存到素材库，但尚未关联任务。退出不会删除素材。', confirmText: '确认退出', success: result => { if (result.confirm && !this.data.busy) finish() } })
    else finish()
  },
  displayTask(task) {
    const presented = { ...task, ...shootingTaskPresentation(task) }
    const assignee = String(task.assigneeName || task.ownerName || task.operatorName || task.memberName || '').trim()
    return { ...presented, assigneeLabel: assignee || '待分配', assigneeInitial: (assignee || '待').slice(0, 1), reviewLabel: presented.done ? '已完成' : '待拍摄' }
  },
  groupsFor(tasks, filter) { return groupShootingTasks(tasks.filter(task => filter === 'all' || (filter === 'pending' ? !task.done : task.done)), new Date()) },
  present(tasks) {
    const displayTasks = tasks.map(task => this.displayTask(task))
    const pendingCount = displayTasks.filter(task => !task.done).length
    const completedCount = displayTasks.filter(task => task.done).length
    return { tasks: displayTasks, taskGroups: this.groupsFor(displayTasks, 'all'), visibleTaskGroups: this.groupsFor(displayTasks, this.data.taskFilter), pendingCount, completedCount,
      taskFilters: [{ key: 'all', label: '全部', count: displayTasks.length }, { key: 'pending', label: '待拍', count: pendingCount }, { key: 'completed', label: '已完成', count: completedCount }] }
  },
  selectTaskFilter(event) {
    const taskFilter = event.currentTarget.dataset.filter || 'all'
    this.setData({ taskFilter, visibleTaskGroups: this.groupsFor(this.data.tasks, taskFilter) })
  },
  async selectTask(e) {
    if (!this.canLeaveTask()) return
    const task = this.data.tasks.find(item => String(item.id) === String(e.currentTarget.dataset.id))
    if (!task) return
    this.setData({ selected: task, referencePreview: null, message: '', uploadedMaterialSummary: '', pendingMaterialId: '' })
    await this.loadReferencePreview(task)
  },
  async loadReferencePreview(task) {
    if (!task.sourceProjectId || this.data.referenceLoading) return
    this.setData({ referenceLoading: true })
    try {
      const project = await api.studioProject(task.sourceProjectId)
      if (!this.data.selected || String(this.data.selected.id) !== String(task.id)) return
      const preview = referencePreview(task, project)
      this.setData({ referencePreview: preview ? { ...preview, url: api.assetUrl(preview.url), poster: api.assetUrl(preview.poster) } : null })
    } catch (_) { /* Reference is optional; task execution remains available. */ }
    finally { this.setData({ referenceLoading: false }) }
  },
  async loadCardPreviews(tasks) {
    if (typeof api.studioProject !== 'function') return tasks
    const projectIds = Array.from(new Set(tasks.filter(task => !(task.uploadedMaterialIds || []).length).map(task => String(task.sourceProjectId || '')).filter(Boolean)))
    const projects = new Map()
    await Promise.all(projectIds.map(async id => {
      try { projects.set(id, await api.studioProject(id)) } catch (_) { /* A preview failure must not block shooting. */ }
    }))
    return tasks.map(task => {
      const preview = cardPreview(task, projects.get(String(task.sourceProjectId || '')))
      if (!preview) return task
      const safeId = String(task.id || '').replace(/[^a-zA-Z0-9_-]/g, '-')
      return { ...task, previewPlayerId: 'shot-preview-' + safeId, cardPreview: { ...preview, url: api.assetUrl(preview.url), poster: api.assetUrl(preview.poster) } }
    })
  },
  ignoreCardTap() {},
  cardPreviewPlay(e) {
    const player = String(e.currentTarget.dataset.player || '')
    const previous = this.data.activePreviewId
    if (previous && previous !== player) wx.createVideoContext(previous, this).pause()
    this.setData({ activePreviewId: player })
  },
  cardPreviewTimeUpdate(e) {
    const end = Number(e.currentTarget.dataset.end)
    if (!Number.isFinite(end) || Number(e.detail.currentTime) < end) return
    const player = wx.createVideoContext(String(e.currentTarget.dataset.player || ''), this)
    player.pause()
    player.seek(Number(e.currentTarget.dataset.start) || 0)
    this.setData({ activePreviewId: '' })
  },
  referenceTimeUpdate(e) {
    const preview = this.data.referencePreview
    if (!preview || preview.end === null || Number(e.detail.currentTime) < preview.end) return
    const player = wx.createVideoContext('reference-preview', this)
    player.pause()
    player.seek(preview.start || 0)
  },
  back() { if (this.canLeaveTask()) this.setData({ selected: null, referencePreview: null, message: '', uploadedMaterialSummary: '', pendingMaterialId: '' }) },
  async refresh() {
    this.setData({ loading: true })
    try {
      const state = this.present(await this.loadCardPreviews(await api.tasks()))
      this.setData(state)
      if (this.initialTaskId) {
        const selected = state.tasks.find(task => String(task.id) === String(this.initialTaskId)) || null
        const autoShoot = this.initialAutoShoot
        this.initialTaskId = ''
        this.initialAutoShoot = false
        this.setData({ selected })
        if (selected) await this.loadReferencePreview(selected)
        if (selected && autoShoot) this.shoot()
        else if (!selected) this.setData({ message: '没有找到对应的待拍任务，请刷新后重试' })
      } else if (this.data.selected) {
        this.setData({ selected: state.tasks.find(task => String(task.id) === String(this.data.selected.id)) || (this.data.pendingMaterialId ? this.data.selected : null) })
      }
    } catch (e) { this.setData({ message: e.message }) }
    finally { this.setData({ loading: false }) }
  },
  shoot() {
    const task = this.data.selected
    if (!task || !this.canLeaveTask()) return
    wx.navigateTo({ url: '/packages/operator/camera/index?taskId=' + encodeURIComponent(task.id) })
  },
  chooseExisting() { this.choose(['album']) },
  choose(sourceType) {
    if (!this.canLeaveTask()) return
    wx.chooseMedia({ count: 1, mediaType: ['video'], sourceType, maxDuration: 600,
      success: res => { const file = res.tempFiles && res.tempFiles[0]; if (file) this.submit(file) },
      fail: err => { if (!/cancel/i.test(err.errMsg || '')) this.setData({ message: err.errMsg || '无法选择视频' }) }
    })
  },
  async submit(file) {
    const task = this.data.selected
    if (!task || this.data.busy || this.data.pendingMaterialId) return
    if (!file.size || file.size > 30 * 1024 * 1024) { this.setData({ message: '首版支持不超过 30 MB 的视频；请缩短拍摄时长或用网页端上传' }); return }
    this.setData({ busy: true, progress: 0, progressStep: '读取视频', message: '', uploadedMaterialSummary: '', pendingMaterialId: '' })
    try {
      const material = await api.uploadVideo({ ...file, name: 'shoot-' + task.id + '.mp4', mimeType: 'video/mp4' }, progress => this.setData({ progress, progressStep: progress < 30 ? '读取视频' : '上传素材' }))
      const sourceText = MATERIAL_SOURCE_LABELS[materialSourceCategoryOf(material)]
      const themeText = materialThemeTagsOf(material).map(theme => MATERIAL_THEME_LABELS[theme]).join('、')
      this.setData({ progressStep: '关联任务', uploadedMaterialSummary: sourceText + (themeText ? ' · ' + themeText : ''), pendingMaterialId: material.id, message: '素材已经保存，正在关联任务…' })
      await api.attach(task.id, material.id)
      this.setData({ pendingMaterialId: '', progress: 100, message: '已完成拍摄任务' })
      await this.refresh()
      wx.showToast({ title: '任务已完成', icon: 'success' })
    } catch (e) { this.setData({ message: e.message }) }
    finally { this.setData({ busy: false }) }
  },
  async retryAttach() {
    if (!this.data.selected || !this.data.pendingMaterialId || this.data.busy) return
    this.setData({ busy: true, progressStep: '关联任务', message: '' })
    try {
      await api.attach(this.data.selected.id, this.data.pendingMaterialId)
      this.setData({ pendingMaterialId: '', progress: 100, message: '已完成拍摄任务' })
      await this.refresh()
    } catch (e) { this.setData({ message: e.message }) }
    finally { this.setData({ busy: false }) }
  }
})

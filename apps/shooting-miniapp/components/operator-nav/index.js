Component({
  properties: {
    active: { type: String, value: 'work' },
    mode: { type: String, value: 'operator', observer: 'configure' }
  },
  data: {
    items: [
      { key: 'work', label: '工作', path: '/packages/operator/home/index' },
      { key: 'assistant', label: '编导 Agent', path: '/packages/operator/assistant/index' }
    ]
  },
  lifetimes: { attached() { this.configure(this.properties.mode) } },
  methods: {
    configure(mode) {
      this.setData({ items: mode === 'service' ? [
        { key: 'work', label: '工作', path: '/packages/customer/home/index' },
        { key: 'assistant', label: '客服 Agent', path: '/packages/operator/assistant/index?edition=service' }
      ] : [
        { key: 'work', label: '工作', path: '/packages/operator/home/index' },
        { key: 'assistant', label: '编导 Agent', path: '/packages/operator/assistant/index' }
      ] })
    },
    select(e) {
      const item = this.data.items.find(entry => entry.key === e.currentTarget.dataset.key)
      if (!item || item.key === this.data.active) return
      const servicePaths = { work: '/packages/customer/home/index', assistant: '/packages/operator/assistant/index?edition=service' }
      wx.redirectTo({ url: this.properties.mode === 'service' ? servicePaths[item.key] : item.path })
    }
  }
})

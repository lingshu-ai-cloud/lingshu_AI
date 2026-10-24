Component({
  properties: {
    active: { type: String, value: 'today' },
    todayBadge: { type: Number, value: 0 }
  },
  data: {
    storedTodayBadge: 0,
    items: [
      { key: 'today', label: '今日待办', path: '/packages/operator/home/index' },
      { key: 'shooting', label: '素材拍摄', path: '/packages/operator/shooting/index' },
      { key: 'materials', label: '素材资产', path: '/packages/operator/materials/index' }
    ]
  },
  lifetimes: {
    attached() { this.setData({ storedTodayBadge: Number(wx.getStorageSync('operator-customer-unread-count')) || 0 }) }
  },
  methods: {
    select(e) {
      const item = this.data.items.find(entry => entry.key === e.currentTarget.dataset.key)
      if (!item || item.key === this.data.active) return
      wx.redirectTo({ url: item.path })
    },
    askAssistant() { this.triggerEvent('assistant') }
  }
})

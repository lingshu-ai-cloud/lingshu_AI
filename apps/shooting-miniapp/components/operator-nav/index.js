Component({
  properties: {
    active: { type: String, value: 'assistant' },
    todayBadge: { type: Number, value: 0 }
  },
  data: {
    storedTodayBadge: 0,
    items: [
      { key: 'assistant', label: 'Hi 灵小枢', path: '/packages/operator/assistant/index' },
      { key: 'materials', label: '我的素材', path: '/packages/operator/materials/index' },
      { key: 'customers', label: '我的客户', path: '/packages/operator/inquiries/index' }
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

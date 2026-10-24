const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const nativeModule = { exports: {} }
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'lib/inquiries.js'), 'utf8'), { module: nativeModule, exports: nativeModule.exports, Date, String, Number, Array, Math })
const { normalizeCustomer, filterInquiries, messagesOf, customerActivityDate } = nativeModule.exports

test('inquiry model separates draft confirmation from follow-up and sorts unread first', () => {
  const confirm = normalizeCustomer({ id: 'instagram_a', name: 'Amina', pendingDraft: 'Draft answer', lastActiveAt: 10, timeline: [{ id: 'i1', actor: 'buyer', body: 'Need price', timestamp: 10 }] })
  const followup = normalizeCustomer({ id: 'messenger_b', name: 'Bob', handlingMode: 'human_needed', hasUnread: true, lastActiveAt: 5, tags: ['高意向'], timeline: [{ id: 'i2', actor: 'buyer', body: 'MOQ?', timestamp: 5 }] })
  assert.equal(confirm.status, 'confirm')
  assert.equal(confirm.channel, 'Instagram')
  assert.equal(followup.status, 'followup')
  assert.deepEqual(Array.from(followup.labels), ['待跟进', '高意向'])
  assert.deepEqual(filterInquiries([confirm, followup], { status: 'followup', query: '高意向', unreadOnly: true, channel: 'Messenger' }).map(item => item.id), ['messenger_b'])
})

test('conversation messages retain chronological order and outbound direction', () => {
  const items = messagesOf({ timeline: [{ id: 'out', type: 'msg_out_human', body: 'Hello', timestamp: 20 }, { id: 'in', actor: 'buyer', body: 'Hi', timestamp: 10 }] })
  assert.deepEqual(items.map(item => item.id), ['in', 'out'])
  assert.equal(items[0].mine, false)
  assert.equal(items[1].mine, true)
})

test('AI and human outbound customer-service messages render on the right', () => {
  const items = messagesOf({ timeline: [
    { id: 'buyer', actor: 'buyer', type: 'msg_in', body: 'Need samples', timestamp: 10 },
    { id: 'ai', actor: 'ai', type: 'msg_out_ai', body: 'Certainly.', timestamp: 20 },
    { id: 'human', direction: 'human_outbound', body: 'I will follow up.', timestamp: 30 }
  ] })
  assert.deepEqual(items.map(item => item.mine), [false, true, true])
})

test('numeric workbench activity timestamps remain eligible for the selected week', () => {
  assert.equal(customerActivityDate({ lastActiveAt: Date.parse('2026-10-25T08:00:00Z') }), '2026-10-25')
  assert.equal(customerActivityDate({ updatedAt: '2026-10-24T23:30:00Z' }), '2026-10-24')
  assert.equal(customerActivityDate({}), '')
})

test('native inquiry pages expose mobile tabs and plus-panel tools', () => {
  const root = path.join(__dirname, 'packages/operator')
  const list = fs.readFileSync(path.join(root, 'inquiries/index.wxml'), 'utf8')
  const chat = fs.readFileSync(path.join(root, 'conversation/index.wxml'), 'utf8')
  const chatStyles = fs.readFileSync(path.join(root, 'conversation/index.wxss'), 'utf8')
  const actionMenuStyles = fs.readFileSync(path.join(__dirname, 'styles/message-action-menu.wxss'), 'utf8')
  const controller = fs.readFileSync(path.join(root, 'conversation/index.js'), 'utf8')
  const api = fs.readFileSync(path.join(__dirname, 'lib/api.js'), 'utf8')
  assert.match(list, /待回复/)
  assert.match(list, /待跟进/)
  assert.match(list, /全部/)
  assert.match(list, /WhatsApp/)
  assert.match(list, /搜索客户或消息/)
  assert.match(list, /未读 \{\{counts\.unread\}\}/)
  assert.match(list, /customer-label/)
  assert.match(list, /unread-count/)
  for (const label of ['AI 推荐回复', '智能报价', '会话搜索']) assert.match(chat, new RegExp(label))
  assert.match(chat, /class="message-action-menu"/)
  assert.doesNotMatch(chat, /scroll-view[^>]*class="message-action-menu"/)
  assert.match(chat, /class="message-action-option"/)
  assert.doesNotMatch(chat, /class="plus-grid"/)
  assert.match(chatStyles, /@import "\.\.\/\.\.\/\.\.\/styles\/message-action-menu\.wxss"/)
  assert.match(actionMenuStyles, /\.message-action-menu\{position:absolute/)
  assert.match(actionMenuStyles, /width:620rpx/)
  assert.match(actionMenuStyles, /height:480rpx/)
  assert.match(actionMenuStyles, /min-height:112rpx/)
  assert.doesNotMatch(actionMenuStyles, /message-action-option\+\.message-action-option::before/)
  assert.doesNotMatch(chat, /文件和媒体/)
  assert.match(chat, /bindtap="openProfile"/)
  assert.match(chat, /输入中文，自动翻译后发送/)
  assert.match(chat, /正在生成两个回复版本/)
  assert.doesNotMatch(chat, /AI 已结合客户资料和当前会话生成回复/)
  assert.match(chat, /class="composer"/)
  for (const action of ['quoteCatalog', 'createCustomerQuote', 'updateCustomerQuote', 'confirmCustomerQuote', 'customerQuoteReply', 'customerQuoteCard', 'sendCustomerQuoteCard']) assert.match(api, new RegExp(action))
  for (const action of ['saveQuote', 'confirmQuote', 'insertQuoteReply', 'previewQuote', 'sendQuoteCard']) assert.match(controller, new RegExp(action))
  assert.match(chat, /确认后可发送/)
  assert.match(chat, /quote-preview-actions/)
})

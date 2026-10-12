const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const nativeModule = { exports: {} }
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'lib/inquiries.js'), 'utf8'), { module: nativeModule, exports: nativeModule.exports, Date, String, Number, Array, Math })
const { normalizeCustomer, filterInquiries, messagesOf } = nativeModule.exports

test('inquiry model separates draft confirmation from follow-up and sorts unread first', () => {
  const confirm = normalizeCustomer({ id: 'instagram_a', name: 'Amina', pendingDraft: 'Draft answer', lastActiveAt: 10, timeline: [{ id: 'i1', actor: 'buyer', body: 'Need price', timestamp: 10 }] })
  const followup = normalizeCustomer({ id: 'messenger_b', name: 'Bob', handlingMode: 'human_needed', hasUnread: true, lastActiveAt: 5, tags: ['高意向'], timeline: [{ id: 'i2', actor: 'buyer', body: 'MOQ?', timestamp: 5 }] })
  assert.equal(confirm.status, 'confirm')
  assert.equal(confirm.channel, 'Instagram')
  assert.equal(followup.status, 'followup')
  assert.deepEqual(filterInquiries([confirm, followup], { status: 'followup', query: '高意向', unreadOnly: true, channel: 'Messenger' }).map(item => item.id), ['messenger_b'])
})

test('conversation messages retain chronological order and outbound direction', () => {
  const items = messagesOf({ timeline: [{ id: 'out', type: 'msg_out_human', body: 'Hello', timestamp: 20 }, { id: 'in', actor: 'buyer', body: 'Hi', timestamp: 10 }] })
  assert.deepEqual(items.map(item => item.id), ['in', 'out'])
  assert.equal(items[0].mine, false)
  assert.equal(items[1].mine, true)
})

test('native inquiry pages expose mobile tabs and plus-panel tools', () => {
  const root = path.join(__dirname, 'packages/operator')
  const list = fs.readFileSync(path.join(root, 'inquiries/index.wxml'), 'utf8')
  const chat = fs.readFileSync(path.join(root, 'conversation/index.wxml'), 'utf8')
  assert.match(list, /待确认/)
  assert.match(list, /待跟进/)
  assert.match(list, /搜索客户或消息/)
  for (const label of ['客户资料', '回复与报价', '文件和媒体', '会话搜索']) assert.match(chat, new RegExp(label))
  assert.match(chat, /class="composer"/)
})

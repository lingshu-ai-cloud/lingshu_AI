const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
function load(file, bindings = {}) {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), { module, exports: module.exports, require: bindings.require || require, Date, String, Number, Array, Math })
  return module.exports
}
const inquiries = load('lib/inquiries.js')
const { project } = load('lib/customer-service-home.js', { require: () => inquiries })

test('客服工作台从真实会话投影回复、跟进和高意向队列', () => {
  const result = project([
    { id: 'a', name: 'Alice', hasUnread: true, stage: '高意向', tags: ['报价'], timeline: [{ actor: 'customer', body: 'price?' }] },
    { id: 'b', name: 'Bob', stage: 'converted', timeline: [{ actor: 'seller', body: 'done' }] },
    { id: 'c', name: 'Cathy', timeline: [{ actor: 'seller', body: 'followed' }] }
  ])
  assert.equal(result.counts.pendingReply, 1)
  assert.equal(result.counts.replied, 2)
  assert.equal(result.counts.pendingFollowup, 1)
  assert.equal(result.counts.converted, 1)
  assert.deepEqual(result.highIntent.map(item => item.id), ['a'])
})

test('客服工作页使用周日历并移除今日询盘组件', () => {
  const markup = fs.readFileSync(__dirname + '/packages/customer/home/index.wxml', 'utf8')
  const script = fs.readFileSync(__dirname + '/packages/customer/home/index.js', 'utf8')
  assert.match(markup, /class="week-card/)
  assert.match(markup, /本周待回复/)
  assert.doesNotMatch(markup, /今日询盘/)
  assert.match(script, /model\.week\(\)/)
})

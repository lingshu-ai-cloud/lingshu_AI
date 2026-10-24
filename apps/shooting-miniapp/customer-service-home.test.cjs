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

test('客服旧入口跳转到统一今日待办，客服数据由统一投影继续使用', () => {
  const script = fs.readFileSync(__dirname + '/packages/customer/home/index.js', 'utf8')
  const unified = fs.readFileSync(__dirname + '/packages/operator/home/index.js', 'utf8')
  assert.match(script, /redirectTo\(\{ url: '\/packages\/operator\/home\/index'/)
  assert.match(unified, /customerHome\.project/)
  assert.match(unified, /api\.customers\(\)/)
})

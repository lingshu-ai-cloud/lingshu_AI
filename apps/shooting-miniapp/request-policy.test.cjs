const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
function loadApi(wx) {
  const filename = require('node:path').join(__dirname, 'lib/api.js')
  const module = { exports: {} }, policy = { exports: {} }
  vm.runInNewContext(readFileSync(__dirname + '/lib/request-policy.js', 'utf8'), { module: policy })
  vm.runInNewContext(readFileSync(filename, 'utf8'), { module, exports: module.exports, wx, require: id => id === '../config' ? { apiBase: 'https://example.test' } : id === './request-policy' ? policy.exports : (() => { throw new Error('Unexpected dependency ' + id) })() })
  return module.exports
}
test('late 401 from a previous account cannot clear the current account token', async () => {
  let token = 'old-token', respond
  const api = loadApi({ getStorageSync: () => token, removeStorageSync: () => { token = '' }, request: options => { respond = options.success; assert.equal(options.header.Authorization, 'Bearer old-token') } })
  const pending = api.me(); token = 'new-token'
  respond({ statusCode: 401, data: { error: 'unauthorized' } })
  await assert.rejects(pending, error => error.status === 401)
  assert.equal(token, 'new-token')
})
test('current-account 401 clears expired token and failures retain shared evidence', async () => {
  let token = 'current', respond
  const api = loadApi({ getStorageSync: () => token, removeStorageSync: () => { token = '' }, request: options => { respond = options.success } })
  const pending = api.me(); respond({ statusCode: 401, data: { error: 'expired', message: '登录已过期' } })
  await assert.rejects(pending, error => error.code === 'expired' && error.details.message === '登录已过期')
  assert.equal(token, '')
})

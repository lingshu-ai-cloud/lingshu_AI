const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
function loadApi(wx, apiBase = 'https://example.test') {
  const filename = require('node:path').join(__dirname, 'lib/api.js')
  const module = { exports: {} }, policy = { exports: {} }
  vm.runInNewContext(readFileSync(__dirname + '/lib/request-policy.js', 'utf8'), { module: policy })
  vm.runInNewContext(readFileSync(filename, 'utf8'), { module, exports: module.exports, wx, require: id => id === '../config' ? { apiBase } : id === './request-policy' ? policy.exports : (() => { throw new Error('Unexpected dependency ' + id) })() })
  return module.exports
}
test('network base accepts HTTPS and loopback HTTP but rejects remote insecure origins', async () => {
  for (const apiBase of ['https://app.lingshu.site', 'http://127.0.0.1:8790', 'http://localhost:8790']) {
    let requested = ''
    const api = loadApi({ getStorageSync: () => '', request: options => { requested = options.url; options.success({ statusCode: 200, data: {} }) } }, apiBase)
    await api.me()
    assert.equal(requested, apiBase + '/api/overseas/auth/me')
  }
  const api = loadApi({ getStorageSync: () => '', request() { throw new Error('must not request') } }, 'http://192.168.1.20:8790')
  await assert.rejects(api.me(), /本地联调仅允许/)
})
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

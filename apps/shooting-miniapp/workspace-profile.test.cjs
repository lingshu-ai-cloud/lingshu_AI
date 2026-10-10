const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function api() {
  const module = { exports: {} }
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'lib/api.js'), 'utf8'),
    {
      module,
      exports: module.exports,
      require: () => ({ apiBase: 'https://example.test' }),
      wx: { getStorageSync: () => '', removeStorageSync() {}, setStorageSync() {} },
      Promise,
      Error,
    },
  )
  return module.exports
}

test('workspace kind uses the server-authoritative session profile without a workspace request', () => {
  const client = api()
  assert.equal(client.workspaceKind({ productProfile: 'starter_198' }), 'starter')
  assert.equal(client.workspaceKind({ productProfile: 'advanced_customer' }), 'legacy')
})

test('missing or unknown profile fails closed instead of guessing from a subscription label', () => {
  const client = api()
  assert.throws(
    () => client.workspaceKind({ subscription: { plan: '198' } }),
    /能力边界暂时无法核验/,
  )
  assert.throws(() => client.workspaceKind(null), /能力边界暂时无法核验/)
})

test('the miniapp no longer probes the protected starter workspace to classify accounts', () => {
  const source = fs.readFileSync(path.join(__dirname, 'lib/api.js'), 'utf8')
  const classifier = source.slice(source.indexOf('module.exports.workspaceKind'), source.indexOf('module.exports.command'))
  assert.doesNotMatch(classifier, /request\s*\(/)
  assert.doesNotMatch(classifier, /403|profile_not_enabled|workspace_not_entitled/)
})

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

test('the client exposes no product-profile classifier', () => {
  const client = api()
  assert.equal(client.workspaceKind, undefined)
})

test('the workbench always reads the unified overview and queue endpoints', () => {
  const source = fs.readFileSync(path.join(__dirname, 'pages/workbench/index.js'), 'utf8')
  assert.match(source, /mobile-workbench\/overview/)
  assert.match(source, /mobile-workbench\/queue/)
  assert.doesNotMatch(source, /starter-198\/mobile\/(?:queue|snooze|transcribe)/)
  assert.doesNotMatch(source, /workspaceKind|productProfile/)
})

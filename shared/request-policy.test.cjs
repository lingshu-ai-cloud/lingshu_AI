const { test } = require('node:test')
const assert = require('node:assert/strict')
const { httpFailure, decisionCommand, terminalReceipt, createRequestGuard } = require('./request-policy.cjs')
test('stale conflicts preserve error evidence, other conflicts retain server wording', () => {
  const body = { error: 'stale_decision', version: 'v2' }
  const result = httpFailure(409, body)
  assert.equal(result.stale, true); assert.equal(result.details, body)
  assert.equal(httpFailure(409, { error: 'quota', message: '额度不足' }).message, '额度不足')
  assert.equal(httpFailure(500, '<html>').message, '请求失败，请重试')
})
test('commands require authoritative version and retain action and trimmed note', () => {
  assert.throws(() => decisionCommand({ actionId: 'approve', expectedVersion: '' }), /最新版本/)
  assert.deepEqual(decisionCommand({ actionId: 'reject', expectedVersion: ' v2 ', note: ' 原因 ' }), { actionId: 'reject', expectedVersion: 'v2', note: '原因' })
})
test('identity changes and old completions cannot unlock a newer submission', () => {
  let identity = 'tenant-a:user-a'
  const guard = createRequestGuard(() => identity), old = guard.begin()
  assert.equal(guard.begin(), null)
  identity = 'tenant-b:user-b'; assert.equal(old.current(), false)
  guard.reset(); const newer = guard.begin()
  assert.equal(old.finish(), false); assert.equal(guard.begin(), null)
  assert.equal(newer.current(), true); assert.equal(newer.finish(), true)
})
test('cancelled receipts stop polling but waiting decisions keep polling', () => {
  assert.equal(terminalReceipt({ status: 'cancelled' }), true)
  assert.equal(terminalReceipt({ status: 'waiting_user' }), false)
})
test('browser ESM and native generated policies match the source', async () => {
  const fs = require('node:fs'), vm = require('node:vm')
  const web = await import('./request-policy.mjs'), native = { exports: {} }
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../apps/shooting-miniapp/lib/request-policy.js'), 'utf8'), { module: native })
  for (const policy of [web, native.exports]) {
    assert.equal(policy.httpFailure(409, { error: 'stale_decision' }).message, httpFailure(409, { error: 'stale_decision' }).message)
    assert.equal(policy.terminalReceipt({ status: 'cancelled' }), true)
    assert.equal(JSON.stringify(policy.decisionCommand({ actionId: 'approve', expectedVersion: 'v2' })), JSON.stringify(decisionCommand({ actionId: 'approve', expectedVersion: 'v2' })))
  }
})

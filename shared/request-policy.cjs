'use strict'

// Transport-independent policy. Callers retain their own endpoints and auth adapters.
const staleCodes = new Set(['stale_decision', 'assistant_decision_changed', 'assistant_decision_not_pending'])
function httpFailure(status, body, fallback = '请求失败，请重试') {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const code = String(source.error || '').trim().slice(0, 120)
  const stale = Number(status) === 409 && staleCodes.has(code)
  return { status: Number(status), code, details: source, stale,
    message: stale ? '这项待办已更新，已为你刷新最新内容' : String(source.message || source.error || fallback).trim().slice(0, 240) || fallback }
}
function decisionCommand(input) {
  const version = String(input.expectedVersion || '').trim()
  if (!version) throw new Error('请重新加载待办确认最新版本')
  const note = String(input.note || '').trim()
  return { actionId: input.actionId, expectedVersion: version, ...(note ? { note } : {}) }
}
function terminalReceipt(receipt) {
  return Boolean(receipt && ['succeeded', 'failed', 'cancelled'].includes(receipt.status))
}
// Invalidate on account change/unmount. Old requests cannot release newer locks.
function createRequestGuard(identity) {
  let generation = 0, busy = false, requestNumber = 0
  return {
    reset() { generation++; busy = false },
    begin() {
      if (busy) return null
      busy = true
      const number = ++requestNumber, requestGeneration = generation, requestIdentity = identity()
      const ownsLock = () => busy && requestGeneration === generation && number === requestNumber
      return {
        current: () => ownsLock() && requestIdentity === identity(),
        finish() { if (!ownsLock()) return false; busy = false; return true }
      }
    }
  }
}
module.exports = { httpFailure, decisionCommand, terminalReceipt, createRequestGuard }

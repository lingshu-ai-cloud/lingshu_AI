// Server owns conversation truth, action eligibility and execution receipts.
// This controller never turns an assistant suggestion into an executed action.
function createAssistantController(options) {
  const request = options.request
  const storage = options.storage || { get: () => null, set: () => {} }
  const emit = options.onChange || (() => {})
  const schedule = options.schedule || ((fn, delay) => setTimeout(fn, delay))
  const cancel = options.cancel || clearTimeout
  let epoch = 0, timer = null, scope = '', disposed = false
  let state = { sessionId: '', messages: [], suggestions: [], preview: null, receipts: [], loading: false, sending: false, confirming: false, error: '', input: '', recording: false, transcribing: false }
  const update = patch => { state = { ...state, ...patch }; emit({ ...state }) }
  const key = () => 'mobile-assistant-pending:' + scope
  const makeKey = () => 'assistant-' + Date.now() + '-' + Math.random().toString(36).slice(2)
  let pending = {}
  const save = () => storage.set(key(), pending)
  const live = ticket => !disposed && epoch === ticket
  const stop = () => { if (timer !== null) cancel(timer); timer = null }
  const terminal = receipt => ['succeeded', 'failed', 'cancelled'].includes(receipt.status)
  async function poll() {
    stop()
    const ticket = epoch
    try {
      const receipts = await Promise.all(state.receipts.map(async receipt => terminal(receipt) ? receipt : (await request('mobile-workbench/actions/' + encodeURIComponent(receipt.id))).receipt))
      if (!live(ticket)) return
      update({ receipts })
      pending.receiptIds = receipts.filter(receipt => !terminal(receipt)).map(receipt => receipt.id); save()
    } catch (error) { if (live(ticket)) update({ error: error.message || '执行状态暂时无法更新，稍后重试。' }) }
    if (live(ticket) && state.receipts.some(receipt => !terminal(receipt))) timer = schedule(poll, 3000)
  }
  async function restore(nextScope) {
    stop(); epoch++; disposed = false; scope = String(nextScope || '')
    if (!scope) throw new Error('助手需要已登录的企业账号')
    pending = storage.get(key()) || {}
    const ticket = epoch
    update({ sessionId: '', messages: [], suggestions: [], receipts: [], preview: null, loading: true, sending: false, confirming: false, error: '', answer: '', evidence: [], actions: [], links: [], input: '' })
    try {
      const [context, sessions] = await Promise.all([request('mobile-workbench/assistant/context'), request('mobile-workbench/assistant/sessions')])
      let session = (sessions.sessions || [])[0]
      if (!session) session = (await request('mobile-workbench/assistant/sessions', 'POST', {})).session
      const history = await request('mobile-workbench/assistant/sessions/' + encodeURIComponent(session.id) + '/messages')
      const result = { sessionId: session.id, messages: history.messages, suggestions: context.quickQuestions, receipts: history.receipts || [] }
      if (!live(ticket)) return
      const receipts = result.receipts || []
      update({ sessionId: result.sessionId, messages: result.messages || [], suggestions: result.suggestions || [], receipts })
      // Session is authoritative, but locally accepted receipts survive a lost response.
      const missing = (pending.receiptIds || []).filter(id => !receipts.some(receipt => receipt.id === id))
      for (const id of missing) {
        try { const result = await request('mobile-workbench/actions/' + encodeURIComponent(id)); if (live(ticket)) update({ receipts: [...state.receipts, result.receipt] }) } catch (error) { if (live(ticket)) update({ error: error.message }) }
      }
      if (live(ticket) && pending.link) {
        try {
          await request('mobile-workbench/assistant/sessions/' + encodeURIComponent(pending.link.sessionId) + '/commands', 'POST', { commandId: pending.link.commandId, clientMessageId: pending.link.clientMessageId })
          if (live(ticket)) { delete pending.link; delete pending.confirm; save() }
        } catch (error) { if (live(ticket)) update({ error: '指令已受理，会话同步暂时失败；可通过执行回执继续查看。' }) }
      }
      if (live(ticket)) await poll()
    } catch (error) { if (live(ticket)) update({ error: error.message }) }
    finally { if (live(ticket)) update({ loading: false }) }
  }
  async function send(text) {
    text = String(text || '').trim()
    if (!text || state.sending || state.confirming) return
    const ticket = epoch
    if (!state.sessionId) throw new Error('请先恢复助手会话')
    if (!pending.message || pending.message.text !== text) { pending.message = { text, idempotencyKey: makeKey() }; save() }
    update({ sending: true, input: text, error: '', preview: null })
    try {
      const result = await request('mobile-workbench/assistant/query', 'POST', { sessionId: state.sessionId, input: text, idempotencyKey: pending.message.idempotencyKey })
      if (!live(ticket)) return
      const history = await request('mobile-workbench/assistant/sessions/' + encodeURIComponent(state.sessionId) + '/messages')
      if (!live(ticket)) return
      delete pending.message; save()
      update({ messages: history.messages || [], suggestions: result.suggestions || state.suggestions, input: '', answer: result.text, evidence: result.evidence || [], actions: result.actions || [], links: result.links || [] })
      return result
    } catch (error) { if (live(ticket)) update({ error: error.message }); throw error }
    finally { if (live(ticket)) update({ sending: false }) }
  }
  async function preview(action) {
    const ticket = epoch
    update({ error: '', preview: null })
    const result = await request('mobile-workbench/assistant/preview', 'POST', { action })
    if (live(ticket)) update({ preview: result })
    return result
  }
  async function confirm(previewId) {
    if (state.confirming) return
    if (!state.preview || state.preview.previewId !== previewId) throw new Error('请先查看本次操作预览')
    const ticket = epoch
    if (!pending.confirm || pending.confirm.previewId !== previewId) { pending.confirm = { previewId, idempotencyKey: makeKey() }; save() }
    update({ confirming: true, error: '' })
    try {
      const result = await request('mobile-workbench/actions', 'POST', { ...state.preview.confirmation.body, idempotencyKey: pending.confirm.idempotencyKey })
      if (!live(ticket)) return
      const receipt = result.receipt
      if (!receipt || !receipt.id) throw new Error('服务器未返回执行回执，请保留预览并重试。')
      pending.receiptIds = [...new Set([...(pending.receiptIds || []), receipt.id])]; pending.link = { sessionId: state.sessionId, commandId: receipt.id, clientMessageId: pending.confirm.idempotencyKey }; save()
      update({ preview: null, receipts: [...state.receipts.filter(item => item.id !== receipt.id), receipt] })
      try {
        await request('mobile-workbench/assistant/sessions/' + encodeURIComponent(state.sessionId) + '/commands', 'POST', { commandId: receipt.id, clientMessageId: pending.confirm.idempotencyKey })
        if (!live(ticket)) return
        delete pending.confirm; delete pending.link; save()
      } catch (error) {
        // Accepted command remains accepted even if conversation linkage is unavailable.
        if (live(ticket)) update({ error: '指令已受理，会话同步暂时失败；可通过执行回执继续查看。' })
      }
      await poll()
      return receipt
    } catch (error) { if (live(ticket)) update({ error: error.message }); throw error }
    finally { if (live(ticket)) update({ confirming: false }) }
  }
  return {
    restore, send, preview, confirm, poll,
    getState: () => ({ ...state }),
    setInput: input => update({ input: String(input || '') }),
    dismissPreview: () => update({ preview: null }),
    // Recognition is draft text only. It never sends or confirms work.
    voiceDraft: text => update({ input: String(text || ''), recording: false, transcribing: false, error: '' }),
    voiceFailure: error => update({ recording: false, transcribing: false, error: (error && error.message) || '语音暂时不可用，请继续使用文字输入。' }),
    pause: stop,
    dispose: () => { disposed = true; epoch++; stop() }
  }
}
module.exports = { createAssistantController }

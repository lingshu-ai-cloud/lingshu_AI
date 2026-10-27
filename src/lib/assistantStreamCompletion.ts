export class AssistantStreamCompletion {
  done = false;
  error = '';
  accept(payload: string) {
    if (payload === '[DONE]') { this.done = true; return null; }
    let event: { text?: string; error?: string; code?: string; publicMessage?: string; taskPortal?: unknown; companyReport?: unknown; companyReportProgress?: unknown; analysisWork?: unknown; analysisComplete?: unknown; sources?: { title: string; uri: string }[] };
    try { event = JSON.parse(payload); }
    catch { this.error = '回答传输异常，已保留收到的部分。请重新提问。'; return null; }
    if (!event || typeof event !== 'object') { this.error = '回答传输异常，请重新提问。'; return null; }
    if (event.error) this.error = typeof event.code === 'string' && /^(?:external_|exchange_|comtrade_|qwen_search_|search_|company_report_|scene_|assistant_|filing_)/u.test(event.code)
      && typeof event.publicMessage === 'string' && event.publicMessage.length <= (event.code === 'search_source_verification_failed' ? 4000 : 240)
      ? event.publicMessage : '回答生成中断，已保留收到的部分。请发送“继续”或重新提问。';
    return event;
  }
  assertComplete() {
    if (this.error) throw new Error(this.error);
    if (!this.done) throw new Error('回答传输中断，已保留收到的部分。请发送“继续”或重新提问。');
  }
}

export function appendAssistantStreamFailure(content: string, message: string) {
  const fences = content.split('\n').filter(line => /^\s*```/.test(line)).length;
  return `${content}${fences % 2 ? '\n```' : ''}\n\n${message}`;
}

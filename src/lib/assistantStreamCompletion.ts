export class AssistantStreamCompletion {
  done = false;
  error = '';
  accept(payload: string) {
    if (payload === '[DONE]') { this.done = true; return null; }
    let event: { text?: string; error?: string; sources?: { title: string; uri: string }[] };
    try { event = JSON.parse(payload); }
    catch { this.error = '回答传输异常，已保留收到的部分。请重新提问。'; return null; }
    if (!event || typeof event !== 'object') { this.error = '回答传输异常，请重新提问。'; return null; }
    if (event.error) this.error = '回答生成中断，已保留收到的部分。请发送“继续”或重新提问。';
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

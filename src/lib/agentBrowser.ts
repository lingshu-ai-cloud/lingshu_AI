import { authHeader } from './auth';

export type BrowserStreamPacket = {
  type: 'frame'; image: string; sequence: number; capturedAt: string;
  width: number; height: number; executing: boolean;
} | { type: 'status'; state: 'ready' | 'executing' | 'closed' | 'error'; message: string };

export async function streamAgentBrowser(runId: string, taskId: string, signal: AbortSignal, onPacket: (packet: BrowserStreamPacket) => void): Promise<void> {
  const response = await fetch(`/api/overseas/digital-employees/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/browser-stream`, {
    headers: { ...authHeader(), Accept: 'text/event-stream' }, signal,
  });
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || '浏览器直播连接失败');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const packet = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const data = packet.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
        if (!data || signal.aborted) continue;
        let parsed: BrowserStreamPacket;
        try { parsed = JSON.parse(data); } catch { continue; }
        if (parsed.type === 'frame' && typeof parsed.image === 'string' && parsed.width > 0 && parsed.height > 0) onPacket(parsed);
        else if (parsed.type === 'status' && typeof parsed.message === 'string') onPacket(parsed);
      }
    }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

export async function refreshAgentBrowser(runId: string, taskId: string): Promise<{ refreshedAt: string; sequence: number }> {
  const response = await fetch(`/api/overseas/digital-employees/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/browser-refresh`, {
    method: 'POST',
    headers: authHeader(),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '任务工作页面刷新失败');
  return body;
}

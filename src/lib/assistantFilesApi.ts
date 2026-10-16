import { authHeader } from './auth';
export type AssistantFile = { id: string; name: string; mimeType: string; size: number; sha256: string };
export async function createAssistantFile(input: { title: string; content: string; format: 'pdf' | 'jpg'; diagram: boolean }, signal?: AbortSignal): Promise<AssistantFile> {
  const response = await fetch('/api/overseas/assistant-files', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify(input), signal });
  const data = await response.json();
  if (!response.ok || !data.file?.id) throw new Error(data.message || '文件未生成，请重试。');
  return data.file;
}
export async function readAssistantFile(id: string, signal?: AbortSignal): Promise<AssistantFile> {
  const response = await fetch(`/api/overseas/assistant-files/${id}`, { headers: authHeader(), signal });
  const data = await response.json();
  if (!response.ok || !data.file?.id) throw new Error(data.message || '文件暂时无法读取。');
  return data.file;
}
export async function downloadAssistantFile(file: AssistantFile) {
  const response = await fetch(`/api/overseas/assistant-files/${file.id}/content`, { headers: authHeader() });
  if (!response.ok) throw new Error('文件下载失败，请稍后重试。');
  const blob = await response.blob();
  if (!blob.size || !blob.type.startsWith(file.mimeType)) throw new Error('文件内容校验失败，请重新生成。');
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

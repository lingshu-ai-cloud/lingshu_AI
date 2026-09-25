import { isSeedanceTrustedAssetUri, type SeedanceTrustedAssetKind } from './seedanceTrustedAsset.js';
type Task = { id?: string; status?: string; content?: { video_url?: string }; error?: { message?: string } | string };
type FirstFrameInput = { url: string; trustedAssetKind?: SeedanceTrustedAssetKind };

function resolveFirstFrame(input: FirstFrameInput): string {
  const url = String(input.url || '').trim();
  if (/^https:\/\//i.test(url)) return url;
  if (isSeedanceTrustedAssetUri(url)) {
    if (input.trustedAssetKind !== 'image') throw new Error('Seedance asset:// 首帧缺少已核验的图片类型；视频型可信资产不能作为 image_url 首帧');
    return url;
  }
  throw new Error('Seedance 逐句视频需要 HTTPS 目标人物首帧，或状态为 Active 的图片型 asset:// 可信素材');
}
export async function generateSeedanceSentenceVideo(input: { apiKey: string; model: string; baseUrl?: string; imageUrl: string; trustedAssetKind?: SeedanceTrustedAssetKind; prompt: string; duration: number; ratio: string; pollMs?: number; timeoutMs?: number; transport?: typeof fetch; onSubmitted?: (taskId: string) => Promise<void> | void }): Promise<{ taskId: string; videoUrl: string }> {
  if (!input.apiKey.trim()) throw new Error('Seedance 未配置方舟 API Key');
  const imageUrl = resolveFirstFrame({ url: input.imageUrl, trustedAssetKind: input.trustedAssetKind });
  const fetcher = input.transport || fetch; const base = (input.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '');
  const request = async (url: string, init?: RequestInit) => { const response = await fetcher(url, { ...init, headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json', ...(init?.headers || {}) }, signal: AbortSignal.timeout(45_000) }); const value = await response.json().catch(() => ({})) as Task & { message?: string }; if (!response.ok) throw new Error(`Seedance ${response.status}: ${typeof value.error === 'string' ? value.error : value.error?.message || value.message || response.statusText}`); return value; };
  const created = await request(`${base}/contents/generations/tasks`, { method: 'POST', body: JSON.stringify({ model: input.model,
    content: [{ type: 'text', text: input.prompt }, { type: 'image_url', image_url: { url: imageUrl }, role: 'first_frame' }],
    ratio: input.ratio, duration: Math.max(4, Math.min(15, Math.ceil(input.duration))), resolution: '720p', generate_audio: true, watermark: false }) });
  if (!created.id) throw new Error('Seedance 提交结果未知：未返回任务 ID，不能自动重试');
  await input.onSubmitted?.(created.id);
  const deadline = Date.now() + (input.timeoutMs || 600_000);
  while (Date.now() < deadline) { const task = await request(`${base}/contents/generations/tasks/${encodeURIComponent(created.id)}`); const status = String(task.status || '').toLowerCase();
    if (['succeeded','success','completed','done'].includes(status)) { if (!task.content?.video_url) throw new Error('Seedance 任务完成但没有视频地址'); return { taskId: created.id, videoUrl: task.content.video_url }; }
    if (['failed','error','expired','cancelled','canceled'].includes(status)) throw new Error(typeof task.error === 'string' ? task.error : task.error?.message || `Seedance ${status}`);
    await new Promise(resolve => setTimeout(resolve, input.pollMs || 8000)); }
  throw new Error('Seedance 逐句视频任务超时；请核对原任务，不要重复提交');
}

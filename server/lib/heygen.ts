/** HeyGen v3 adapter. Never retries a generation with a different idempotency key. */
export interface HeyGenInput { avatarId: string; voiceId: string; script: string; ratio: string; transparent: boolean; title: string; audioAssetId?: string; audioRef?: { url: string; start: number; duration: number }; engine?: 'avatar_iv' | 'avatar_v'; motionPrompt?: string; expressiveness?: 'low' | 'medium' | 'high' }
export class HeyGenClient {
  constructor(private key: string, private transport: typeof fetch = fetch) {}
  private async call(path: string, body?: unknown, requestId?: string) {
    if (!this.key) throw new Error('尚未配置 HEYGEN_API_KEY');
    const response = await this.transport(`https://api.heygen.com/v3/videos${path}`, {
      method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(45000),
      headers: { 'x-api-key': this.key, 'Content-Type': 'application/json', ...(requestId ? { 'Idempotency-Key': requestId } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json() as { data?: Record<string, any>; error?: { code?: string; message?: string } };
    if (!response.ok || value.error) throw new Error(`HeyGen ${response.status}: ${value.error?.code || 'request_failed'}`);
    if (!value.data) throw new Error('HeyGen未返回有效任务数据');
    return value.data;
  }
  async create(input: HeyGenInput, requestId: string): Promise<string> {
    if (!input.avatarId || !input.voiceId || !input.script.trim()) throw new Error('数字人、声音和台词不能为空');
    const motionPrompt = input.motionPrompt?.trim().slice(0, 300);
    const expressiveness = input.expressiveness && ['low', 'medium', 'high'].includes(input.expressiveness) ? input.expressiveness : undefined;
    const data = await this.call('', { type: 'avatar', avatar_id: input.avatarId, ...(input.audioAssetId ? { audio_asset_id: input.audioAssetId } : { voice_id: input.voiceId, script: input.script }),
      aspect_ratio: input.ratio, resolution: '720p', title: input.title, output_format: input.transparent ? 'webm' : 'mp4',
      ...(input.engine ? { engine: { type: input.engine } } : {}), ...(motionPrompt ? { motion_prompt: motionPrompt } : {}), ...(expressiveness ? { expressiveness } : {}) }, requestId);
    if (typeof data.video_id !== 'string') throw new Error('提交结果未知：未返回video_id，请检查供应商任务，不要重复付费提交');
    return data.video_id;
  }
  async reconcile(title: string, createdAt: string): Promise<{ id: string; status: string }[]> {
    const data = await this.call('?limit=50');
    if (!Array.isArray(data)) return [];
    const expected = Date.parse(createdAt) / 1000;
    return data.flatMap((item: any) => {
      const id = String(item?.id || item?.video_id || '');
      const created = Number(item?.created_at);
      return id && item?.title === title && Number.isFinite(created) && Math.abs(created - expected) <= 600
        ? [{ id, status: String(item.status || 'pending') }]
        : [];
    });
  }
  async uploadAudio(bytes: Uint8Array, requestId: string): Promise<string> {
    if (!this.key || !bytes.length || bytes.length > 32 * 1024 * 1024) throw new Error('音频不可用或超过32MB');
    const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), 'shot.wav');
    const response = await this.transport('https://api.heygen.com/v3/assets', { method: 'POST', body: form, signal: AbortSignal.timeout(45000), headers: { 'x-api-key': this.key, 'Idempotency-Key': requestId } });
    const value = await response.json() as { data?: { asset_id?: string } };
    if (!response.ok || !value.data?.asset_id) throw new Error(`HeyGen音频上传失败 (${response.status})`);
    return value.data.asset_id;
  }
  async status(id: string): Promise<{ status: 'pending' | 'completed' | 'failed'; url?: string; duration?: number; error?: string }> {
    const data = await this.call(`/${encodeURIComponent(id)}`);
    if (data.status === 'completed') {
      if (typeof data.video_url !== 'string' || !(Number(data.duration) > 0)) throw new Error('生成完成但缺少可用视频或时长');
      return { status: 'completed', url: data.video_url, duration: Number(data.duration) };
    }
    if (data.status === 'failed') return { status: 'failed', error: String(data.failure_code || '供应商生成失败') };
    return { status: 'pending' };
  }
}

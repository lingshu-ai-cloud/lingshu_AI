import type { PresenterLook, PresenterPage, PresenterVoice } from '../../src/lib/presenterAssets.js';

export function mediaUrl(value: unknown): string | undefined {
  try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
export function presenterLook(value: any): PresenterLook {
  if (!value || typeof value.id !== 'string') throw new Error('人物接口未返回有效形象');
  const w = Number(value.image_width), h = Number(value.image_height);
  return { id: value.id, name: String(value.name || '企业人物'), groupId: value.group_id || undefined,
    voiceId: value.default_voice_id || undefined, imageUrl: mediaUrl(value.preview_image_url), videoUrl: mediaUrl(value.preview_video_url),
    orientation: w > 0 && h > 0 ? (w === h ? 'square' : w > h ? 'landscape' : 'portrait') : 'unknown', status: value.status || 'completed' };
}

/** Defaults to public assets. Private catalogs require an explicit tenant binding in the router. */
export class HeyGenPresenterClient {
  constructor(private key: string, private transport: typeof fetch = fetch) {}
  async call(route: string, body?: unknown, requestId?: string, timeoutMs = 60000): Promise<any> {
    if (!this.key) throw new Error('管理员尚未配置 HeyGen 服务密钥');
    const form = body instanceof FormData;
    const readOnly = body === undefined;
    let response: Response | undefined;
    for (let attempt = 0; attempt < (readOnly ? 3 : 1); attempt += 1) {
      try {
        response = await this.transport(`https://api.heygen.com/v3/${route}`, {
          method: readOnly ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
          headers: { 'x-api-key': this.key, ...(!form ? { 'Content-Type': 'application/json' } : {}), ...(requestId ? { 'Idempotency-Key': requestId } : {}) },
          ...(readOnly ? {} : { body: form ? body : JSON.stringify(body) }),
        });
        if (!readOnly || ![502, 503, 504].includes(response.status) || attempt === 2) break;
      } catch (error) {
        if (attempt < 2 && readOnly) {
          await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
          continue;
        }
        if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new Error(route === 'assets' ? 'HeyGen 素材上传超时，请保持文件不变后重试' : 'HeyGen 请求超时，请稍后刷新原任务');
        throw new Error('HeyGen 网络连接失败，请稍后刷新原任务');
      }
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
    if (!response) throw new Error('HeyGen 网络连接失败，请稍后刷新原任务');
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.error) {
      const hint = response.status === 401 ? '密钥无效或已过期' : response.status === 403 ? '当前账号未开通此接口权限' : response.status === 429 ? '调用频率受限，请稍后刷新' : '请求失败';
      throw new Error(`HeyGen ${response.status}：${hint}`);
    }
    if (!result || !('data' in result)) throw new Error('HeyGen 返回结果不完整，请刷新原任务核实');
    return result;
  }
  async looks(token = '', ownership: 'public' | 'private' = 'public'): Promise<PresenterPage<PresenterLook>> {
    const result = await this.call(`avatars/looks?ownership=${ownership}&limit=50${token ? `&token=${encodeURIComponent(token)}` : ''}`);
    if (!Array.isArray(result.data)) throw new Error('人物列表格式异常');
    return { items: result.data.map(presenterLook), nextToken: result.has_more ? String(result.next_token || '') : '' };
  }
  async voices(token = '', language = ''): Promise<PresenterPage<PresenterVoice>> {
    const result = await this.call(`voices?type=public&limit=100${token ? `&token=${encodeURIComponent(token)}` : ''}${language ? `&language=${encodeURIComponent(language)}` : ''}`);
    if (!Array.isArray(result.data)) throw new Error('声音列表格式异常');
    return { items: result.data.map((v: any) => ({ id: String(v.voice_id), name: String(v.name), language: String(v.language || ''), previewUrl: mediaUrl(v.preview_audio_url) })), nextToken: result.has_more ? String(result.next_token || '') : '' };
  }
  async upload(bytes: Buffer, mime: string, requestId: string): Promise<string> {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }[mime];
    if (!ext || !bytes.length || bytes.length > 200 * 1024 * 1024) throw new Error('请上传 200MB 以内的 JPG、PNG、MP4、MOV 或 WebM 文件');
    const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), `presenter.${ext}`);
    const result = await this.call('assets', form, requestId, 180000);
    if (!result.data?.asset_id) throw new Error('素材上传结果未知，请重新选择文件');
    return String(result.data.asset_id);
  }
  async create(type: 'photo' | 'digital_twin', name: string, assetId: string, requestId: string) {
    return (await this.call('avatars', { type, name, file: { type: 'asset_id', asset_id: assetId } }, requestId)).data;
  }
  async group(id: string) { return (await this.call(`avatars/${encodeURIComponent(id)}`)).data; }
  async look(id: string) { return presenterLook((await this.call(`avatars/looks/${encodeURIComponent(id)}`)).data); }
  async groupLooks(id: string): Promise<PresenterLook[]> {
    const result = await this.call(`avatars/looks?group_id=${encodeURIComponent(id)}&limit=50`);
    if (!Array.isArray(result.data)) throw new Error('人物形象列表格式异常');
    return result.data.map(presenterLook);
  }
  async consent(groupId: string, requestId: string, assetId?: string) {
    return (await this.call(`avatars/${encodeURIComponent(groupId)}/consent`, assetId ? { consent_video: { type: 'asset_id', asset_id: assetId } } : {}, requestId)).data;
  }
}

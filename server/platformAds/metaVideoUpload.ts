import { createHash } from 'node:crypto';
import { AdProviderError, MetaAdsAdapter, metaAccountId } from './metaAdapter.js';

/** Product limit, not a claim about Meta's maximum upload size. */
export const MAX_META_VIDEO_BYTES = 64 * 1024 * 1024;
export async function collectVerifiedVideo(body: AsyncIterable<Uint8Array>, size: number, sha256: string): Promise<Uint8Array> {
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_META_VIDEO_BYTES || !/^[a-f0-9]{64}$/.test(sha256)) throw new AdProviderError('素材大小或指纹无效（最大 64 MiB）', 'INVALID_MEDIA');
  const bytes = new Uint8Array(size);
  let offset = 0;
  const hash = createHash('sha256');
  for await (const chunk of body) {
    if (offset + chunk.byteLength > size) throw new AdProviderError('素材大小已变化', 'MEDIA_CHANGED');
    bytes.set(chunk, offset); offset += chunk.byteLength; hash.update(chunk);
  }
  if (offset !== size || hash.digest('hex') !== sha256) throw new AdProviderError('素材内容已变化，请重新绑定', 'MEDIA_CHANGED');
  return bytes;
}

/** Contract verified against Meta's official Business SDK adaccount.py / videostatus.py. */
export class MetaVideoUploadAdapter {
  constructor(private token: string, private transport: typeof fetch = fetch, private beforeWrite: () => Promise<void> = async () => {}) {}
  async upload(accountId: string, bytes: Uint8Array): Promise<string> {
    if (!bytes.byteLength || bytes.byteLength > MAX_META_VIDEO_BYTES) throw new AdProviderError('素材大小无效', 'INVALID_MEDIA');
    const version = process.env.META_ADS_API_VERSION;
    if (!version || !/^v\d+\.0$/.test(version)) throw new AdProviderError('请配置 META_ADS_API_VERSION', 'NOT_CONFIGURED');
    const url = `https://graph.facebook.com/${version}/act_${metaAccountId(accountId)}/advideos`;
    const form = new FormData();
    form.set('source', new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }), 'creative.mp4');
    await this.beforeWrite();
    let response: Response;
    try { response = await this.transport(url, { method: 'POST', headers: { Authorization: `Bearer ${this.token}` }, body: form, signal: AbortSignal.timeout(120_000), redirect: 'error' }); }
    catch { throw new AdProviderError('素材上传结果未知，请核对回执，禁止重复上传', 'NETWORK_ERROR', true); }
    let data: any;
    try { data = await response.json(); } catch { throw new AdProviderError('素材上传返回无法解析', 'INVALID_RESPONSE', true); }
    if (!response.ok || data.error) throw new AdProviderError('平台拒绝素材上传', 'UPLOAD_REJECTED', response.status >= 500 || response.status === 408);
    if (!/^\d+$/.test(String(data.id || ''))) throw new AdProviderError('上传结果缺少视频 ID', 'INVALID_RESPONSE', true);
    return String(data.id);
  }
  async status(videoId: string): Promise<'ready' | 'processing' | 'failed' | 'unknown'> {
    if (!/^\d+$/.test(videoId)) throw new AdProviderError('视频 ID 无效', 'INVALID_INPUT');
    const data = await new MetaAdsAdapter(this.token, this.transport).request(videoId, { fields: 'id,status' });
    if (String(data.id) !== videoId) throw new AdProviderError('视频状态回执不匹配', 'INVALID_RESPONSE');
    const state = data.status?.video_status;
    return state === 'ready' ? 'ready' : state === 'processing' ? 'processing' : state === 'error' ? 'failed' : 'unknown';
  }
}

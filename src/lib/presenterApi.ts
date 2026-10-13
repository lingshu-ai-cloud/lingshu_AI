import { authHeader } from './auth';
import type { ArkPresenterPreparation, PresenterCapabilities, PresenterCreation, PresenterLook, PresenterPage, PresenterVoice } from './presenterAssets';
import type { ProductionDefaults } from './shotProduction';
import { notifyAssistantStateInvalidated } from './assistantStateInvalidation';
const root = '/api/overseas/studio/production/presenters';
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(root + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => null);
  if (!data) throw new Error(`人物服务暂时未返回有效响应 (${response.status})，请刷新后重试`);
  if (!response.ok) throw new Error(data.error || '人物服务请求失败');
  if (body !== undefined) notifyAssistantStateInvalidated({ domain: 'presenter-assets', source: path });
  return data;
}
export const presenterApi = {
  capabilities: () => request<PresenterCapabilities>('/capabilities'),
  catalog: (token = '', scope: 'public' | 'private' = 'public') => request<PresenterPage<PresenterLook>>(`/catalog?token=${encodeURIComponent(token)}&scope=${scope}`),
  syncFavorites: () => request<{ defaults: ProductionDefaults; favoriteCount: number; importedCount: number; skippedWithoutVoice: number; capacityReached: boolean }>('/favorites/sync', {}),
  voices: (token = '', language = '', scope: 'public' | 'private' = 'public') => request<PresenterPage<PresenterVoice>>(`/voices?token=${encodeURIComponent(token)}&language=${encodeURIComponent(language)}&scope=${scope}`),
  async cloneVoice(file: File | Blob, name: string, language: string, requestId: string): Promise<{ id: string; status: string; voiceId: string }> {
    const response = await fetch(`${root}/voices/clones?name=${encodeURIComponent(name)}&language=${encodeURIComponent(language)}&requestId=${encodeURIComponent(requestId)}&consent=true`, {
      method: 'POST', headers: { ...authHeader(), 'Content-Type': file.type || 'audio/webm' }, body: file,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || '音色克隆提交失败');
    return result;
  },
  cloneStatus: (id: string) => request<{ id: string; status: string; error?: string; voice?: PresenterVoice }>(`/voices/clones/${encodeURIComponent(id)}`),
  cloneJobs: () => request<Array<{ id: string; name: string; status: string; voiceId: string; createdAt: string }>>('/voices/clones'),
  bindVoice: (presenterId: string, voiceId: string) => request<{ defaults: ProductionDefaults; voice: PresenterVoice }>('/voices/bind', { presenterId, voiceId, voiceAuthorized: true }),
  creations: () => request<PresenterCreation[]>('/creations'),
  async uploadPhotoMaterial(file: File, name: string): Promise<{ok: boolean; material?: {id: string}; error?: string}> {
    if (!['image/jpeg','image/png'].includes(file.type) || !file.size || file.size > 32 * 1024 * 1024) throw new Error('请选择32MB以内的 JPG 或 PNG 人物照片');
    const response = await fetch(`${root}/photo-materials?mime=${encodeURIComponent(file.type)}&name=${encodeURIComponent(name)}`, {method:'POST', headers:{...authHeader(),'Content-Type':'application/octet-stream'},body:file});
    const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || '人物照片上传失败'); return result;
  },
  uploadStatus: (requestId: string) => request<{ id?: string; status: string; stage: string; error?: string }>(`/uploads/status?requestId=${encodeURIComponent(requestId)}`),
  async upload(file: File, requestId: string, trimSeconds?: 7, frameAtSeconds?: number, trainingVideo = false, onProgress?: (percent: number) => void): Promise<{ id: string; processedDurationSeconds?: number; extractedFrame?: boolean; trainingInfo?: { duration: number; width: number; height: number; fps: number; hasAudio: boolean } }> {
    if (!['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime', 'video/webm'].includes(file.type) || !file.size || file.size > 200 * 1024 * 1024) throw new Error('请选择 200MB 以内的 JPG、PNG、MP4、MOV 或 WebM 文件');
    const url = `${root}/uploads?mime=${encodeURIComponent(file.type)}&requestId=${encodeURIComponent(requestId)}${trimSeconds ? `&trimSeconds=${trimSeconds}` : ''}${frameAtSeconds != null ? `&frameAtSeconds=${frameAtSeconds}` : ''}${trainingVideo ? '&trainingVideo=true' : ''}`;
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.timeout = 420_000;
      for (const [key, value] of Object.entries({ ...authHeader(), 'Content-Type': 'application/octet-stream' })) xhr.setRequestHeader(key, value);
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100)); };
      xhr.upload.onload = () => onProgress?.(100);
      xhr.onload = () => {
        let data;
        try { data = JSON.parse(xhr.responseText); } catch { reject(new Error('人物素材服务未返回有效结果，请保持文件不变后核对原请求')); return; }
        if (xhr.status < 200 || xhr.status >= 300) reject(new Error(data.error || `人物素材上传失败 (${xhr.status})`));
        else resolve(data);
      };
      xhr.ontimeout = () => reject(new Error('人物素材上传等待超时，尚未提交人物创建。请保持名称和文件不变后重试，以核对原上传请求'));
      xhr.onerror = () => reject(new Error('人物素材上传连接中断，尚未提交人物创建。请保持名称和文件不变后核对原上传请求'));
      xhr.send(file);
    });
  },
  create: (body: { name: string; type: 'photo' | 'digital_twin'; voiceId?: string; uploadId: string; requestId: string; authorized: boolean; adultConfirmed: boolean; confirmed: boolean; reusePresenterId?: string; samePersonConfirmed?: boolean; arkPreparation?: ArkPresenterPreparation }) => request<PresenterCreation>('/creations', body),
  refresh: (id: string) => request<PresenterCreation>(`/creations/${encodeURIComponent(id)}/refresh`, {}),
  consent: (id: string, requestId: string, uploadId?: string, rerouteUrl?: string) => request<PresenterCreation>(`/creations/${encodeURIComponent(id)}/consent`, { requestId, uploadId, rerouteUrl }),
  import: (body: { lookId?: string; creationId?: string; name?: string; voiceId?: string; reviewed: boolean; authorized?: boolean; makeDefault?: boolean }) => request<ProductionDefaults>('/import', body),
  revoke: (presenterId: string) => request<ProductionDefaults>('/revoke', { presenterId }),
};

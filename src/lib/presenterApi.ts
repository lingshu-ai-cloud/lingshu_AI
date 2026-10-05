import { authHeader } from './auth';
import type { PresenterCapabilities, PresenterCreation, PresenterLook, PresenterPage, PresenterVoice } from './presenterAssets';
import type { ProductionDefaults } from './shotProduction';
const root = '/api/overseas/studio/production/presenters';
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(root + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => null);
  if (!data) throw new Error('当前服务尚未接入历史人物绑定接口');
  if (!response.ok) throw new Error(data.error || '人物服务请求失败');
  return data;
}
export const presenterApi = {
  capabilities: () => request<PresenterCapabilities>('/capabilities'),
  catalog: (token = '', scope: 'public' | 'private' = 'public') => request<PresenterPage<PresenterLook>>(`/catalog?token=${encodeURIComponent(token)}&scope=${scope}`),
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
  async upload(file: File, requestId: string, trimSeconds?: 7, frameAtSeconds?: number, trainingVideo = false): Promise<{ id: string; processedDurationSeconds?: number; extractedFrame?: boolean; trainingInfo?: { duration: number; width: number; height: number; fps: number; hasAudio: boolean } }> {
    if (!['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime', 'video/webm'].includes(file.type) || !file.size || file.size > 200 * 1024 * 1024) throw new Error('请选择 200MB 以内的 JPG、PNG、MP4、MOV 或 WebM 文件');
    const response = await fetch(`${root}/uploads?mime=${encodeURIComponent(file.type)}&requestId=${encodeURIComponent(requestId)}${trimSeconds ? `&trimSeconds=${trimSeconds}` : ''}${frameAtSeconds != null ? `&frameAtSeconds=${frameAtSeconds}` : ''}${trainingVideo ? '&trainingVideo=true' : ''}`, { method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/octet-stream' }, body: file });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `人物素材上传失败 (${response.status})`);
    return data;
  },
  create: (body: { name: string; type: 'photo' | 'digital_twin'; voiceId?: string; uploadId: string; requestId: string; authorized: boolean; confirmed: boolean; reusePresenterId?: string; samePersonConfirmed?: boolean }) => request<PresenterCreation>('/creations', body),
  refresh: (id: string) => request<PresenterCreation>(`/creations/${encodeURIComponent(id)}/refresh`, {}),
  consent: (id: string, requestId: string, uploadId?: string) => request<PresenterCreation>(`/creations/${encodeURIComponent(id)}/consent`, { requestId, uploadId }),
  import: (body: { lookId?: string; creationId?: string; name?: string; voiceId?: string; authorized: boolean; reviewed: boolean }) => request<ProductionDefaults>('/import', body),
};

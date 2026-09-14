import { adminFetch } from '../storage/pb.js';
import { createFilePlaybackUrl } from '../storage/files.js';

export interface CloudMaterialRecord extends Record<string, unknown> { id: string; videoFile?: string; posterFile?: string }

const PLAYBACK_URL_CACHE_TTL_MS = 45_000;
const playbackUrlCache = new Map<string, { url: string; expiresAt: number }>();
const playbackUrlRequests = new Map<string, Promise<string | null>>();

async function resolveCloudMaterialPlaybackUrl(
  id: string,
  field: 'videoFile' | 'posterFile',
  tenantId?: string,
  forceRefresh = false,
): Promise<string | null> {
  const cacheKey = `${tenantId || 'unscoped'}:${id}:${field}`;
  if (forceRefresh) playbackUrlCache.delete(cacheKey);
  const cached = playbackUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const pending = playbackUrlRequests.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    const response = await adminFetch(`/api/collections/materials/records/${encodeURIComponent(id)}`);
    if (!response.ok) return null;
    const record = await response.json() as CloudMaterialRecord;
    if (tenantId && !canAccessCloudMaterial(record, tenantId)) return null;
    const filename = String(record[field] || '');
    if (!filename) return null;
    const url = await createFilePlaybackUrl('materials', id, filename);
    if (url) playbackUrlCache.set(cacheKey, { url, expiresAt: Date.now() + PLAYBACK_URL_CACHE_TTL_MS });
    return url;
  })().finally(() => playbackUrlRequests.delete(cacheKey));
  playbackUrlRequests.set(cacheKey, request);
  return request;
}

function materialTenantId(item: Record<string, unknown>): string {
  return String(item.tenantId || item.tenant_id || '').trim();
}

function canAccessCloudMaterial(item: Record<string, unknown>, tenantId: string): boolean {
  const scope = String(item.scope || 'own');
  return scope === 'shared' || Boolean(tenantId && materialTenantId(item) === tenantId);
}

export type MaterialSourceStatus = { source: 'server' | 'database'; state: 'ready' | 'unavailable' | 'unauthorized'; message: string };
export async function readCloudMaterialLibrary(tenantId: string, request: typeof adminFetch = adminFetch): Promise<{ items: Array<Record<string, unknown>>; source: MaterialSourceStatus }> {
  try {
    const rows: CloudMaterialRecord[] = [];
    const signal = AbortSignal.timeout(8000);
    for (let page = 1; ; page++) {
      const response = await request(`/api/collections/materials/records?perPage=500&page=${page}`, { signal });
      if (!response.ok) return { items: [], source: { source: 'database', state: [401,403].includes(response.status) ? 'unauthorized' : 'unavailable',
        message: [401,403].includes(response.status) ? '素材数据库访问权限异常，请联系管理员' : '素材数据库暂时不可用，请重试' } };
      const data = await response.json() as { items?: CloudMaterialRecord[]; totalPages?: number };
      if (!Array.isArray(data.items)) throw Error('invalid_material_response');
      rows.push(...data.items.filter(item => canAccessCloudMaterial(item, tenantId)));
      if (page >= Number(data.totalPages || 1)) break;
      if (page >= 100) throw Error('material_pagination_limit');
    }
    const items = rows.map(item => ({
      id: `pb-${item.id}`, name: String(item.title || item.sourceName || item.name || '云端素材'),
      folder: String(item.folder || 'upload'), type: String(item.type || 'video'), duration: Number(item.duration || 0),
      size: humanSize(Number(item.sizeBytes || 0)), file: String(item.videoFile || ''),
      url: `/studio-media/${item.id}/media.mp4`, poster: `/studio-media/${item.id}/poster.jpg`,
      scope: String(item.scope || 'own'), tenantId: materialTenantId(item), usage: String(item.usage || 'editable'),
      sourceType: String(item.sourceType || 'licensed_upload'), sourceUrl: String(item.sourceUrl || ''),
      productId: String(item.productId || ''), productName: String(item.productName || ''),
      licenseEvidence: String(item.licenseEvidence || item.license || ''),
      industry: String(item.industry || ''), shotFunction: String(item.shotFunction || ''),
      applicability: String(item.applicability || ''), tags: String(item.tags || ''),
      createdAt: String(item.created || ''), updatedAt: String(item.updated || ''),
      analysisSourceRevision: String(item.analysisSourceRevision || ''), sourceRevision: String(item.sha256 || item.videoFile || ''),
      pinned: Boolean(item.pinned), segmentAnalysisStatus: item.segmentAnalysisStatus ? String(item.segmentAnalysisStatus) : undefined,
      segmentAnalysisError: item.segmentAnalysisError ? String(item.segmentAnalysisError) : undefined,
      visualObservations: parseSegments(item.visualObservations), segments: parseSegments(item.segments),
    }));
    return { items, source: { source: 'database', state: 'ready', message: '素材数据库已连接' } };
  } catch {
    return { items: [], source: { source: 'database', state: 'unavailable', message: '素材数据库连接失败，当前仅能使用已读取的服务端素材；请重试或联系管理员' } };
  }
}
/** Legacy consumers retain the array API; user-facing inventory uses the status envelope. */
export async function listCloudMaterials(tenantId: string): Promise<Array<Record<string, unknown>>> {
  return (await readCloudMaterialLibrary(tenantId)).items;
}

export async function getCloudMaterialRecord(id: string, tenantId?: string): Promise<Record<string, unknown> | null> {
  const response = await adminFetch(`/api/collections/materials/records/${encodeURIComponent(id)}`);
  if (!response.ok) return null;
  const record = await response.json() as Record<string, unknown>;
  return tenantId && !canAccessCloudMaterial(record, tenantId) ? null : record;
}

/** 写操作只能落在当前租户自己的私有素材上；共享素材对普通租户只读。 */
export async function getOwnedCloudMaterialRecord(id: string, tenantId: string): Promise<Record<string, unknown> | null> {
  const response = await adminFetch(`/api/collections/materials/records/${encodeURIComponent(id)}`);
  if (!response.ok) return null;
  const record = await response.json() as Record<string, unknown>;
  return String(record.scope || 'own') !== 'shared' && materialTenantId(record) === tenantId ? record : null;
}

export async function updateCloudMaterial(id: string, fields: Record<string, unknown>): Promise<boolean> {
  const response = await adminFetch(`/api/collections/materials/records/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return response.ok;
}

/** PocketBase 的 json 字段可能回传数组本身，也可能回传字符串，两种都要接住。 */
function parseSegments(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function fetchCloudMaterial(id: string, field: 'videoFile' | 'posterFile', range?: string, tenantId?: string): Promise<Response | null> {
  let url = await resolveCloudMaterialPlaybackUrl(id, field, tenantId);
  if (!url) return null;
  let upstream = await fetch(url, { headers: range ? { Range: range } : undefined });
  if (upstream.status === 401 || upstream.status === 403) {
    url = await resolveCloudMaterialPlaybackUrl(id, field, tenantId, true);
    if (!url) return null;
    upstream = await fetch(url, { headers: range ? { Range: range } : undefined });
  }
  return upstream.ok ? upstream : null;
}

function humanSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

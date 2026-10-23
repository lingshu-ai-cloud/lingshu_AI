import type { AdSourceCatalog, AdSourceEntry, AdSourceIdentity, AdSourceLifecycle } from '../../shared/adSourceLifecycle.js';
import { store } from '../storage/index.js';
import { AD_CREATIVES_COLLECTION, listPlatformAdCreativeSources, resolveAdCreativeSource, PlatformAdCreativeError, type StoredPlatformAdCreative } from './creatives.js';
import { getPlatformAdTask } from './tasks.js';
import { listAllAdExecutions } from './execution.js';
import { getConnection } from './connections.js';
import { getMetaPerformanceReport } from './metaPerformance.js';
import { AdProviderError } from './metaAdapter.js';
import { externalHistoryLifecycle, listExternalHistory } from './externalHistory.js';
type Project = { id: string; tenant_id: string; title: string; status: string; spec: unknown; created_at: string };
const obj = (v: unknown): Record<string, any> => { if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return {}; } } return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {}; };
const id = (v: unknown) => { if (typeof v !== 'string' || !/^[\w-]{1,200}$/.test(v)) throw new PlatformAdCreativeError('来源标识无效'); return v; };
export function parseAdSourceIdentity(query: Record<string, unknown>): AdSourceIdentity {
  if (query.origin === 'studio' && query.sourceId !== undefined && Object.keys(query).every(k => ['origin', 'sourceId', 'projectId'].includes(k))) return { origin: 'studio', sourceId: id(query.sourceId), projectId: id(query.projectId) };
  if (query.origin === 'studio' && Object.keys(query).every(k => ['origin', 'projectId'].includes(k))) return { origin: 'studio', projectId: id(query.projectId) };
  if (query.origin === 'social' && Object.keys(query).every(k => ['origin', 'sourceTaskId', 'artifactId'].includes(k))) return { origin: 'social', sourceTaskId: id(query.sourceTaskId), artifactId: id(query.artifactId) };
  throw new PlatformAdCreativeError('来源查询无效');
}
async function socialSource(tenantId: string, sourceTaskId: string, artifactId: string): Promise<AdSourceEntry> {
  const file = await resolveAdCreativeSource(tenantId, sourceTaskId, artifactId);
  return { origin: 'social', key: `social:${sourceTaskId}:${artifactId}`, sourceTaskId, artifactId, name: file.name, status: '已保存视频版本', createdAt: '', sha256: file.sha256, verifiedSource: true, note: '直接引用已保存社媒成片；未复制或上传' };
}
async function projectSource(tenantId: string, p: Project): Promise<AdSourceEntry> {
  if (p.tenant_id !== tenantId) throw new PlatformAdCreativeError('未找到历史素材', 404);
  const spec = obj(p.spec), lineage = obj(spec.socialProductionOutput);
  const base: AdSourceEntry = { origin: 'studio', key: `studio:${p.id}`, projectId: p.id, name: p.title, status: p.status, createdAt: p.created_at, sha256: '', verifiedSource: false, note: '历史项目尚无可验证的社媒成片版本关联；不按标题、URL 或客户端 SHA 猜测广告归属。' };
  if (obj(spec.automation).managedBy !== 'social_content_output' || lineage.type !== 'social_production_artifact' || lineage.version !== 1 || lineage.taskId !== spec.socialContentTaskId || lineage.fileSha256 !== spec.renderOutputSha256) return base;
  const source = await socialSource(tenantId, id(lineage.taskId), id(lineage.artifactId));
  if (source.sha256 !== lineage.fileSha256) throw new PlatformAdCreativeError('历史素材版本与持久化成片不一致', 409);
  return { ...base, sourceTaskId: source.sourceTaskId, artifactId: source.artifactId, sha256: source.sha256, verifiedSource: true, note: '已核验 Studio → 社媒成片 → 投放绑定；数据只读同一版本' };
}
export async function listAdSourceCatalog(tenantId: string, query: Record<string, unknown>): Promise<AdSourceCatalog> {
  if (Object.keys(query).some(k => !['origin', 'page', 'perPage', 'sourceId'].includes(k)) || !['studio', 'social'].includes(String(query.origin))) throw new PlatformAdCreativeError('来源目录查询无效');
  const page = Math.min(100000, Math.max(1, Math.floor(Number(query.page) || 1))), perPage = Math.min(50, Math.max(1, Math.floor(Number(query.perPage) || 20)));
  if (query.sourceId !== undefined) {
    if (query.origin !== 'studio') throw new PlatformAdCreativeError('外部历史来源仅支持项目目录');
    return listExternalHistory(tenantId, id(query.sourceId), page, perPage);
  }
  if (query.origin === 'social') {
    const result = await listPlatformAdCreativeSources(tenantId, { page, perPage });
    return { ...result, items: result.items.map(s => ({ ...s, origin: 'social', key: `social:${s.sourceTaskId}:${s.artifactId}`, status: '已保存视频版本', createdAt: '', verifiedSource: true, note: '已保存社媒成片；按源任务、版本与 SHA 关联' })) };
  }
  const result = await store.list<Project>('studio_projects', { where: { tenant_id: tenantId }, page, perPage, sort: '-created_at' });
  const items: AdSourceEntry[] = [];
  for (const p of result.items) {
    if (p.tenant_id !== tenantId) throw new PlatformAdCreativeError('历史素材归属异常', 503);
    if (p.status === 'template') continue;
    try { items.push(await projectSource(tenantId, p)); }
    catch { items.push({ origin: 'studio', projectId: p.id, key: `studio:${p.id}`, name: p.title, status: p.status, createdAt: p.created_at, sha256: '', verifiedSource: false, note: '源版本当前无法核验；不把读取失败解释为未投放，请在详情重试。' }); }
  }
  return { items, page, perPage, totalItems: result.totalItems, totalPages: result.totalPages };
}
export async function getAdSourceLifecycle(tenantId: string, identity: AdSourceIdentity): Promise<AdSourceLifecycle> {
  if (identity.sourceId !== undefined) {
    if (identity.origin !== 'studio') throw new PlatformAdCreativeError('来源查询无效');
    return externalHistoryLifecycle(tenantId, id(identity.sourceId), id(identity.projectId));
  }
  let source: AdSourceEntry;
  if (identity.origin === 'studio') {
    const p = await store.getById<Project>('studio_projects', id(identity.projectId));
    if (!p || p.tenant_id !== tenantId) throw new PlatformAdCreativeError('未找到历史素材', 404);
    source = await projectSource(tenantId, p);
  } else source = await socialSource(tenantId, id(identity.sourceTaskId), id(identity.artifactId));
  const result: AdSourceLifecycle = { source, checkedAt: '', truncated: false, bindingCount: 0, ads: [], roi: null, crmInquiries: null, scopeNote: '本系统已记录绑定与已核验广告的 Meta maximum 可用历史，不是全账户/无限历史。Meta lead、消息会话不是 CRM 有效询盘；购买 ROAS 不是利润 ROI。未接通订单利润与去重 CRM 归因，ROI/有效询盘不计算；跨币种/账户不汇总。查询只读且受平台权限、延迟及缓存影响。' };
  if (source.verifiedSource) {
    const bindings = await store.list<StoredPlatformAdCreative>(AD_CREATIVES_COLLECTION, { where: { tenant_id: tenantId, sourceTaskId: id(source.sourceTaskId), artifactId: id(source.artifactId) }, perPage: 200 });
    result.truncated = bindings.totalPages > 1; result.bindingCount = bindings.totalItems;
    const seen = new Set<string>();
    for (const b of bindings.items) {
      if (b.tenant_id !== tenantId || b.sha256 !== source.sha256) throw new PlatformAdCreativeError('投放素材源版本不一致', 409);
      const task = await getPlatformAdTask(tenantId, b.taskId), connection = await getConnection(tenantId, b.connectionId);
      if (!task || connection.provider !== 'meta') continue;
      const receipts = await listAllAdExecutions(tenantId, b.taskId);
      for (const r of receipts.filter(r => r.action === 'create' && r.status === 'VERIFIED' && r.connectionId === b.connectionId)) {
        const ids = obj(r.result);
        if (ids.creativeBindingId !== b.id && b.uploadReceipt?.mappingExecutionId !== r.id) continue;
        const key = `${connection.accountId}:${ids.adId}`; if (seen.has(key)) continue; seen.add(key);
        if (result.ads.length >= 20) { result.truncated = true; continue; }
        const entry: AdSourceLifecycle['ads'][number] = { executionId: r.id, taskId: b.taskId, taskName: task.name, accountId: connection.accountId, adId: String(ids.adId), mapping: ids.creativeBindingId === b.id ? '创建时绑定' : '投放后核对映射', report: null, error: '' };
        try {
          if (b.status !== 'ready' || b.uploadReceipt?.status !== 'ready' || b.uploadReceipt?.sha256 !== source.sha256 || b.uploadReceipt?.accountId !== connection.accountId || b.uploadReceipt?.videoId !== b.platformVideoId) throw new PlatformAdCreativeError('素材上传证据不一致', 409);
          const report = await getMetaPerformanceReport(tenantId, r.id, { level: 'ad', preset: 'maximum' });
          if (report.videoId !== b.platformVideoId || report.accountId !== connection.accountId) throw new PlatformAdCreativeError('平台视频或账户与源映射不一致', 409);
          entry.report = report;
        } catch (error) { entry.error = `Meta 生命周期报告读取失败：${error instanceof PlatformAdCreativeError || error instanceof AdProviderError ? error.message : '暂不可用，请重试'}；不能视为零投放。`; }
        result.ads.push(entry);
      }
    }
  }
  result.checkedAt = new Date().toISOString(); return result;
}

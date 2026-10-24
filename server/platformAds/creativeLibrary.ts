import type { AdCreativeLibraryItem, AdCreativeLibraryPage, AdCreativeReport, AdCreativePreview } from '../../shared/platformAdCreativeLibrary.js';
import { store } from '../storage/index.js';
import { getConnectionCredential, getConnection } from './connections.js';
import { AD_CREATIVES_COLLECTION, getPlatformAdCreative, publicPlatformAdCreative, type StoredPlatformAdCreative, PlatformAdCreativeError } from './creatives.js';
import { listAdExecutions } from './execution.js';
import { PLATFORM_AD_TASKS_COLLECTION, type PlatformAdTask } from './tasks.js';
import { MetaAdsAdapter } from './metaAdapter.js';
import { creativeReadCache } from './creativeReadCache.js';
import { getMetaPerformanceReport } from './metaPerformance.js';
export { readExecutedCreative } from './executedCreative.js';
const cachedPreview = creativeReadCache<AdCreativePreview>(300_000);

export async function listAdCreativeLibrary(tenantId: string, query: { page?: unknown; perPage?: unknown; taskId?: unknown }): Promise<AdCreativeLibraryPage> {
  const page = Math.min(100000, Math.max(1, Math.floor(Number(query.page) || 1))), perPage = Math.min(50, Math.max(1, Math.floor(Number(query.perPage) || 20)));
  if (query.taskId !== undefined && (typeof query.taskId !== 'string' || !/^[\w-]{1,200}$/.test(query.taskId))) throw new PlatformAdCreativeError('计划标识无效');
  const selected = query.taskId ? await store.getById<PlatformAdTask & { tenant_id: string }>(PLATFORM_AD_TASKS_COLLECTION, String(query.taskId)) : null;
  if (query.taskId && (!selected || selected.tenant_id !== tenantId)) throw new PlatformAdCreativeError('未找到投放计划', 404);
  const tasks = selected
    ? { items: page === 1 ? [selected] : [], totalItems: 1, totalPages: 1 }
    : await store.list<PlatformAdTask & { tenant_id: string }>(PLATFORM_AD_TASKS_COLLECTION, { where: { tenant_id: tenantId }, page, perPage, sort: '-createdAt' });
  const items: AdCreativeLibraryItem[] = [];
  let truncated = false;
  for (const task of tasks.items) {
    if (task.tenant_id !== tenantId) throw new PlatformAdCreativeError('素材计划归属异常', 503);
    const bindings = await store.list<StoredPlatformAdCreative>(AD_CREATIVES_COLLECTION, { where: { tenant_id: tenantId, taskId: task.id }, perPage: 200 });
    const receipts = await listAdExecutions(tenantId, task.id);
    truncated ||= bindings.totalPages > 1;
    const used = new Set<string>();
    const append = async (binding: StoredPlatformAdCreative | null, receipt: typeof receipts[number] | null) => {
      const connection = await getConnection(tenantId, binding?.connectionId || receipt!.connectionId);
      const ids = (receipt?.result || {}) as Record<string, string>;
      items.push({ key: receipt?.id || binding!.id,
        task: { id: task.id, name: task.name, goal: task.goal, version: task.version, status: task.status, materialSource: task.configuration?.materialSource },
        connection: { id: connection.id, accountId: connection.accountId, name: connection.name, currency: connection.currency, provider: connection.provider },
        binding: binding ? publicPlatformAdCreative(binding) : null,
        execution: receipt ? { id: receipt.id, campaignId: ids.campaignId, adsetId: ids.adsetId, creativeId: ids.creativeId, adId: ids.adId } : null,
        mapping: !receipt ? 'local_only' : !binding ? 'platform_only' : ids.creativeBindingId === binding.id ? 'creation_binding' : 'verified_existing',
      });
    };
    for (const receipt of receipts.filter(r => r.action === 'create' && r.status === 'VERIFIED')) {
      const ids = (receipt.result || {}) as Record<string, string>;
      if (!ids.campaignId || !ids.adsetId || !ids.creativeId || !ids.adId) continue;
      const binding = bindings.items.find(b => b.tenant_id === tenantId && b.connectionId === receipt.connectionId && (b.id === ids.creativeBindingId || b.uploadReceipt?.mappingExecutionId === receipt.id)) || null;
      if (binding) used.add(binding.id);
      await append(binding, receipt);
    }
    for (const binding of bindings.items) if (binding.tenant_id === tenantId && !used.has(binding.id)) {
      const selected = task.configuration?.materialSource;
      if (selected === null) continue;
      // An old local binding must not claim to be the current draft's newly selected source.
      if (selected && (selected.sourceTenantId !== tenantId || selected.sha256 !== binding.sha256 || selected.sourceTaskId !== binding.sourceTaskId || selected.artifactId !== binding.artifactId)) continue;
      await append(binding, null);
    }
  }
  return { items, page, perPage, totalItems: tasks.totalItems, totalPages: tasks.totalPages, truncated };
}

export async function getAdCreativeReport(tenantId: string, executionId: string): Promise<AdCreativeReport> {
  // Reuse the exact same native report/cache as the data page, never sum daily ratios.
  const r = await getMetaPerformanceReport(tenantId, executionId, { level: 'ad', preset: '7' });
  const resultKey = r.optimizationGoal === 'THRUPLAY' ? 'thruPlays' : r.optimizationGoal === 'LINK_CLICKS' ? 'linkClicks' : null;
  const costKey = resultKey === 'thruPlays' ? 'costPerThruPlay' : resultKey === 'linkClicks' ? 'costPerLinkClick' : null;
  return { source: 'provider', scope: 'ad', adId: r.resourceId, accountId: r.accountId, videoId: r.videoId, pageId: r.pageId,
    configuredStatus: r.configuredStatus, effectiveStatus: r.effectiveStatus, issues: r.issues,
    currency: r.currency, reportTimezone: r.reportTimezone, reportedAt: r.reportedAt, window: r.window,
    actionReportTime: r.actionReportTime, useUnifiedAttributionSetting: r.useUnifiedAttributionSetting, attributionSpec: r.attributionSpec,
    metricLabel: resultKey === 'thruPlays' ? 'ThruPlay' : resultKey === 'linkClicks' ? '链接点击' : `未映射优化目标 ${r.optimizationGoal || '未返回'}`,
    spend: r.totals?.spend ?? null, impressions: r.totals?.impressions ?? null, clicks: r.totals?.clicks ?? null,
    results: resultKey ? r.totals?.[resultKey] ?? null : null, costPerResult: costKey ? r.totals?.[costKey] ?? null : null,
    daily: r.daily.map(d => ({ date: d.date, spend: d.spend, impressions: d.impressions, clicks: d.clicks, results: resultKey ? d[resultKey] : null })) };
}

export async function getAdCreativePreview(tenantId: string, bindingId: string): Promise<AdCreativePreview> {
  return cachedPreview(tenantId, bindingId, () => readAdCreativePreview(tenantId, bindingId));
}
async function readAdCreativePreview(tenantId: string, bindingId: string): Promise<AdCreativePreview> {
  const binding = await getPlatformAdCreative(tenantId, bindingId);
  if (!binding) throw new PlatformAdCreativeError('未找到素材绑定', 404);
  const { connection, accessToken } = await getConnectionCredential(tenantId, binding.connectionId);
  if (connection.provider !== 'meta' || binding.status !== 'ready' || binding.uploadReceipt?.status !== 'ready' || binding.uploadReceipt?.sha256 !== binding.sha256 || binding.uploadReceipt?.accountId !== connection.accountId || binding.uploadReceipt?.videoId !== binding.platformVideoId) throw new PlatformAdCreativeError('缺少有效的视频上传回执', 409);
  const video = await new MetaAdsAdapter(accessToken).request(binding.platformVideoId, { fields: 'id,status,picture,thumbnails,length' });
  if (String(video.id) !== binding.platformVideoId) throw new PlatformAdCreativeError('视频回执不匹配', 409);
  const thumb = video.thumbnails?.data?.find((t: any) => t.is_preferred) || video.thumbnails?.data?.[0];
  const url = String(thumb?.uri || video.picture || '');
  try { const parsed = new URL(url); if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error(); } catch { throw new PlatformAdCreativeError('平台封面暂不可用', 409); }
  return { videoId: binding.platformVideoId, thumbnailUrl: url, width: Number(thumb?.width) > 0 ? Number(thumb.width) : null, height: Number(thumb?.height) > 0 ? Number(thumb.height) : null, duration: Number(video.length) > 0 ? Number(video.length) : null, videoStatus: String(video.status?.video_status || 'unknown'), checkedAt: new Date().toISOString() };
}

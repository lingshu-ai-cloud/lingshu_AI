import type { AdCreativeLibraryItem, AdCreativeLibraryPage, AdCreativeReport, AdCreativePreview } from '../../shared/platformAdCreativeLibrary.js';
import { store } from '../storage/index.js';
import { getConnectionCredential, getConnection } from './connections.js';
import { AD_CREATIVES_COLLECTION, getPlatformAdCreative, publicPlatformAdCreative, type StoredPlatformAdCreative, PlatformAdCreativeError } from './creatives.js';
import { AD_EXECUTIONS, type AdExecution, listAdExecutions } from './execution.js';
import { getPlatformAdTask, PLATFORM_AD_TASKS_COLLECTION, type PlatformAdTask } from './tasks.js';
import { MetaAdsAdapter } from './metaAdapter.js';
import { aggregateAdMetrics } from './metrics.js';
import { creativeReadCache } from './creativeReadCache.js';
import { readMetaVideoPlan } from './metaPlanReadback.js';
const cachedReport = creativeReadCache<AdCreativeReport>(60_000);
const cachedPreview = creativeReadCache<AdCreativePreview>(300_000);

export async function listAdCreativeLibrary(tenantId: string, query: { page?: unknown; perPage?: unknown }): Promise<AdCreativeLibraryPage> {
  const page = Math.min(100000, Math.max(1, Math.floor(Number(query.page) || 1))), perPage = Math.min(50, Math.max(1, Math.floor(Number(query.perPage) || 20)));
  const tasks = await store.list<PlatformAdTask & { tenant_id: string }>(PLATFORM_AD_TASKS_COLLECTION, { where: { tenant_id: tenantId }, page, perPage, sort: '-createdAt' });
  const items: AdCreativeLibraryItem[] = [];
  let truncated = false;
  for (const task of tasks.items) {
    if (task.tenant_id !== tenantId) throw new PlatformAdCreativeError('素材计划归属异常', 503);
    const bindings = await store.list<StoredPlatformAdCreative>(AD_CREATIVES_COLLECTION, { where: { tenant_id: tenantId, taskId: task.id }, perPage: 200 });
    const receipts = await listAdExecutions(tenantId, task.id);
    truncated ||= bindings.totalPages > 1 || receipts.length >= 200;
    const used = new Set<string>();
    const append = async (binding: StoredPlatformAdCreative | null, receipt: typeof receipts[number] | null) => {
      const connection = await getConnection(tenantId, binding?.connectionId || receipt!.connectionId);
      const ids = (receipt?.result || {}) as Record<string, string>;
      items.push({ key: receipt?.id || binding!.id,
        task: { id: task.id, name: task.name, goal: task.goal, version: task.version, status: task.status },
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
    for (const binding of bindings.items) if (binding.tenant_id === tenantId && !used.has(binding.id)) await append(binding, null);
  }
  return { items, page, perPage, totalItems: tasks.totalItems, totalPages: tasks.totalPages, truncated };
}

export async function readExecutedCreative(tenantId: string, executionId: string) {
  const receipt = await store.getById<AdExecution>(AD_EXECUTIONS, executionId);
  if (!receipt || receipt.tenant_id !== tenantId) throw new PlatformAdCreativeError('未找到广告创建回执', 404);
  if (receipt.action !== 'create' || receipt.status !== 'VERIFIED') throw new PlatformAdCreativeError('广告尚未核验完成', 409);
  const task = await getPlatformAdTask(tenantId, receipt.taskId);
  if (!task) throw new PlatformAdCreativeError('未找到投放计划', 404);
  const { connection, accessToken } = await getConnectionCredential(tenantId, receipt.connectionId);
  if (connection.provider !== 'meta' || connection.currency !== task.currency) throw new PlatformAdCreativeError('当前仅支持同币种 Meta 广告素材核对', 409);
  const ids = (receipt.result || {}) as Record<string, string>;
  if (!['campaignId', 'adsetId', 'creativeId', 'adId'].every(k => /^\d+$/.test(ids[k] || ''))) throw new PlatformAdCreativeError('缺少完整广告资源标识', 409);
  const adapter = new MetaAdsAdapter(accessToken);
  const { campaign, adset, ad, creative } = await readMetaVideoPlan(adapter, connection.accountId, ids);
  const videoId = String(creative.object_story_spec?.video_data?.video_id || ''), pageId = String(creative.object_story_spec?.page_id || '');
  if (!/^\d+$/.test(videoId) || !/^\d+$/.test(pageId)) throw new PlatformAdCreativeError('平台创意不是可核对的视频素材', 409);
  return { receipt, task, connection, adapter, ids, campaign, adset, ad, creative, videoId, pageId };
}

export async function getAdCreativeReport(tenantId: string, executionId: string): Promise<AdCreativeReport> {
  return cachedReport(tenantId, executionId, () => readAdCreativeReport(tenantId, executionId));
}
async function readAdCreativeReport(tenantId: string, executionId: string): Promise<AdCreativeReport> {
  const ctx = await readExecutedCreative(tenantId, executionId);
  if (!ctx.connection.timezoneName) throw new PlatformAdCreativeError('账户时区尚未核验', 409);
  const until = new Intl.DateTimeFormat('en-CA', { timeZone: ctx.connection.timezoneName, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const since = new Date(Date.parse(`${until}T12:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  const response = await ctx.adapter.request(`${ctx.ids.adId}/insights`, { fields: 'date_start,date_stop,spend,impressions,clicks,inline_link_clicks,video_thruplay_watched_actions', time_range: { since, until }, time_increment: 1, limit: 100 });
  if (!Array.isArray(response.data) || response.paging?.next) throw new PlatformAdCreativeError('平台素材报告不完整，请稍后重试', 503);
  return { source: 'provider', scope: 'ad', adId: ctx.ids.adId, accountId: ctx.connection.accountId, videoId: ctx.videoId, pageId: ctx.pageId,
    configuredStatus: String(ctx.ad.status || ''), effectiveStatus: String(ctx.ad.effective_status || ''),
    issues: (ctx.ad.issues_info || []).map((i: any) => ({ code: Number(i.error_code), message: String(i.error_summary || '平台广告异常') })),
    currency: ctx.connection.currency, reportTimezone: ctx.connection.timezoneName, reportedAt: new Date().toISOString(), window: { since, until }, ...aggregateAdMetrics(response.data, ctx.task.goal) };
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

import { store } from '../storage/index.js';
import { AD_EXECUTIONS, type AdExecution } from './execution.js';
import { getPlatformAdTask } from './tasks.js';
import { getConnectionCredential, type AdConnection } from './connections.js';
import { decryptSecret } from '../lib/tenantPlatformApps.js';
import { PlatformAdCreativeError } from './creatives.js';
import { MetaAdsAdapter } from './metaAdapter.js';
import { readMetaVideoPlan } from './metaPlanReadback.js';

/** Shared read-only ownership and resource validation for all three workspaces. */
export async function readExecutedCreative(tenantId: string, executionId: string) {
  const receipt = await store.getById<AdExecution>(AD_EXECUTIONS, executionId);
  if (!receipt || receipt.tenant_id !== tenantId) throw new PlatformAdCreativeError('未找到广告创建回执', 404);
  if (receipt.action !== 'create' || receipt.status !== 'VERIFIED') throw new PlatformAdCreativeError('广告尚未核验完成', 409);
  const task = await getPlatformAdTask(tenantId, receipt.taskId);
  if (!task) throw new PlatformAdCreativeError('未找到投放计划', 404);
  const { connection, accessToken } = await getConnectionCredential(tenantId, receipt.connectionId);
  return readExecutedCreativeRecords(tenantId, receipt, task, connection, accessToken);
}
/** Trusted read-only source adapters reuse the same provider ownership checks, not destination resources. */
export async function readExecutedCreativeRecords(tenantId: string, receipt: AdExecution, task: NonNullable<Awaited<ReturnType<typeof getPlatformAdTask>>>, connection: AdConnection, token?: string) {
  if (receipt.tenant_id !== tenantId || connection.tenant_id !== tenantId || receipt.taskId !== task.id || receipt.connectionId !== connection.id
    || receipt.action !== 'create' || receipt.status !== 'VERIFIED') throw new PlatformAdCreativeError('历史广告回执归属或状态不一致', 409);
  const accessToken = token ?? decryptSecret(connection.tokenCipher);
  if (!accessToken) throw new PlatformAdCreativeError('历史来源广告账户授权不可读，不能借用其他企业账户', 409);
  if (connection.provider !== 'meta' || connection.currency !== task.currency) throw new PlatformAdCreativeError('当前仅支持同币种 Meta 广告素材核对', 409);
  const ids = (receipt.result || {}) as Record<string, string>;
  if (!['campaignId', 'adsetId', 'creativeId', 'adId'].every(k => /^\d+$/.test(ids[k] || ''))) throw new PlatformAdCreativeError('缺少完整广告资源标识', 409);
  const adapter = new MetaAdsAdapter(accessToken);
  const { campaign, adset, ad, creative } = await readMetaVideoPlan(adapter, connection.accountId, ids);
  const videoId = String(creative.object_story_spec?.video_data?.video_id || ''), pageId = String(creative.object_story_spec?.page_id || '');
  if (!/^\d+$/.test(videoId) || !/^\d+$/.test(pageId)) throw new PlatformAdCreativeError('平台创意不是可核对的视频素材', 409);
  return { receipt, task, connection, adapter, ids, campaign, adset, ad, creative, videoId, pageId };
}

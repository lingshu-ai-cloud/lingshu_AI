import type { MetaPlanAudit, MetaSetup } from '../../shared/metaPlanAudit.js';
import { getPlatformAdTask } from './tasks.js';
import { listAllAdExecutions } from './execution.js';
import { getConnectionCredential } from './connections.js';
import { MetaAdsAdapter } from './metaAdapter.js';
import { readExecutedCreative } from './creativeLibrary.js';
import { AD_CREATIVES_COLLECTION, PlatformAdCreativeError, validatePlatformAdCreativeSource, type StoredPlatformAdCreative } from './creatives.js';
import { store } from '../storage/index.js';
import { creativeReadCache } from './creativeReadCache.js';
const audits = creativeReadCache<MetaPlanAudit>(60_000), setups = creativeReadCache<MetaSetup>(60_000);
const amount = (v: unknown) => v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) / 100 : null;
export async function getMetaSetup(tenantId: string, connectionId: string): Promise<MetaSetup> {
  return setups(tenantId, connectionId, async () => {
    const { connection, accessToken } = await getConnectionCredential(tenantId, connectionId);
    if (connection.provider !== 'meta') throw new PlatformAdCreativeError('仅支持 Meta 账户', 409);
    const adapter = new MetaAdsAdapter(accessToken), a = await adapter.account(connection.accountId);
    if (String(a.account_id || a.id).replace(/^act_/, '') !== connection.accountId || a.currency !== connection.currency) throw new PlatformAdCreativeError('Meta 账户或币种已变化，请核对连接', 409);
    const response = await adapter.request('me/accounts', { fields: 'id,name,tasks', limit: 100 });
    if (!Array.isArray(response.data)) throw new PlatformAdCreativeError('主页列表读取不完整', 503);
    return { account: { id: connection.accountId, name: String(a.name || connection.name), currency: String(a.currency), timezone: String(a.timezone_name || ''), status: Number(a.account_status), minSpendCap: amount(a.min_campaign_group_spend_cap), minDailyBudget: amount(a.min_daily_budget) }, pages: response.data.filter((p: any) => /^\d+$/.test(String(p.id))).map((p: any) => ({ id: String(p.id), name: String(p.name || p.id), tasks: Array.isArray(p.tasks) ? p.tasks.map(String) : [] })), hasMorePages: !!response.paging?.next };
  });
}
export async function getMetaPlanAudit(tenantId: string, taskId: string): Promise<MetaPlanAudit> {
  return audits(tenantId, taskId, async () => {
    const task = await getPlatformAdTask(tenantId, taskId);
    if (!task) throw new PlatformAdCreativeError('未找到计划', 404);
    const receipts = await listAllAdExecutions(tenantId, taskId);
    const creates = receipts.filter(r => r.action === 'create' && r.status === 'VERIFIED');
    const entries: MetaPlanAudit['entries'] = [];
    for (const receipt of creates.slice(0, 20)) {
      const ctx = await readExecutedCreative(tenantId, receipt.id);
      const a = await ctx.adapter.account(ctx.connection.accountId);
      if (String(a.account_id || a.id).replace(/^act_/, '') !== ctx.connection.accountId || a.currency !== task.currency) throw new PlatformAdCreativeError('Meta 账户或币种已变化', 409);
      const video = ctx.creative.object_story_spec.video_data;
      const bindings = await store.list<StoredPlatformAdCreative>(AD_CREATIVES_COLLECTION, { where: { tenant_id: tenantId, taskId }, perPage: 200 });
      const binding = bindings.items.find(b => b.connectionId === receipt.connectionId && (b.id === ctx.ids.creativeBindingId || b.uploadReceipt?.mappingExecutionId === receipt.id));
      const sourceValid = binding ? await validatePlatformAdCreativeSource(tenantId, binding.id).then(() => true).catch(() => false) : false;
      const checks: MetaPlanAudit['entries'][number]['checks'] = [];
      const check = (name: string, ok: boolean, detail: string) => checks.push({ name, status: ok ? 'pass' : 'mismatch', detail });
      check('账户与层级', true, '四层 ID、账户归属、父子关系与原回执一致');
      check('暂停状态', [ctx.campaign, ctx.adset, ctx.ad].every(r => r.status === 'PAUSED'), '分别检查 Campaign / Ad Set / Ad 配置状态；审核状态独立显示');
      const views = task.goal === '提升有效视频观看';
      check('目标与计费', ['提升网站访问', '提升有效视频观看'].includes(task.goal) && ctx.campaign.objective === (views ? 'OUTCOME_ENGAGEMENT' : 'OUTCOME_TRAFFIC') && ctx.adset.optimization_goal === (views ? 'THRUPLAY' : 'LINK_CLICKS') && ctx.adset.destination_type === (views ? 'ON_VIDEO' : 'WEBSITE') && ctx.adset.billing_event === 'IMPRESSIONS', '不把视频观看当网站转化，也不把展示计费误称点击计费');
      check('广告系列花费限额', amount(ctx.campaign.spend_cap) === task.budget, `本地 ${task.currency} ${task.budget}；Meta ${amount(ctx.campaign.spend_cap) ?? '未返回'}，不是 lifetime_budget`);
      const daily = Number(task.configuration.dailyBudget);
      if (daily > 0) check('广告组日预算', amount(ctx.adset.daily_budget) === daily, `本地 ${daily}；Meta ${amount(ctx.adset.daily_budget) ?? '未返回'}`);
      else checks.push({ name: '广告组日预算', status: 'warning', detail: '本地未保存明确日预算，仅展示 Meta 读回值，不推断为一致' });
      check('本地素材映射', !!binding && sourceValid && binding.taskVersion === task.version && binding.status === 'ready' && binding.platformVideoId === ctx.videoId && binding.uploadReceipt?.status === 'ready' && binding.uploadReceipt?.accountId === ctx.connection.accountId && binding.uploadReceipt?.sha256 === binding.sha256 && binding.uploadReceipt?.videoId === ctx.videoId, '账户、源版本、上传回执、文件指纹和平台视频需一致；补充映射不改原创建证据');
      if (!views) check('网站 CTA', video.call_to_action?.type === 'LEARN_MORE' && /^https:\/\//.test(String(video.call_to_action?.value?.link || '')), '网站访问使用真实 HTTPS 链接；不是询盘/销售转化验证');
      entries.push({ executionId: receipt.id, connectionId: ctx.connection.id, accountId: ctx.connection.accountId, accountName: String(a.name || ctx.connection.name), currency: String(a.currency), timezone: String(a.timezone_name || ''), campaignId: ctx.ids.campaignId, adsetId: ctx.ids.adsetId, creativeId: ctx.ids.creativeId, adId: ctx.ids.adId, issues: (ctx.ad.issues_info || []).map((i: any) => ({ code: Number(i.error_code), message: String(i.error_summary || '平台广告异常') })),
        pageId: ctx.pageId, videoId: ctx.videoId, linkUrl: views ? '' : String(video.call_to_action?.value?.link || ''), objective: String(ctx.campaign.objective || ''), optimizationGoal: String(ctx.adset.optimization_goal || ''), destinationType: String(ctx.adset.destination_type || ''), billingEvent: String(ctx.adset.billing_event || ''), spendCap: amount(ctx.campaign.spend_cap), dailyBudget: amount(ctx.adset.daily_budget), startsAt: String(ctx.adset.start_time || ''), endsAt: String(ctx.adset.end_time || ''), countries: ctx.adset.targeting?.geo_locations?.countries || [], platforms: ctx.adset.targeting?.publisher_platforms || [], campaignStatus: String(ctx.campaign.status || ''), adsetStatus: String(ctx.adset.status || ''), adStatus: String(ctx.ad.status || ''), adEffectiveStatus: String(ctx.ad.effective_status || ''), bindingId: binding?.id || '', sha256: binding?.sha256 || '', mapping: binding ? binding.id === ctx.ids.creativeBindingId ? 'creation_binding' : 'post_execution' : 'unmapped', checks });
    }
    return { taskId, taskVersion: task.version, checkedAt: new Date().toISOString(), entries, pendingCount: receipts.filter(r => ['UNKNOWN', 'EXECUTING', 'PROVIDER_ACCEPTED'].includes(r.status)).length, truncated: creates.length > 20 };
  });
}

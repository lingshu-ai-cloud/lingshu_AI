import { adReceiptState } from '../../shared/adReceiptState.js';
import { META_AD_GOALS, metaAdObjective, isMetaLeadGoal } from '../../shared/metaAdObjectives.js';
import { buildMetaTargeting, metaTargetingMatches } from '../../shared/metaTargeting.js';
import type { MetaPlanAudit, MetaSetup } from '../../shared/metaPlanAudit.js';
import { getPlatformAdTask } from './tasks.js';
import { listAllAdExecutions } from './execution.js';
import { getConnection, getConnectionCredential } from './connections.js';
import { MetaAdsAdapter } from './metaAdapter.js';
import { readExecutedCreative } from './creativeLibrary.js';
import { AD_CREATIVES_COLLECTION, PlatformAdCreativeError, validatePlatformAdCreativeSource, type StoredPlatformAdCreative } from './creatives.js';
import { store } from '../storage/index.js';
import { creativeReadCache } from './creativeReadCache.js';
import { authorizedPages } from './metaAuthorization.js';
const audits = creativeReadCache<MetaPlanAudit>(60_000), setups = creativeReadCache<MetaSetup>(60_000);
const amount = (v: unknown) => v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) / 100 : null;
export async function getMetaSetup(tenantId: string, connectionId: string): Promise<MetaSetup> {
  const current = await getConnection(tenantId, connectionId);
  return setups(tenantId, `${connectionId}:${current.defaultPage?.verifiedAt || ''}`, async () => {
    const { connection, accessToken } = await getConnectionCredential(tenantId, connectionId);
    if (connection.provider !== 'meta') throw new PlatformAdCreativeError('仅支持 Meta 账户', 409);
    const adapter = new MetaAdsAdapter(accessToken), a = await adapter.account(connection.accountId);
    if (String(a.account_id || a.id).replace(/^act_/, '') !== connection.accountId || a.currency !== connection.currency) throw new PlatformAdCreativeError('Meta 账户或币种已变化，请核对连接', 409);
    const pages = await authorizedPages(accessToken, connection.accountId);
    return { defaultPage: connection.defaultPage || null, account: { id: connection.accountId, name: String(a.name || connection.name), currency: String(a.currency), timezone: String(a.timezone_name || ''), status: Number(a.account_status), minSpendCap: amount(a.min_campaign_group_spend_cap), minDailyBudget: amount(a.min_daily_budget) }, pages, hasMorePages: false };
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
      const state = adReceiptState(receipts, receipt.connectionId, ctx.ids.campaignId);
      const actual = [ctx.campaign, ctx.adset, ctx.ad].map(r => r.status || '未知').join(' / ');
      if (state.pending || !state.expected) checks.push({ name: '投放开关状态', status: 'warning', detail: `存在待核对操作或缺少状态依据；平台配置：${actual}。审核状态独立显示。` });
      else check('投放开关状态', [ctx.campaign, ctx.adset, ctx.ad].every(r => r.status === state.expected), `最近已核验操作 ${state.action}，预期 ${state.expected}；Campaign / Ad Set / Ad：${actual}。审核状态独立显示。`);
      const frozen = (receipt.result as { createSnapshot?: { meta?: import('./metaAdapter.js').MetaVideoInput } } | undefined)?.createSnapshot?.meta;
      const frozenChannels = (receipt.result as { createSnapshot?: { channels?: string[] } } | undefined)?.createSnapshot?.channels;
      if (frozen?.targeting && frozenChannels) check('原始人群与版位配置', metaTargetingMatches(ctx.adset.targeting, buildMetaTargeting(frozen.countries, frozenChannels, frozen.targeting)), '按创建快照核对年龄、性别、语言、兴趣、自定义受众和手动版位；不使用后来修改的草稿猜测');
      const spec = metaAdObjective(task.goal, frozen?.messageDestination);
      const views = task.goal === '提升有效视频观看';
      check('目标与计费', (META_AD_GOALS as readonly string[]).includes(task.goal) && ctx.campaign.objective === spec.objective && ctx.adset.optimization_goal === spec.optimizationGoal && ctx.adset.destination_type === spec.destinationType && ctx.adset.billing_event === 'IMPRESSIONS', '不把视频观看当网站转化，也不把展示计费误称点击计费');
      if (isMetaLeadGoal(task.goal)) check('获客资产与创建快照', !!frozen && (task.goal === '获取Meta表单线索' ? String(video.call_to_action?.value?.lead_gen_form_id) === frozen.leadFormId && String(ctx.adset.promoted_object?.page_id) === frozen.pageId : task.goal === '获取独立站询盘' ? String(ctx.adset.promoted_object?.pixel_id) === frozen.pixelId && ctx.adset.promoted_object?.custom_event_type === 'LEAD' : ctx.adset.destination_type === frozen.messageDestination && String(ctx.adset.promoted_object?.page_id) === frozen.pageId && (frozen.messageDestination !== 'WHATSAPP' || String(ctx.adset.promoted_object?.whatsapp_phone_number).replace(/\D/g, '') === frozen.whatsappPhoneNumber?.replace(/\D/g, '')) && (frozen.messageDestination !== 'INSTAGRAM_DIRECT' || String(ctx.adset.promoted_object?.instagram_actor_id) === frozen.instagramActorId)), '按原始执行快照核对表单、Pixel/Lead 或消息目的地，不用当前表单猜测');
      check('广告系列花费限额', amount(ctx.campaign.spend_cap) === task.budget, `本地 ${task.currency} ${task.budget}；Meta ${amount(ctx.campaign.spend_cap) ?? '未返回'}，不是 lifetime_budget`);
      const daily = Number(task.configuration.dailyBudget);
      if (daily > 0) check('广告组日预算', amount(ctx.adset.daily_budget) === daily, `本地 ${daily}；Meta ${amount(ctx.adset.daily_budget) ?? '未返回'}`);
      else checks.push({ name: '广告组日预算', status: 'warning', detail: '本地未保存明确日预算，仅展示 Meta 读回值，不推断为一致' });
      check('本地素材映射', !!binding && sourceValid && binding.taskVersion === task.version && binding.status === 'ready' && binding.platformVideoId === ctx.videoId && binding.uploadReceipt?.status === 'ready' && binding.uploadReceipt?.accountId === ctx.connection.accountId && binding.uploadReceipt?.sha256 === binding.sha256 && binding.uploadReceipt?.videoId === ctx.videoId, '账户、源版本、上传回执、文件指纹和平台视频需一致；补充映射不改原创建证据');
      if (spec.destinationType === 'WEBSITE') check('网站 CTA', video.call_to_action?.type === 'LEARN_MORE' && /^https:\/\//.test(String(video.call_to_action?.value?.link || '')), '网站访问使用真实 HTTPS 链接；不是询盘/销售转化验证');
      entries.push({ targeting: ctx.adset.targeting, executionId: receipt.id, connectionId: ctx.connection.id, accountId: ctx.connection.accountId, accountName: String(a.name || ctx.connection.name), currency: String(a.currency), timezone: String(a.timezone_name || ''), campaignId: ctx.ids.campaignId, adsetId: ctx.ids.adsetId, creativeId: ctx.ids.creativeId, adId: ctx.ids.adId, issues: (ctx.ad.issues_info || []).map((i: any) => ({ code: Number(i.error_code), message: String(i.error_summary || '平台广告异常') })),
        pageId: ctx.pageId, videoId: ctx.videoId, linkUrl: views ? '' : String(video.call_to_action?.value?.link || ''), objective: String(ctx.campaign.objective || ''), optimizationGoal: String(ctx.adset.optimization_goal || ''), destinationType: String(ctx.adset.destination_type || ''), billingEvent: String(ctx.adset.billing_event || ''), spendCap: amount(ctx.campaign.spend_cap), dailyBudget: amount(ctx.adset.daily_budget), startsAt: String(ctx.adset.start_time || ''), endsAt: String(ctx.adset.end_time || ''), countries: ctx.adset.targeting?.geo_locations?.countries || [], platforms: ctx.adset.targeting?.publisher_platforms || [], campaignStatus: String(ctx.campaign.status || ''), adsetStatus: String(ctx.adset.status || ''), adStatus: String(ctx.ad.status || ''), adEffectiveStatus: String(ctx.ad.effective_status || ''), bindingId: binding?.id || '', sha256: binding?.sha256 || '', mapping: binding ? binding.id === ctx.ids.creativeBindingId ? 'creation_binding' : 'post_execution' : 'unmapped', checks });
    }
    return { taskId, taskVersion: task.version, checkedAt: new Date().toISOString(), entries, pendingCount: receipts.filter(r => ['UNKNOWN', 'EXECUTING', 'PROVIDER_ACCEPTED'].includes(r.status)).length, truncated: creates.length > 20 };
  });
}

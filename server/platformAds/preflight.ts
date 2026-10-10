import { store } from '../storage/index.js';
import { getPlatformAdTask } from './tasks.js';
import type { AdConnection } from './connections.js';
import type { AdExecution } from './execution.js';
import { AdProviderError, validateMetaVideoInput } from './metaAdapter.js';
import { validateTikTokVideoPlan } from './tiktokExecutionAdapter.js';
import { demandGenOperations } from './googleExecutionAdapter.js';
import { getPlatformAdCreative } from './creatives.js';
import { adReleasePolicy } from './releasePolicy.js';
import type { AdPreflightCheck, AdPreflightResult } from '../../shared/platformAdPreflight.js';
import { platformAdProposalFactIssue, platformAdProposalFactState } from './factVersion.js';

/** Read-only snapshot. Execution must independently revalidate under its task lease. */
export async function preflightAdAction(tenantId: string, taskId: string, input: Record<string, unknown>): Promise<AdPreflightResult> {
  const task = await getPlatformAdTask(tenantId, taskId);
  if (!task) throw new AdProviderError('未找到投放任务', 'NOT_FOUND');
  const connectionId = String(input.connectionId || ''), action = String(input.action || '');
  const connection = connectionId ? await store.getById<AdConnection>('platform_ad_connections', connectionId) : null;
  if (connectionId && (!connection || connection.tenant_id !== tenantId)) throw new AdProviderError('未找到广告账户连接', 'NOT_FOUND');
  const checks: AdPreflightCheck[] = [];
  const check = (id: string, label: string, ok: boolean, good: string, bad: string) => checks.push({ id, label, status: ok ? 'pass' : 'blocked', message: ok ? good : bad });
  const warning = (id: string, label: string, message: string) => checks.push({ id, label, status: 'warning', message });
  check('source', '计划来源', task.creationSource !== 'platform_import', '本地计划可进入执行检查', '导入计划仅支持查看，尚未建立可执行资源绑定');
  check('version', '计划版本', Number(input.expectedVersion) === task.version, '计划版本一致', '计划已变化，请刷新后重新预检');
  check('action', '执行动作', ['create', 'activate', 'pause', 'resume', 'adjust_budget'].includes(action), '动作有效', '不支持该投放动作');
  if (task.proposal && action !== 'pause') {
    const factState = await platformAdProposalFactState(tenantId, task);
    check(
      'enterprise_fact_version',
      '企业事实版本',
      factState.status === 'current',
      'AI 方案与当前企业事实版本一致',
      platformAdProposalFactIssue(factState),
    );
  }
  check('management', '控制模式', task.managementMode === 'manual', '人工控制模式', '请先人工接管；本预检不代替审批或托管执行授权');
  if (task.managementMode !== 'manual') {
    const grant = task.authorization;
    check('authorization', '已保存授权', !!grant && Number.isFinite(Date.parse(grant.expiresAt)) && Date.parse(grant.expiresAt) > Date.now() && grant.accountIds.includes(connectionId) && grant.allowedActions.includes(action as any) && task.budget <= grant.maxTotalBudget, '授权范围和有效期满足本地检查，仍须走对应执行流程', '授权缺失、过期或账户、动作、总预算超出授权');
  }
  // Read every receipt: a recent-page limit must not hide an older unresolved operation.
  const receipts: AdExecution[] = [];
  for (let page = 1; ; page++) {
    const records = await store.list<AdExecution>('platform_ad_executions', { where: { tenant_id: tenantId, taskId }, page, perPage: 200 });
    receipts.push(...records.items);
    if (page >= records.totalPages) break;
  }
  check('reconciliation', '执行回执', !receipts.some(r => ['EXECUTING', 'PROVIDER_ACCEPTED', 'UNKNOWN'].includes(r.status)), '没有待核对操作', '存在待核对操作，请先完成对账，不能重新创建');
  if (action === 'create') check('duplicate', '重复创建', !receipts.some(r => r.action === 'create' && r.status !== 'FAILED'), '尚无成功或未确定的创建记录', '此计划已有创建记录，请管理现有广告或新建独立预算计划');
  check('connection', '账户本地状态', !!connection && connection.status === 'connected' && !!connection.tokenCipher, '已保存连接和凭据；尚未在线验证', '请选择已连接且已保存凭据的广告账户');
  if (connection) {
    const provider = connection.provider, policy = adReleasePolicy();
    if (input.creativeId !== undefined && input.creativeId !== '') check('creative_binding_scope', '绑定素材执行范围', typeof input.creativeId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(input.creativeId) && provider === 'meta' && action === 'create' && task.managementMode === 'manual', '绑定素材用于 Meta 人工创建', '绑定标识无效，或不属于 Meta 人工创建流程');
    check('release', '执行开放范围', policy.executionProviders.includes(provider) && policy.allowedActions.includes(action), '动作在当前发布策略开放范围内', policy.reason);
    check('provider', '平台动作能力', provider === 'meta' || (['tiktok', 'google'].includes(provider) && ['create', 'activate', 'pause', 'resume'].includes(action)), '平台支持此人工动作', '平台不支持此动作');
    check('currency', '账户与预算币种', task.currency === connection.currency && (provider === 'meta' ? ['USD', 'CNY'].includes(connection.currency) : connection.currency === 'USD'), '币种一致且支持执行', '币种不一致或尚不支持该币种执行');
    check('budget', '计划预算', Number.isFinite(task.budget) && task.budget > 0, '计划预算有效', '计划预算必须为正数');
    if (action === 'create') {
      const allowed = provider === 'meta' ? ['提升网站访问', '提升有效视频观看'].includes(task.goal) && task.channels.length > 0 && task.channels.every(c => ['Facebook', 'Instagram'].includes(c)) : provider === 'tiktok' ? task.goal === '提升有效视频观看' && task.channels.length === 1 && task.channels[0] === 'TikTok' : provider === 'google' && task.goal === '获取线索或转化' && task.channels.length === 1 && task.channels[0] === 'YouTube';
      check('objective', '平台目标与渠道', allowed, '目标与渠道组合受支持', '目标或跨平台渠道组合不受当前适配器支持，请建立独立平台计划');
      try {
        if (provider === 'meta') {
          let meta = input.meta;
          if (input.creativeId) {
            const binding = await getPlatformAdCreative(tenantId, String(input.creativeId));
            if (!binding || binding.taskId !== taskId || binding.taskVersion !== task.version || binding.connectionId !== connectionId || binding.provider !== 'meta' || binding.status !== 'ready') throw new AdProviderError('素材绑定不存在、版本变化、账户不符或尚未就绪');
            const receipt = binding.uploadReceipt;
            if (!/^\d+$/.test(binding.platformVideoId) || receipt?.videoId !== binding.platformVideoId || receipt?.sha256 !== binding.sha256 || receipt?.accountId !== connection.accountId || receipt?.status !== 'ready') throw new AdProviderError('平台视频上传回执尚未核验就绪');
            const supplied = input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta) ? input.meta as Record<string, unknown> : {};
            if (supplied.videoId && supplied.videoId !== binding.platformVideoId) throw new AdProviderError('表单视频与绑定成片不一致，请重新选择成片');
            meta = { ...supplied, videoId: binding.platformVideoId };
            warning('source_integrity', '本地源素材完整性', '本次仅检查绑定及上传回执；执行时仍会复核源素材绑定，实际上传字节已由上传流程验证。');
          }
          validateMetaVideoInput(meta, task.budget, task.goal === '提升有效视频观看');
        }
        else if (provider === 'tiktok') {
          const raw = input.tiktok as Record<string, unknown> || {};
          validateTikTokVideoPlan({ advertiserId: connection.accountId, name: task.name, totalBudget: task.budget, ...task.configuration, identityId: String(raw.identityId || ''), tiktokItemId: String(raw.tiktokItemId || ''), locationIds: Array.isArray(raw.locationIds) ? raw.locationIds.map(String) : [], adText: String(raw.adText || '').slice(0, 100) });
        } else if (provider === 'google') {
          const raw = input.google as Record<string, unknown> || {};
          demandGenOperations({ customerId: connection.accountId, name: task.name, totalBudget: task.budget, targetCpa: Number(raw.targetCpa), startDate: task.configuration.startsAt.slice(0, 10), endDate: task.configuration.endsAt.slice(0, 10), videoAssetId: String(raw.videoAssetId || ''), logoAssetId: String(raw.logoAssetId || ''), finalUrl: String(raw.finalUrl || ''), businessName: String(raw.businessName || ''), headline: String(raw.headline || ''), longHeadline: String(raw.longHeadline || ''), description: String(raw.description || ''), locationIds: Array.isArray(raw.locationIds) ? raw.locationIds.map(String) : [] });
          warning('account_timezone', '账户时区', 'Google 排期仍须在执行时读取账户时区后验证');
        } else throw new AdProviderError('平台素材适配尚未开放');
        check('creative', '素材与创编参数', true, '平台素材 ID 与输入格式通过本地校验；未验证素材在线可用性', '');
      } catch (error) { check('creative', '素材与创编参数', false, '', error instanceof AdProviderError ? error.message : '素材或创编参数不完整'); }
    } else {
      const resourceId = String(input.resourceId || '');
      const prior = receipts.find(r => r.action === 'create' && r.connectionId === connectionId && r.resourceId === resourceId && r.status === 'VERIFIED');
      const resources = prior?.result as Record<string, unknown> | undefined;
      const validResourceId = provider === 'google' ? /^customers\/\d{10}\/campaigns\/\d+$/.test(resourceId) && resourceId.startsWith(`customers/${connection.accountId}/campaigns/`) : /^\d+$/.test(resourceId);
      check('resource', '已有资源绑定', validResourceId && !!resources?.adId && !!resources?.[provider === 'meta' ? 'adsetId' : 'adgroupId'] && (provider === 'meta' || !!resources?.campaignId), '已关联核验过的创建资源', '缺少当前计划与账户的完整已核验资源');
      if (action === 'adjust_budget') check('daily_budget', '调整预算', Number.isFinite(Number(input.dailyBudget)) && Number(input.dailyBudget) >= 1 && Number(input.dailyBudget) <= task.budget, '日预算在计划预算范围内', '日预算必须在计划预算范围内且至少为 1');
    }
  }
  if (['create', 'activate', 'resume'].includes(action)) {
    const { startsAt, endsAt } = task.configuration;
    const valid = (v: string) => /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
    const required = action === 'create' && connection?.provider !== 'meta';
    check('schedule', '投放排期', (!required || (!!startsAt && !!endsAt)) && (!startsAt || valid(startsAt)) && (!endsAt || (valid(endsAt) && Date.parse(endsAt) > Date.now())) && (!startsAt || !endsAt || Date.parse(endsAt) > Date.parse(startsAt)) && (action !== 'create' || !startsAt || Date.parse(startsAt) > Date.now()), '本地排期有效', '排期缺失、已过期、时区无效或结束时间早于开始时间');
  }
  warning('local_only', '预检范围', '仅检查本地保存状态与输入，不解密令牌、不访问平台、不写入数据；未验证在线权限、素材可用性、平台预算和广告审核。通过不代表授权投放，执行时仍会重新校验。');
  return { taskId, taskVersion: task.version, connectionId, action, scope: 'local', checkedAt: new Date().toISOString(), canSubmit: !checks.some(c => c.status === 'blocked'), checks };
}

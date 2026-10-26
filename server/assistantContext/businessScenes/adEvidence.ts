import { getPlatformAdTask, listPlatformAdTasks } from '../../platformAds/tasks.js';
import { listConnections } from '../../platformAds/connections.js';
import { listAllAdExecutions } from '../../platformAds/execution.js';
import { listAdApprovals } from '../../platformAds/approvals.js';
import { listAdLaunches } from '../../platformAds/launch.js';
import { listPlatformAdCreatives } from '../../platformAds/creatives.js';
import { getAdTaskMetricHistory } from '../../platformAds/metricSnapshots.js';
import { getMetaPerformanceReport } from '../../platformAds/metaPerformance.js';
import type { BusinessSceneSelection } from '../../../shared/contracts/assistantBusinessScene.js';
import { BusinessSceneError, object, pick } from './readScope.js';
export const adSceneOptions = async (tenantId: string) => (await listPlatformAdTasks(tenantId)).map(t => ({ id: t.id, label: t.name }));
export const adReaders = { task: getPlatformAdTask, connections: (tenant: string) => listConnections(tenant, true), executions: listAllAdExecutions, approvals: (tenant: string, task: string) => listAdApprovals(tenant, task, true), launches: (tenant: string, task: string) => listAdLaunches(tenant, task, true), creatives: (tenant: string, task: string) => listPlatformAdCreatives(tenant, task, true), history: getAdTaskMetricHistory, report: getMetaPerformanceReport };
export async function adSceneEvidence(tenantId: string, selection: BusinessSceneSelection, read = adReaders) {
  if (!selection.adTaskId) {
    if (['AD-01', 'AD-06'].includes(selection.sceneId)) throw new BusinessSceneError('scene_ad_required', 400, '请选择投放计划。');
    const accounts = await read.connections(tenantId);
    return { referenceTask: null, accounts: accounts.map(c => pick(c, ['id', 'provider', 'name', 'currency', 'status'])), rules: '这是新计划的建议草案，仅有企业资料和已连接账号证据；尚未选择历史计划，不得编造历史成效、预算或受众。先询问缺失目标和预算，不创建或启动投放。' };
  }
  const task = await read.task(tenantId, selection.adTaskId);
  if (!task) throw new BusinessSceneError('scene_ad_not_found', 404, '所选投放计划不可访问。');
  const [connections, executions, approvals, launches, creatives, history] = await Promise.all([
    read.connections(tenantId), read.executions(tenantId, task.id), read.approvals(tenantId, task.id), read.launches(tenantId, task.id), read.creatives(tenantId, task.id), read.history(tenantId, task.id, selection.from, selection.to),
  ]);
  const creates = executions.filter(e => e.action === 'create' && e.status === 'VERIFIED');
  if (creates.length > 20) throw new BusinessSceneError('scene_ad_scope_large', 422, '计划关联的广告较多，请到投流页按广告筛选后查看。');
  const reports = await Promise.all(creates.map(async execution => {
    const account = connections.find(c => c.id === execution.connectionId);
    if (account?.provider !== 'meta') return { executionId: execution.id, state: 'unsupported', note: '当前多层报告适配仅支持Meta；其他渠道保留已有快照，不外推广告组或素材表现。' };
    const levels = await Promise.all((['campaign', 'adset', 'ad'] as const).map(async level => {
      try { return { level, state: 'available', report: await read.report(tenantId, execution.id, { level, preset: 'custom', since: selection.from, until: selection.to }) }; }
      catch { return { level, state: 'unavailable', errorCode: 'scene_ad_report_unavailable', note: '平台报告未核验成功，不能把缺失视为零。请到投流页核对授权与资源状态。' }; }
    }));
    return { executionId: execution.id, levels };
  }));
  return { task: { ...pick(task, ['id', 'version', 'name', 'goal', 'market', 'budget', 'currency', 'status', 'managementMode', 'updatedAt']), configuration: pick(object(task.configuration), ['startsAt', 'endsAt', 'dailyBudget', 'audience', 'placements', 'accountConnectionId']), authorization: pick(object(task.authorization), ['version', 'status', 'expiresAt', 'maxTotalBudget', 'maxDailyBudget']) },
    accounts: connections.map(c => ({ ...pick(c, ['id', 'provider', 'accountId', 'name', 'currency', 'status', 'updatedAt', 'timezoneName', 'resourceSyncedAt']), authorization: pick(object(c.authorization), ['status', 'expiresAt', 'lastCheckedAt', 'revokedAt']) })),
    executions: executions.map(e => pick(e, ['id', 'action', 'status', 'connectionId', 'resourceId', 'createdAt'])),
    approvals: approvals.map(a => pick(a, ['id', 'taskVersion', 'status', 'createdAt', 'expiresAt', 'updatedAt'])),
    launches: launches.map(a => pick(object(a), ['id', 'status', 'createdAt', 'updatedAt'])),
    creatives: creatives.map(c => pick(object(c), ['id', 'title', 'name', 'status', 'sourceTaskId', 'updatedAt'])), history, reports,
    rules: '历史快照不触发同步写入；实时平台报告由原授权和资源归属适配器核验。计划、广告组、广告层级及不同币种/归因口径不得相加；缺失不补零。仅给分析与待确认草案，不创建计划、调价、启停或重复提交。' };
}

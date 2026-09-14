import { store } from '../storage/index.js';
import { adReleasePolicy } from './releasePolicy.js';
import { getPlatformAdTask, withPlatformAdTaskLock, PlatformAdTaskValidationError, PlatformAdTaskConflictError, type PlatformAdTask } from './tasks.js';
import { getConnectionCredential } from './connections.js';
import { MetaAdsAdapter } from './metaAdapter.js';
import { listAdExecutions, executeAutomaticAdAction } from './execution.js';
import { runAdLaunchesOnce } from './launch.js';

export const AD_AUTOMATION_RULES = 'platform_ad_automation_rules';
export const AD_AUTOMATION_RUNS = 'platform_ad_automation_runs';
export type AdAutomationRule = { id: string; tenant_id: string; taskId: string; connectionId: string; resourceId: string; targetCpc: number; minClicks: number; cooldownMinutes: number; maxMetricAgeMinutes: number; enabled: boolean; updatedAt: string };
export type AdAutomationMetrics = { clicks: number; spend: number; lifetimeSpend: number; dailyBudget: number; fetchedAt: string; status: string };
type Decision = { action: 'pause' | 'adjust_budget'; dailyBudget?: number; reason: string } | { action: null; reason: string };

export function decideAdOptimization(task: PlatformAdTask, rule: AdAutomationRule, metrics: AdAutomationMetrics, lastActionAt?: string, now = Date.now()): Decision {
  if (task.goal !== '提升网站访问') return { action: null, reason: '当前规则仅适用于网站访问目标' };
  const auth = task.authorization;
  if (task.managementMode !== 'managed' || !auth || Date.parse(auth.expiresAt) <= now) return { action: null, reason: '托管未启用或授权已过期' };
  const age = now - Date.parse(metrics.fetchedAt);
  if (!Number.isFinite(age) || age < 0 || age > rule.maxMetricAgeMinutes * 60_000 || ![metrics.clicks, metrics.spend, metrics.lifetimeSpend, metrics.dailyBudget].every(value => Number.isFinite(value) && value >= 0)) return { action: null, reason: '数据过期或指标无效，停止优化' };
  if (metrics.status !== 'ACTIVE') return { action: null, reason: '计划未启用，保持当前状态' };
  // Total ceiling has priority over sample and cooldown guards.
  if (metrics.lifetimeSpend >= auth.maxTotalBudget) return auth.allowedActions.includes('pause') ? { action: 'pause', reason: '累计消耗达到授权总预算' } : { action: null, reason: '达到总预算但未授权暂停，需要人工处理' };
  if (lastActionAt && now - Date.parse(lastActionAt) < rule.cooldownMinutes * 60_000) return { action: null, reason: '处于动作冷却期' };
  if (metrics.clicks < rule.minClicks) return { action: null, reason: '点击样本不足，继续观察' };
  const cpc = metrics.spend / metrics.clicks;
  if (cpc > rule.targetCpc * 2 && auth.allowedActions.includes('pause')) return { action: 'pause', reason: '点击成本超过目标两倍，触发止损' };
  if (!auth.allowedActions.includes('adjust_budget') || !auth.maxAdjustmentPercent) return { action: null, reason: '未授权预算调整' };
  const direction = cpc < rule.targetCpc * 0.8 ? 1 : cpc > rule.targetCpc * 1.2 ? -1 : 0;
  if (!direction) return { action: null, reason: '点击成本处于目标容忍区间' };
  const step = Math.min(auth.maxAdjustmentPercent, 10) / 100;
  const next = Math.round(Math.min(auth.maxDailyBudget, auth.maxTotalBudget - metrics.lifetimeSpend, metrics.dailyBudget * (1 + direction * step)) * 100) / 100;
  if (next < 1 || Math.abs(next - metrics.dailyBudget) < 0.01 || Math.abs(next - metrics.dailyBudget) / metrics.dailyBudget > auth.maxAdjustmentPercent / 100 + 1e-8) return { action: null, reason: '剩余额度或单次调整边界限制，需人工处理' };
  return { action: 'adjust_budget', dailyBudget: next, reason: direction > 0 ? '点击成本优于目标，逐步扩量' : '点击成本高于目标，降低预算' };
}

export async function listAdAutomationRules(tenantId: string, taskId: string) {
  return (await store.list<AdAutomationRule>(AD_AUTOMATION_RULES, { where: { tenant_id: tenantId, taskId }, perPage: 200 })).items;
}
export async function saveAdAutomationRule(tenantId: string, taskId: string, input: Record<string, unknown>) {
  return withPlatformAdTaskLock(tenantId, taskId, async () => {
    const task = await getPlatformAdTask(tenantId, taskId);
    if (!task) throw new PlatformAdTaskValidationError('未找到投放任务');
    if (task.goal !== '提升网站访问') throw new PlatformAdTaskValidationError('当前 CPC 优化规则仅适用于网站访问目标');
    if (input.expectedVersion !== task.version) throw new PlatformAdTaskConflictError('计划已更新，请刷新后重试');
    const connectionId = String(input.connectionId || ''), resourceId = String(input.resourceId || '');
    const receipts = await listAdExecutions(tenantId, taskId);
    if (!receipts.some(r => r.action === 'create' && r.status === 'VERIFIED' && r.connectionId === connectionId && r.resourceId === resourceId)) throw new PlatformAdTaskValidationError('请先创建并关联真实广告计划');
    const targetCpc = Number(input.targetCpc), minClicks = Number(input.minClicks ?? 30), cooldownMinutes = Number(input.cooldownMinutes ?? 1440), maxMetricAgeMinutes = Number(input.maxMetricAgeMinutes ?? 15);
    if (!Number.isFinite(targetCpc) || targetCpc <= 0 || !Number.isInteger(minClicks) || minClicks < 30 || !Number.isInteger(cooldownMinutes) || cooldownMinutes < 60 || cooldownMinutes > 43200 || !Number.isInteger(maxMetricAgeMinutes) || maxMetricAgeMinutes < 1 || maxMetricAgeMinutes > 60) throw new PlatformAdTaskValidationError('请设置有效目标 CPC、至少 30 次点击、至少 60 分钟冷却期与 1–60 分钟数据时效');
    const patch = { tenant_id: tenantId, taskId, connectionId, resourceId, targetCpc, minClicks, cooldownMinutes, maxMetricAgeMinutes, enabled: input.enabled === true, updatedAt: new Date().toISOString() };
    const existing = (await listAdAutomationRules(tenantId, taskId)).find(r => r.connectionId === connectionId && r.resourceId === resourceId);
    if (existing) {
      if (!await store.update(AD_AUTOMATION_RULES, existing.id, patch)) throw new Error('自动规则保存失败');
      return { ...existing, ...patch };
    }
    const created = await store.create<AdAutomationRule>(AD_AUTOMATION_RULES, patch);
    if (!created) throw new Error('自动规则保存失败');
    return created;
  });
}

export async function runAdAutomationRule(rule: AdAutomationRule) {
  if (adReleasePolicy().mode !== 'full') return;
  return withPlatformAdTaskLock(rule.tenant_id, `automation-${rule.id}`, async () => {
    const fresh = await store.getById<AdAutomationRule>(AD_AUTOMATION_RULES, rule.id);
    if (!fresh?.enabled) return;
    const task = await getPlatformAdTask(rule.tenant_id, rule.taskId);
    if (!task || task.managementMode !== 'managed') return;
    const writeRun = async (status: string, reason: string, metrics?: AdAutomationMetrics, receipt?: unknown) => {
      if (!await store.create(AD_AUTOMATION_RUNS, { tenant_id: rule.tenant_id, taskId: rule.taskId, ruleId: rule.id, status, reason, metrics: metrics || null, receipt: receipt || null, createdAt: new Date().toISOString() })) throw new Error('自动运行记录保存失败');
    };
    try {
      const { connection, accessToken } = await getConnectionCredential(rule.tenant_id, fresh.connectionId);
      if (connection.provider !== 'meta' || connection.currency !== task.currency) throw new Error('平台或币种不支持当前优化规则');
      const adapter = new MetaAdsAdapter(accessToken);
      await adapter.assertOwnership(connection.accountId, fresh.resourceId);
      const receipts = await listAdExecutions(rule.tenant_id, rule.taskId);
      if (receipts.some(r => ['UNKNOWN', 'EXECUTING', 'PROVIDER_ACCEPTED'].includes(r.status))) throw new Error('存在待核对执行，停止自动优化');
      const create = receipts.find(r => r.action === 'create' && r.status === 'VERIFIED' && r.connectionId === fresh.connectionId && r.resourceId === fresh.resourceId);
      const adsetId = (create?.result as Record<string, unknown> | undefined)?.adsetId;
      if (!adsetId) throw new Error('缺少完整广告组绑定');
      const [recent, lifetime, budget, campaign] = await Promise.all([
        adapter.request(`${fresh.resourceId}/insights`, { fields: 'spend,inline_link_clicks', date_preset: 'last_7d' }),
        adapter.request(`${fresh.resourceId}/insights`, { fields: 'spend', date_preset: 'maximum' }),
        adapter.request(String(adsetId), { fields: 'daily_budget' }),
        adapter.request(fresh.resourceId, { fields: 'status' }),
      ]);
      if (!Array.isArray(recent.data) || recent.data.length !== 1 || !Array.isArray(lifetime.data) || lifetime.data.length !== 1) throw new Error('平台效果样本尚不可用');
      const linkClicks = recent.data[0].inline_link_clicks;
      if (linkClicks === undefined || linkClicks === null || linkClicks === '') throw new Error('平台未提供链接点击指标，停止优化');
      const metrics: AdAutomationMetrics = { clicks: Number(linkClicks), spend: Number(recent.data[0].spend), lifetimeSpend: Number(lifetime.data[0].spend), dailyBudget: Number(budget.daily_budget) / 100, fetchedAt: new Date().toISOString(), status: String(campaign.status) };
      const baseline = receipts.find(r => r.connectionId === fresh.connectionId && r.resourceId === fresh.resourceId && r.status === 'VERIFIED' && ['create', 'adjust_budget'].includes(r.action));
      const baselineMinor = Number((baseline?.result as Record<string, unknown> | undefined)?.dailyBudgetMinor);
      if (!Number.isFinite(baselineMinor) || baselineMinor <= 0 || baselineMinor !== Number(budget.daily_budget)) {
        await withPlatformAdTaskLock(rule.tenant_id, rule.taskId, async () => {
          if (!await store.update(AD_AUTOMATION_RULES, fresh.id, { enabled: false, updatedAt: new Date().toISOString() })) throw new Error('外部修改保护未能保存');
        });
        await writeRun('EXTERNAL_CHANGE', '平台预算与最近已验证记录不同，已停用规则；请人工确认预算后重新授权', metrics);
        return;
      }
      const last = receipts.find(r => r.connectionId === fresh.connectionId && r.resourceId === fresh.resourceId && r.status === 'VERIFIED' && ['adjust_budget', 'activate', 'resume'].includes(r.action));
      const decision = decideAdOptimization(task, fresh, metrics, last?.createdAt);
      if (!decision.action) { await writeRun('OBSERVING', decision.reason, metrics); return; }
      // An observation must be durable before submitting a real action.
      await writeRun('PROPOSED', decision.reason, metrics);
      const receipt = await executeAutomaticAdAction(rule.tenant_id, rule.taskId, { expectedVersion: task.version, requestId: `auto_${rule.id}_${Math.floor(Date.now() / 60_000)}`, connectionId: fresh.connectionId, resourceId: fresh.resourceId, action: decision.action, dailyBudget: decision.dailyBudget, expectedDailyBudget: metrics.dailyBudget, automationRuleId: fresh.id, automationRuleUpdatedAt: fresh.updatedAt });
      await writeRun(receipt.status, decision.reason, metrics, receipt);
    } catch (error) { await writeRun('BLOCKED', error instanceof Error ? error.message : '自动优化失败'); }
  });
}

export async function runAdAutomationOnce() {
  await runAdLaunchesOnce();
  if (adReleasePolicy().mode !== 'full') return;
  const all: AdAutomationRule[] = [];
  for (let page = 1; ; page++) {
    const rules = await store.list<AdAutomationRule>(AD_AUTOMATION_RULES, { where: { enabled: true }, page, perPage: 100 });
    all.push(...rules.items);
    if (page >= rules.totalPages) break;
  }
  for (const rule of all) {
    try { await runAdAutomationRule(rule); } catch (error) { console.error('[ad-automation]', error instanceof Error ? error.message : 'failed'); }
  }
}
export function startAdAutomationWorker() {
  if (process.env.PLATFORM_ADS_AUTOMATION_ENABLED !== 'true') return () => {};
  let running = false;
  const tick = async () => { if (running) return; running = true; try { await runAdAutomationOnce(); } catch (error) { console.error('[ad-automation:worker]', error); } finally { running = false; } };
  const timer = setInterval(() => void tick(), 5 * 60_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}

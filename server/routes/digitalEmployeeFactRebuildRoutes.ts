import { commitWeeklyGoalFactRebuildReplacement, sameCompletedWeeklyGoalFactRebuild, sameWeeklyGoalFactRebuild, weeklyGoalFactRebuildLink, weeklyGoalFactRebuildRecordId, weeklyGoalFactRebuildReplacement, weeklyGoalFactRebuildSnapshotMatches, weeklyGoalFactRebuildSourcePlanDigest, WeeklyGoalFactRebuildCommitError } from '../digitalEmployees/goalFactRebuild.js';
import { acquireDurableOperationLease, assertDurableOperationLease, releaseDurableOperationLease } from '../runtime/durableLease.js';
import { randomUUID } from 'node:crypto';

import { type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { type EnterpriseProfile } from './enterprise.js';
import { configurationSnapshot, enterpriseProfileFromKnowledgeBinding } from '../digitalEmployees/configuration.js';
import { isDigitalEmployeeOperatingGoal } from '../digitalEmployees/overviewGoalScope.js';
import { goalInput } from '../digitalEmployees/overviewProjection.js';
import { buildWeeklyPlan, normalizeWeeklyGoal } from '../digitalEmployees/domain.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, withLocalQueue, type GoalRecord, type PlanRecord, type RunRecord, type StoredRecord } from '../digitalEmployees/records.js';
import type { DigitalEmployeeApplicationPorts } from '../digitalEmployees/applicationPorts.js';

export function createDigitalEmployeeFactRebuildRoutes(deps: Pick<DigitalEmployeeApplicationPorts, 'digitalEmployeesRouter' | 'goalApprovalQueues' | 'tenantRecord' | 'weeklyGoalFactRebuildTargetCommitted' | 'first' | 'ensureWeeklyGoalFactRebuildAudit' | 'buildOverview' | 'resolveCurrentConfiguration' | 'configForTenant' | 'weeklyGoalFactRebuildRecovery' | 'recommendPackageWithTenantEvidence'>) {
  const digitalEmployeesRouter = deps.digitalEmployeesRouter;

  const goalApprovalQueues = deps.goalApprovalQueues;

  function tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
    return deps.tenantRecord<T>(collection, id, tenantId);
  }

  const weeklyGoalFactRebuildTargetCommitted: DigitalEmployeeApplicationPorts['weeklyGoalFactRebuildTargetCommitted'] = (...args) => deps.weeklyGoalFactRebuildTargetCommitted(...args);

  function first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort = '-created_at'): Promise<T | null> {
    return deps.first<T>(collection, where, sort);
  }

  const ensureWeeklyGoalFactRebuildAudit: DigitalEmployeeApplicationPorts['ensureWeeklyGoalFactRebuildAudit'] = (...args) => deps.ensureWeeklyGoalFactRebuildAudit(...args);

  const buildOverview: DigitalEmployeeApplicationPorts['buildOverview'] = (...args) => deps.buildOverview(...args);

  const resolveCurrentConfiguration: DigitalEmployeeApplicationPorts['resolveCurrentConfiguration'] = (...args) => deps.resolveCurrentConfiguration(...args);

  const configForTenant: DigitalEmployeeApplicationPorts['configForTenant'] = (...args) => deps.configForTenant(...args);

  const weeklyGoalFactRebuildRecovery: DigitalEmployeeApplicationPorts['weeklyGoalFactRebuildRecovery'] = (...args) => deps.weeklyGoalFactRebuildRecovery(...args);

  const recommendPackageWithTenantEvidence: DigitalEmployeeApplicationPorts['recommendPackageWithTenantEvidence'] = (...args) => deps.recommendPackageWithTenantEvidence(...args);

  function registerPostGoalsGoalIdRebuildFromLatestFacts() {
    digitalEmployeesRouter.post('/goals/:goalId/rebuild-from-latest-facts', async (req, res) => {
      try {
      const { tenantId, userId } = res.locals as AuthLocals;
      const requestId = String(req.body?.requestId || '').trim();
      const expectedGoalVersion = Number(req.body?.expectedGoalVersion);
      const suppliedSourcePlanId = String(req.body?.sourcePlanId || '').trim();
      const suppliedExpectedFactsVersion = String(req.body?.expectedFactsVersion || '').trim();
      const suppliedSourcePlanDigest = String(req.body?.expectedSourcePlanDigest || '').trim();
      if (!/^[A-Za-z0-9_-]{8,120}$/.test(requestId)
        || !Number.isSafeInteger(expectedGoalVersion)
        || expectedGoalVersion < 1
        || !/^[A-Za-z0-9_-]{1,200}$/.test(suppliedSourcePlanId)
        || !suppliedExpectedFactsVersion
        || suppliedExpectedFactsVersion.length > 160
        || !/^[a-f0-9]{64}$/.test(suppliedSourcePlanDigest)) {
        res.status(400).json({ error: 'goal_fact_rebuild_request_invalid', message: '周目标重建请求身份或版本无效。' });
        return;
      }
      await withLocalQueue(goalApprovalQueues, `${tenantId}:activate`, async () => {
        let source = await tenantRecord<GoalRecord>(COLLECTION.goals, req.params.goalId, tenantId);
        if (!source) { res.status(404).json({ error: 'goal_not_found' }); return; }
        if (!isDigitalEmployeeOperatingGoal(source)) { res.status(409).json({ error: 'operating_goal_required' }); return; }
        if (!await weeklyGoalFactRebuildTargetCommitted(tenantId, source)) {
          res.status(409).json({ error: 'goal_fact_rebuild_not_committed', message: '最新事实周目标尚未完成安全替换，暂不能再次重建。' }); return;
        }
        if (Number(source.version) !== expectedGoalVersion) {
          res.status(409).json({ error: 'goal_changed', message: '周目标版本已变化，请刷新后重试。', goalVersion: Number(source.version || 0) });
          return;
        }
        let sourcePlan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: source.id });
        if (!sourcePlan) { res.status(404).json({ error: 'plan_not_found' }); return; }
        if (sourcePlan.id !== suppliedSourcePlanId || weeklyGoalFactRebuildSourcePlanDigest(sourcePlan) !== suppliedSourcePlanDigest) {
          res.status(409).json({ error: 'goal_source_plan_changed', message: '原周计划已变化，请刷新后重试。' });
          return;
        }
        if (source.status === 'draft' && sourcePlan.status !== 'draft') {
          res.status(409).json({ error: 'draft_required', message: '只有尚未启动的过期周目标可以自动重建。' });
          return;
        }
        let sourcePlanBody = jsonObject<Record<string, unknown>>(sourcePlan.plan, {});
        let fromFactsVersion = String(jsonObject<Record<string, unknown>>(sourcePlanBody.knowledgeBinding, {}).factsVersion || '').trim();
        if (!fromFactsVersion) {
          res.status(409).json({ error: 'enterprise_fact_snapshot_missing', message: '原周目标缺少可核验的企业事实版本，不能自动重建。' });
          return;
        }
        if (suppliedExpectedFactsVersion !== fromFactsVersion) {
          res.status(409).json({ error: 'goal_fact_binding_changed', message: '周目标引用的企业事实版本已变化，请刷新后重试。', factVersion: fromFactsVersion });
          return;
        }
        const sourceRun = await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: source.id }, '-started_at');
        if (sourceRun) {
          res.status(409).json({ error: 'package_locked', message: '周目标已经产生运行记录，不能自动重建。' });
          return;
        }
        if (source.status === 'cancelled') {
          const replacement = weeklyGoalFactRebuildReplacement(source.scope);
          if (!replacement
            || replacement.sourceGoalId !== source.id
            || replacement.sourceGoalVersion !== expectedGoalVersion
            || replacement.sourcePlanId !== sourcePlan.id
            || replacement.sourcePlanDigest !== suppliedSourcePlanDigest
            || replacement.fromFactsVersion !== fromFactsVersion) {
            res.status(409).json({ error: 'draft_required', message: '只有尚未启动的过期周目标可以自动重建。' });
            return;
          }
          const target = await tenantRecord<GoalRecord>(COLLECTION.goals, replacement.targetGoalId, tenantId);
          const targetPlan = target
            ? await tenantRecord<PlanRecord>(COLLECTION.plans, replacement.targetPlanId, tenantId)
            : null;
          const targetPlanBody = jsonObject<Record<string, unknown>>(targetPlan?.plan, {});
          const targetFactsVersion = String(jsonObject<Record<string, unknown>>(targetPlanBody.knowledgeBinding, {}).factsVersion || '').trim();
          const targetLink = weeklyGoalFactRebuildLink(target?.scope);
          const targetPlanLink = weeklyGoalFactRebuildLink(targetPlanBody);
          if (!target
            || !targetPlan
            || targetPlan.goal_id !== target.id
            || !['draft', 'approved'].includes(targetPlan.status)
            || !sameCompletedWeeklyGoalFactRebuild(targetLink, replacement)
            || !sameCompletedWeeklyGoalFactRebuild(targetPlanLink, replacement)
            || targetFactsVersion !== replacement.toFactsVersion
            || Number(targetPlanBody.configVersion) !== replacement.configVersion
            || String(targetPlanBody.policyVersion || '') !== replacement.policyVersion) {
            res.status(409).json({ error: 'weekly_goal_fact_rebuild_recovery_conflict', message: '已重建周目标的恢复记录不完整，请人工检查。' });
            return;
          }
          try {
            await commitWeeklyGoalFactRebuildReplacement({
              dataStore: store,
              tenantId,
              sourceGoalId: source.id,
              sourceGoalVersion: expectedGoalVersion,
              sourceDescription: goalInput(source).scope,
              replacement,
            });
          } catch (error) {
            if (error instanceof WeeklyGoalFactRebuildCommitError) {
              res.status(409).json({ error: error.code, message: error.message });
              return;
            }
            throw error;
          }
          await ensureWeeklyGoalFactRebuildAudit({ tenantId, userId: replacement.rebuiltBy || userId, sourceGoalId: source.id, sourceGoalVersion: expectedGoalVersion, sourcePlanId: sourcePlan.id, sourcePlanDigest: replacement.sourcePlanDigest, targetGoalId: target.id, targetPlanId: targetPlan.id, fromFactsVersion, toFactsVersion: replacement.toFactsVersion, configVersion: replacement.configVersion, policyVersion: replacement.policyVersion, requestId: replacement.requestId });
          res.json(await buildOverview(tenantId, target.id));
          return;
        }
        if (source.status !== 'draft') {
          res.status(409).json({ error: 'draft_required', message: '只有尚未启动的过期周目标可以自动重建。' });
          return;
        }
        let resolved = await resolveCurrentConfiguration(tenantId, await configForTenant(tenantId));
        if (!resolved) { res.status(409).json({ error: 'onboarding_required' }); return; }
        if (resolved.config.smartOperationsEnabled === false) {
          res.status(409).json({ error: 'smart_operations_disabled', message: '智能经营已关闭，不能自动重建周目标。' });
          return;
        }
        let toFactsVersion = resolved.knowledgeBinding.factsVersion;
        const rebuildIdentity = {
          sourceGoalId: source.id,
          sourceGoalVersion: expectedGoalVersion,
          sourcePlanId: sourcePlan.id,
          sourcePlanDigest: suppliedSourcePlanDigest,
          fromFactsVersion,
          toFactsVersion,
          configVersion: resolved.configVersion,
          policyVersion: resolved.policyVersion,
        };
        const targetGoalId = weeklyGoalFactRebuildRecordId('goal', tenantId, source.id, expectedGoalVersion, toFactsVersion, resolved.configVersion, resolved.policyVersion, suppliedSourcePlanDigest);
        const targetPlanId = weeklyGoalFactRebuildRecordId('plan', tenantId, source.id, expectedGoalVersion, toFactsVersion, resolved.configVersion, resolved.policyVersion, suppliedSourcePlanDigest);
        const readTarget = async () => {
          const target = await tenantRecord<GoalRecord>(COLLECTION.goals, targetGoalId, tenantId);
          if (target && !sameWeeklyGoalFactRebuild(weeklyGoalFactRebuildLink(target.scope), rebuildIdentity)) {
            throw new WeeklyGoalFactRebuildCommitError('weekly_goal_fact_rebuild_target_conflict', '已存在的替代周目标与本次重建不一致。');
          }
          if (target && (target.status !== 'draft' || Number(target.version) !== 1
            || await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: target.id }, '-started_at'))) {
            throw new WeeklyGoalFactRebuildCommitError('weekly_goal_fact_rebuild_target_not_pristine', '替代周目标已被修改或启动，不能替换原草稿。');
          }
          const targetPlan = target ? await tenantRecord<PlanRecord>(COLLECTION.plans, targetPlanId, tenantId) : null;
          if (targetPlan) {
            const targetBody = jsonObject<Record<string, unknown>>(targetPlan.plan, {});
            const targetFactsVersion = String(jsonObject<Record<string, unknown>>(targetBody.knowledgeBinding, {}).factsVersion || '').trim();
            const targetLink = weeklyGoalFactRebuildLink(target?.scope);
            const targetPlanLink = weeklyGoalFactRebuildLink(targetBody);
            if (targetPlan.id !== targetPlanId
              || targetPlan.status !== 'draft'
              || targetFactsVersion !== toFactsVersion
              || Number(targetBody.configVersion) !== rebuildIdentity.configVersion
              || String(targetBody.policyVersion || '') !== rebuildIdentity.policyVersion
              || !targetLink
              || !sameCompletedWeeklyGoalFactRebuild(targetPlanLink, targetLink)
              || !sameWeeklyGoalFactRebuild(targetPlanLink, rebuildIdentity)) {
              throw new WeeklyGoalFactRebuildCommitError('weekly_goal_fact_rebuild_plan_conflict', '已存在的替代周计划与本次重建不一致。');
            }
          }
          return { target, targetPlan };
        };
        let recovered: Awaited<ReturnType<typeof readTarget>>;
        try { recovered = await readTarget(); }
        catch (error) {
          if (error instanceof WeeklyGoalFactRebuildCommitError) {
            res.status(409).json({ error: error.code, message: error.message });
          } else {
            res.status(503).json({ error: 'goal_fact_rebuild_recovery_unavailable', message: '暂时无法核验周目标重建记录，请稍后重试。' });
          }
          return;
        }
        if (fromFactsVersion === toFactsVersion) {
          res.status(409).json({ error: 'goal_facts_current', message: '当前周目标已经引用最新企业事实，无需重建。', factVersion: toFactsVersion });
          return;
        }
        if (!store.compareAndSwap) {
          res.status(503).json({ error: 'goal_fact_rebuild_atomic_store_required', message: '当前存储不支持安全重建周目标。' });
          return;
        }
        const durableLeaseSupported = await store.supportsAtomicOperationLease?.() === true;
        const lease = durableLeaseSupported ? await acquireDurableOperationLease({
          dataStore: store,
          tenantId,
          scope: 'weekly_goal_fact_rebuild',
          subjectId: source.id,
          ownerId: `goal-facts-${randomUUID()}`,
          leaseDurationMs: 30 * 60_000,
        }) : null;
        if (durableLeaseSupported && !lease) {
          res.status(409).json({ error: 'goal_fact_rebuild_in_progress', message: '最新事实周目标正在重建，请稍后查询最新计划。', retryable: true });
          return;
        }
        let postFenceFactsVersion = '';
        try {
          source = await tenantRecord<GoalRecord>(COLLECTION.goals, req.params.goalId, tenantId);
          sourcePlan = source ? await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: source.id }) : null;
          if (!source
            || !sourcePlan
            || sourcePlan.id !== rebuildIdentity.sourcePlanId
            || weeklyGoalFactRebuildSourcePlanDigest(sourcePlan) !== rebuildIdentity.sourcePlanDigest
            || sourcePlan.status !== 'draft'
            || Number(source.version) !== expectedGoalVersion) {
            res.status(409).json({ error: 'goal_changed', message: '周目标版本已变化，请刷新后重试。' });
            return;
          }
          sourcePlanBody = jsonObject<Record<string, unknown>>(sourcePlan.plan, {});
          fromFactsVersion = String(jsonObject<Record<string, unknown>>(sourcePlanBody.knowledgeBinding, {}).factsVersion || '').trim();
          if (!fromFactsVersion || suppliedExpectedFactsVersion !== fromFactsVersion) {
            res.status(409).json({ error: 'goal_fact_binding_changed', message: '周目标引用的企业事实版本已变化，请刷新后重试。', factVersion: fromFactsVersion });
            return;
          }
          resolved = await resolveCurrentConfiguration(tenantId, await configForTenant(tenantId));
          if (!resolved) { res.status(409).json({ error: 'onboarding_required' }); return; }
          if (resolved.config.smartOperationsEnabled === false) {
            res.status(409).json({ error: 'smart_operations_disabled', message: '智能经营已关闭，不能自动重建周目标。' });
            return;
          }
          toFactsVersion = resolved.knowledgeBinding.factsVersion;
          if (toFactsVersion !== rebuildIdentity.toFactsVersion) {
            res.status(409).json({ error: 'enterprise_facts_changed', message: '企业事实再次更新，正在等待基于最新版本重建。', ...weeklyGoalFactRebuildRecovery(source, sourcePlan, fromFactsVersion, toFactsVersion) });
            return;
          }
          if (source.status !== 'draft') {
            res.status(409).json({ error: 'draft_required', message: '只有尚未启动的过期周目标可以自动重建。' });
            return;
          }
          if (await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: source.id }, '-started_at')) {
            res.status(409).json({ error: 'package_locked', message: '周目标已经产生运行记录，不能自动重建。' });
            return;
          }
          recovered = await readTarget();
          let target = recovered.target;
          let targetPlan = recovered.targetPlan;
          let rebuildLink = target ? weeklyGoalFactRebuildLink(target.scope)! : null;
          if (!targetPlan) {
            const enterpriseProfile = enterpriseProfileFromKnowledgeBinding(resolved.knowledgeBinding) as EnterpriseProfile | null;
            if (!enterpriseProfile) {
              res.status(409).json({ error: 'enterprise_fact_snapshot_missing', message: '最新企业事实快照不可用，不能自动重建周目标。' });
              return;
            }
            const { videoPlans: _staleVideoPlans, ...sourceIntent } = goalInput(source);
            const refreshedGoal = normalizeWeeklyGoal(sourceIntent, resolved.config);
            const planDraft = buildWeeklyPlan(refreshedGoal, resolved.config);
            const recommendedPackage = await recommendPackageWithTenantEvidence(tenantId, refreshedGoal, resolved.config, source.owner_id || userId, '', enterpriseProfile);
            const latestResolved = await resolveCurrentConfiguration(tenantId, await configForTenant(tenantId));
            if (!latestResolved
              || latestResolved.knowledgeBinding.factsVersion !== toFactsVersion
              || latestResolved.configVersion !== resolved.configVersion
              || latestResolved.policyVersion !== resolved.policyVersion) {
              res.status(409).json({ error: 'goal_rebuild_configuration_changed', message: '经营配置在重建期间发生变化，请按最新配置重试。', recoveryAction: 'rebuild_weekly_goal' });
              return;
            }
            if (lease) await assertDurableOperationLease({ dataStore: store, lease, minimumRemainingMs: 1_000 });
            if (!target) {
              const rebuiltAt = new Date().toISOString();
              rebuildLink = { ...rebuildIdentity, requestId, rebuiltBy: userId, rebuiltAt };
              let createdTarget: GoalRecord | null = null;
              try {
                createdTarget = await store.create<GoalRecord>(COLLECTION.goals, {
                  id: targetGoalId,
                  tenant_id: tenantId,
                  business_line: refreshedGoal.businessLine,
                  content_platforms: refreshedGoal.contentPlatforms,
                  title: refreshedGoal.title,
                  objective: refreshedGoal.objective,
                  metric: refreshedGoal.metric,
                  baseline: refreshedGoal.baseline,
                  target: refreshedGoal.target,
                  unit: refreshedGoal.unit,
                  starts_at: refreshedGoal.startsAt,
                  ends_at: refreshedGoal.endsAt,
                  scope: { description: refreshedGoal.scope, factRebuild: rebuildLink },
                  constraints: refreshedGoal.constraints,
                  owner_id: source.owner_id || userId,
                  status: 'draft',
                  version: 1,
                  created_at: rebuiltAt,
                  updated_at: rebuiltAt,
                });
              } catch { /* A deterministic-ID winner is recovered and validated below. */ }
              target = createdTarget || await tenantRecord<GoalRecord>(COLLECTION.goals, targetGoalId, tenantId);
              if (!target || !sameWeeklyGoalFactRebuild(weeklyGoalFactRebuildLink(target.scope), rebuildIdentity)) {
                res.status(503).json({ error: 'goal_fact_rebuild_target_unavailable' });
                return;
              }
              rebuildLink = weeklyGoalFactRebuildLink(target.scope)!;
            }
            if (lease) await assertDurableOperationLease({ dataStore: store, lease, minimumRemainingMs: 1_000 });
            let createdPlan: PlanRecord | null = null;
            try {
              createdPlan = await store.create<PlanRecord>(COLLECTION.plans, {
                id: targetPlanId,
                tenant_id: tenantId,
                goal_id: target.id,
                status: 'draft',
                plan: { ...planDraft, ...configurationSnapshot(resolved), businessPackage: recommendedPackage, factRebuild: rebuildLink },
                created_at: rebuildLink!.rebuiltAt,
              });
            } catch { /* A deterministic-ID winner is recovered and validated below. */ }
            targetPlan = createdPlan || await tenantRecord<PlanRecord>(COLLECTION.plans, targetPlanId, tenantId);
            const rebuiltPlanBody = jsonObject<Record<string, unknown>>(targetPlan?.plan, {});
            if (!targetPlan
              || targetPlan.id !== targetPlanId
              || String(jsonObject<Record<string, unknown>>(rebuiltPlanBody.knowledgeBinding, {}).factsVersion || '') !== toFactsVersion
              || !sameWeeklyGoalFactRebuild(weeklyGoalFactRebuildLink(rebuiltPlanBody), rebuildIdentity)) {
              res.status(503).json({ error: 'goal_fact_rebuild_plan_unavailable' });
              return;
            }
          }
          const finalResolved = await resolveCurrentConfiguration(tenantId, await configForTenant(tenantId));
          if (finalResolved && finalResolved.knowledgeBinding.factsVersion !== rebuildIdentity.toFactsVersion) {
            res.status(409).json({
              error: 'enterprise_facts_changed',
              message: '企业事实在提交前再次更新，将按最新事实重新设定周目标。',
              ...weeklyGoalFactRebuildRecovery(source, sourcePlan, fromFactsVersion, finalResolved.knowledgeBinding.factsVersion),
            });
            return;
          }
          if (!finalResolved
            || finalResolved.config.smartOperationsEnabled === false
            || !weeklyGoalFactRebuildSnapshotMatches({
              factsVersion: finalResolved.knowledgeBinding.factsVersion,
              configVersion: finalResolved.configVersion,
              policyVersion: finalResolved.policyVersion,
            }, rebuildIdentity)) {
            res.status(409).json({ error: 'goal_rebuild_configuration_changed', message: '经营配置或策略在提交前发生变化，未取消原周目标。', recoveryAction: 'rebuild_weekly_goal' });
            return;
          }
          if (lease) await assertDurableOperationLease({ dataStore: store, lease, minimumRemainingMs: 1_000 });
          const link = weeklyGoalFactRebuildLink(target!.scope)!;
          await commitWeeklyGoalFactRebuildReplacement({
            dataStore: store,
            tenantId,
            sourceGoalId: source.id,
            sourceGoalVersion: expectedGoalVersion,
            sourceDescription: goalInput(source).scope,
            replacement: { ...link, targetGoalId, targetPlanId },
            validateAfterSourcePlanFence: async () => {
              const commitResolved = await resolveCurrentConfiguration(tenantId, await configForTenant(tenantId));
              if (!commitResolved) {
                throw new WeeklyGoalFactRebuildCommitError(
                  'goal_rebuild_configuration_changed',
                  '经营配置或策略在提交前不可用，未取消原周目标。',
                );
              }
              if (commitResolved.knowledgeBinding.factsVersion !== rebuildIdentity.toFactsVersion) {
                postFenceFactsVersion = commitResolved.knowledgeBinding.factsVersion;
                throw new WeeklyGoalFactRebuildCommitError(
                  'enterprise_facts_changed',
                  '企业事实在提交前再次更新，将按最新事实重新设定周目标。',
                );
              }
              if (commitResolved.config.smartOperationsEnabled === false
                || commitResolved.configVersion !== rebuildIdentity.configVersion
                || commitResolved.policyVersion !== rebuildIdentity.policyVersion) {
                throw new WeeklyGoalFactRebuildCommitError(
                  'goal_rebuild_configuration_changed',
                  '经营配置或策略在提交前发生变化，未取消原周目标。',
                );
              }
            },
          });
          await ensureWeeklyGoalFactRebuildAudit({ tenantId, userId: link.rebuiltBy || userId, sourceGoalId: source.id, sourceGoalVersion: expectedGoalVersion, sourcePlanId: sourcePlan.id, sourcePlanDigest: link.sourcePlanDigest, targetGoalId, targetPlanId, fromFactsVersion, toFactsVersion, configVersion: link.configVersion, policyVersion: link.policyVersion, requestId: link.requestId });
          res.json(await buildOverview(tenantId, targetGoalId));
        } catch (error) {
          if (error instanceof WeeklyGoalFactRebuildCommitError) {
            if (error.code === 'enterprise_facts_changed' && postFenceFactsVersion) {
              res.status(409).json({
                error: error.code,
                message: error.message,
                ...weeklyGoalFactRebuildRecovery(source!, sourcePlan!, fromFactsVersion, postFenceFactsVersion),
              });
              return;
            }
            res.status(409).json({ error: error.code, message: error.message });
            return;
          }
          if (!res.headersSent) res.status(503).json({ error: 'goal_fact_rebuild_failed', message: '周目标自动重建失败，请稍后重试。' });
        } finally {
          if (lease) await releaseDurableOperationLease({ dataStore: store, lease }).catch(() => undefined);
        }
      });
      } catch {
        if (!res.headersSent) res.status(503).json({ error: 'goal_fact_rebuild_failed', message: '周计划同步服务暂时不可用，请先查看原计划状态，勿重复提交。' });
      }
    });
  }

  return { registerPostGoalsGoalIdRebuildFromLatestFacts };
}

import { initialPreparationSources, initialPreparationSourcesFromPersisted, initialPreparationJobKey, replaceInitialPreparationPlan, type InitialPreparation } from '../digitalEmployees/initialPreparation.js';
import { createCrawlWorkerJob } from './crawlWorker.js';
import { hasWeeklyGoalFactRebuildPlanFence } from '../digitalEmployees/goalFactRebuild.js';
import { acquireDurableOperationLease, releaseDurableOperationLease } from '../runtime/durableLease.js';
import { randomUUID } from 'node:crypto';
import { managedPublishingGrantErrors } from '../../shared/contracts/managedPublishingGrant.js';
import { repairCollapsedWeeklyVideoProduction, criticalBusinessConfigChanges } from '../digitalEmployees/weeklyPackage.js';
import { type WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { readTenantEnterpriseProfile, updateTenantEnterpriseProfile } from './enterprise.js';
import { resolveDigitalEmployeeConfiguration } from '../digitalEmployees/configuration.js';
import { bindPublishingTargets } from '../digitalEmployees/publishingTargets.js';
import { beijingDate } from '../digitalEmployees/runtimeSchedule.js';
import { configSnapshotForPlan, publicConfigurationMetadata } from '../digitalEmployees/overviewProjection.js';
import { normalizeDigitalEmployeeConfig, validateDigitalEmployeeConfig } from '../digitalEmployees/domain.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, withLocalQueue, type GoalRecord, type PlanRecord, type RunRecord, type StoredRecord } from '../digitalEmployees/records.js';
import type { DigitalEmployeeApplicationPorts } from '../digitalEmployees/applicationPorts.js';
import { applyEnterpriseOnboardingConfirmation, EnterpriseOnboardingConfirmationError, parseEnterpriseOnboardingConfirmation } from '../digitalEmployees/enterpriseOnboardingConfirmation.js';
import { assertEnterpriseOnboardingDraftClaim, claimEnterpriseOnboardingDraft, clearEnterpriseOnboardingDraft, EnterpriseOnboardingDraftConflictError, markEnterpriseOnboardingDraftRetryable, releaseEnterpriseOnboardingDraftClaim } from './enterpriseOnboardingDraft.js';
import { requestOrganizationRoleStrict } from '../lib/organizationRole.js';

class KnownConfigurationNoWriteError extends Error {}

export function createDigitalEmployeeOnboardingRoutes(deps: Pick<DigitalEmployeeApplicationPorts, 'digitalEmployeesRouter' | 'first' | 'goalApprovalQueues' | 'tenantRecord' | 'weeklyGoalFactRebuildTargetCommitted' | 'resumeInitialPreparationPlan' | 'frozenEnterpriseProfileForPlan' | 'configForTenant' | 'requiredCreate' | 'appendEvent' | 'appendAudit' | 'buildOverview'>) {
  const digitalEmployeesRouter = deps.digitalEmployeesRouter;

  function first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort = '-created_at'): Promise<T | null> {
    return deps.first<T>(collection, where, sort);
  }

  const goalApprovalQueues = deps.goalApprovalQueues;

  function tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
    return deps.tenantRecord<T>(collection, id, tenantId);
  }

  const weeklyGoalFactRebuildTargetCommitted: DigitalEmployeeApplicationPorts['weeklyGoalFactRebuildTargetCommitted'] = (...args) => deps.weeklyGoalFactRebuildTargetCommitted(...args);

  const resumeInitialPreparationPlan: DigitalEmployeeApplicationPorts['resumeInitialPreparationPlan'] = (...args) => deps.resumeInitialPreparationPlan(...args);

  const frozenEnterpriseProfileForPlan: DigitalEmployeeApplicationPorts['frozenEnterpriseProfileForPlan'] = (...args) => deps.frozenEnterpriseProfileForPlan(...args);

  const configForTenant: DigitalEmployeeApplicationPorts['configForTenant'] = (...args) => deps.configForTenant(...args);

  function requiredCreate<T extends StoredRecord>(collection: string, payload: Record<string, unknown>): Promise<T> {
    return deps.requiredCreate<T>(collection, payload);
  }

  const appendEvent: DigitalEmployeeApplicationPorts['appendEvent'] = (...args) => deps.appendEvent(...args);

  const appendAudit: DigitalEmployeeApplicationPorts['appendAudit'] = (...args) => deps.appendAudit(...args);

  const buildOverview: DigitalEmployeeApplicationPorts['buildOverview'] = (...args) => deps.buildOverview(...args);

  function registerPostOnboardingHistoryCollection() {
    digitalEmployeesRouter.post('/onboarding/history-collection',async(req,res)=>{
      const {tenantId,userId}=res.locals as AuthLocals;
      try{const requestId=String(req.body?.requestId||'');if(!/^[a-zA-Z0-9-]{8,100}$/.test(requestId))throw Error('请求身份缺失');const source=initialPreparationSources({platforms:[req.body.platform],products:['企业产品'],stage:'b2b_growth',historyAccounts:[req.body.accountUrl],historyCollectionRequestId:requestId}).find(s=>s.origin==='owned')!;const state={requestId,goalId:'history'} as InitialPreparation;const job=await createCrawlWorkerJob({tenantId,requestedBy:userId,platform:source.platform,mode:'account',accountUrl:source.value,limit:30,idempotencyKey:initialPreparationJobKey(tenantId,state,source)});if(!job)throw Error('采集任务创建失败');res.status(202).json({jobId:job.id,status:job.status});}catch(error){res.status(400).json({error:'history_collection_failed',message:error instanceof Error?error.message:'历史采集失败'});}
    });
  }

  function registerGetGoalsGoalIdInitialPreparation() {
    digitalEmployeesRouter.get('/goals/:goalId/initial-preparation',async(req,res)=>{const {tenantId}=res.locals as AuthLocals;const plan=await first<PlanRecord>(COLLECTION.plans,{tenant_id:tenantId,goal_id:String(req.params.goalId)});res.json({preparation:plan?jsonObject<{initialPreparation?:InitialPreparation}>(plan.plan,{}).initialPreparation||null:null});});
  }

  function registerPostGoalsGoalIdInitialPreparation() {
    digitalEmployeesRouter.post('/goals/:goalId/initial-preparation',async(req,res)=>{
      const {tenantId,userId}=res.locals as AuthLocals;const goalId=String(req.params.goalId);
      const confirmationLease=await acquireDurableOperationLease({dataStore:store,tenantId,scope:'initial_operating_confirmation',subjectId:goalId,ownerId:`confirm-${randomUUID()}`,leaseDurationMs:30*60_000});if(!confirmationLease){res.status(409).json({error:'initial_confirmation_in_progress',message:'原确认正在处理，请查询原计划进度'});return;}
      try{await withLocalQueue(goalApprovalQueues,`${tenantId}:initial-confirm:${goalId}`,async()=>{
          const goal=await tenantRecord<GoalRecord>(COLLECTION.goals,goalId,tenantId);const plan=await first<PlanRecord>(COLLECTION.plans,{tenant_id:tenantId,goal_id:goalId});if(!goal||!plan)throw Error('原计划不存在');
          if(!await weeklyGoalFactRebuildTargetCommitted(tenantId,goal))throw Error('最新事实周目标尚未完成安全替换');
          const body=jsonObject<Record<string,unknown>>(plan.plan,{});if(plan.status!=='draft'||hasWeeklyGoalFactRebuildPlanFence(body))throw Error('原计划正在发生状态变更');const existing=body.initialPreparation as InitialPreparation|undefined;const pack=repairCollapsedWeeklyVideoProduction(body.businessPackage as WeeklyPackage);
          if(req.body?.resume&&existing){await resumeInitialPreparationPlan(tenantId,goalId,true);return;}
          const sourceScope=()=>initialPreparationSourcesFromPersisted({goalPlatforms:jsonObject(goal.content_platforms,[]),businessPackage:pack,config:body.configSnapshot,profile:frozenEnterpriseProfileForPlan(plan,false)},{historyAccounts:req.body?.historyAccounts,historyCollectionRequestId:req.body?.historyCollectionRequestId});
          if(existing){if(existing.requestId!==String(req.body?.requestId))throw Error('已确认原计划，请查询或恢复原请求');if(JSON.stringify(existing.sources.map(({jobId,...source})=>source))!==JSON.stringify(sourceScope()))throw Error('确认范围变化，请修订计划');return;}
          if(goal.status!=='draft')throw Error('原计划已执行，不接受新的初始化确认');
          const requestId=String(req.body?.requestId||'');if(!/^[a-zA-Z0-9-]{8,100}$/.test(requestId))throw Error('请求身份缺失');
          if(!pack||pack.revision!==Number(req.body?.revision))throw Error('计划版本已变化');
          const state:InitialPreparation={requestId,goalId,revision:pack.revision,confirmedBy:userId,confirmedAt:new Date().toISOString(),status:'collecting',sources:sourceScope(),candidateIds:[],reason:''};
          await replaceInitialPreparationPlan({dataStore:store,collection:COLLECTION.plans,expected:plan,tenantId,nextPlan:{...body,initialPreparation:state},conflictMessage:'计划版本已变化，请重新确认'});
          await resumeInitialPreparationPlan(tenantId,goalId);
        });const latest=await first<PlanRecord>(COLLECTION.plans,{tenant_id:tenantId,goal_id:goalId});res.status(202).json({preparation:jsonObject<{initialPreparation?:InitialPreparation}>(latest?.plan,{}).initialPreparation});
      }catch(error){res.status(409).json({error:'initial_preparation_failed',message:error instanceof Error?error.message:'初始化准备失败'});}finally{await releaseDurableOperationLease({dataStore:store,lease:confirmationLease});}
    });
  }

  function registerPostOnboardingComplete() {
    digitalEmployeesRouter.post('/onboarding/complete', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const role = await requestOrganizationRoleStrict(req.headers.authorization, userId);
      if (role !== 'admin' && role !== 'super_admin') {
        res.status(403).json({ error: 'enterprise_onboarding_forbidden', message: '只有企业管理员可以确认企业建档与经营配置。' });
        return;
      }
      const onboardingInput = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body as Record<string, unknown>
        : {};
      const minimalOnboarding = onboardingInput.minimalOnboarding === true;
      // First login deliberately asks for no operating assumptions. These values
      // satisfy the internal legacy runtime contract only; they are never written
      // into Enterprise Center and cannot authorize publishing or customer sends.
      const submittedConfig = normalizeDigitalEmployeeConfig(minimalOnboarding ? {
        ...onboardingInput,
        industry: String(onboardingInput.industry || '').trim() || '待在实际任务中确认',
        primaryBusiness: String(onboardingInput.primaryBusiness || '').trim() || '待在实际任务中确认',
        targetMarkets: String(onboardingInput.targetMarkets || '').trim() || '待在实际任务中确认',
        customerProfile: String(onboardingInput.customerProfile || '').trim() || '待在实际任务中确认',
        focusProducts: String(onboardingInput.focusProducts || '').trim(),
        primaryGoal: 'awareness',
        approvalOwner: String(onboardingInput.approvalOwner || '').trim() || '企业管理员',
        enabledWorkflows: ['viral_clone'],
        publishingTargets: Array.isArray(onboardingInput.publishingTargets) ? onboardingInput.publishingTargets : [],
        allowRealPublishing: false,
        allowRealCustomerMessages: false,
        allowGeneratedVisuals: onboardingInput.allowGeneratedVisuals === true,
        autonomyMode: 'managed',
      } : onboardingInput);
      const boundPublishing = await bindPublishingTargets(tenantId, submittedConfig.publishingTargets);
      submittedConfig.publishingTargets = boundPublishing.targets;
      // Initial production setup may be partial. Invalid legacy account bindings
      // are NOT authorization: omit them, retain evidence in audit, and recheck at
      // the actual release gate. Full settings saves remain strict.
      if (boundPublishing.invalidAccountIds.length && !minimalOnboarding) {
        res.status(409).json({
          error: 'publishing_accounts_invalid',
          message: '部分发布账号不属于当前企业或已断开连接，请重新选择。',
          invalidAccountIds: boundPublishing.invalidAccountIds,
        });
        return;
      }
      const existing = await configForTenant(tenantId);
      const now = new Date().toISOString();
      const grantErrors = managedPublishingGrantErrors(submittedConfig.managedPublishingGrant, submittedConfig, beijingDate(new Date(now)));
      if (grantErrors.length) { res.status(400).json({ error: 'managed_publishing_grant_invalid', message: grantErrors.join('；') }); return; }
      if (submittedConfig.managedPublishingGrant?.enabled) {
        submittedConfig.managedPublishingGrant = { ...submittedConfig.managedPublishingGrant, grantId: randomUUID(), authorizedBy: userId, authorizedAt: now };
      } else delete submittedConfig.managedPublishingGrant;
      let confirmation: ReturnType<typeof parseEnterpriseOnboardingConfirmation> | null = null;
      let enterprise: Awaited<ReturnType<typeof readTenantEnterpriseProfile>>;
      try {
        confirmation = minimalOnboarding && onboardingInput.onboardingConfirmation
          ? parseEnterpriseOnboardingConfirmation(onboardingInput.onboardingConfirmation)
          : null;
        enterprise = await readTenantEnterpriseProfile(tenantId);
      } catch (error) {
        if (error instanceof EnterpriseOnboardingConfirmationError) {
          res.status(error.status).json({ error: error.code, message: error.message, ...error.details });
          return;
        }
        res.status(503).json({ error: 'enterprise_onboarding_confirmation_unavailable', message: '企业事实暂时无法确认，请稍后重试。' });
        return;
      }
      if (minimalOnboarding && !existing && !confirmation) {
        res.status(400).json({
          error: 'enterprise_onboarding_confirmation_required',
          message: '首次企业建档必须提交已保存草稿的完整确认资料。',
        });
        return;
      }
      const minimalCompanyName = String(confirmation?.companyName || onboardingInput.companyName || enterprise.company.name || '').trim();
      const minimalBrandName = String(confirmation?.brandName || onboardingInput.brandName || enterprise.brand?.name || '').trim();
      const minimalContentStage = ['b2b_launch', 'b2b_growth', 'd2c_brand'].includes(String(confirmation?.contentStage || enterprise.socialStrategy?.contentStage || ''))
        ? confirmation?.contentStage || enterprise.socialStrategy?.contentStage
        : undefined;
      if (minimalOnboarding) {
        const missing = [
          ...(!minimalCompanyName ? ['企业名称'] : []),
          ...(!minimalBrandName ? ['品牌名称'] : []),
          ...(!(confirmation?.products.length || enterprise.products.items?.length) ? ['产品表'] : []),
          ...(!minimalContentStage ? ['社媒经营阶段'] : []),
        ];
        if (missing.length) { res.status(400).json({ error: 'onboarding_incomplete', missing }); return; }
      }
      const customerAgentEnabled = submittedConfig.enabledWorkflows.some(workflow => (
        workflow === 'customer_segmentation' || workflow === 'batch_followup'
      ));
      const companyPatch = {
        ...enterprise.company,
        name: enterprise.company.name || submittedConfig.companyName,
        industry: enterprise.company.industry || submittedConfig.industry,
        mainMarkets: enterprise.company.mainMarkets || submittedConfig.targetMarkets,
        description: enterprise.company.description || submittedConfig.primaryBusiness,
      };
      const enterprisePatch = minimalOnboarding ? {
        company: { ...enterprise.company, name: minimalCompanyName },
        brand: { ...enterprise.brand, name: minimalBrandName },
        strategy: { ...enterprise.strategy, focusProducts: submittedConfig.focusProducts || enterprise.strategy?.focusProducts, focusMarkets: submittedConfig.targetMarkets || enterprise.strategy?.focusMarkets },
        customerService: {
          ...enterprise.customerService,
          enabled: false,
          disabledAt: now,
          partialAutoReplyEnabled: false,
          partialAutoReplyDecision: 'pending' as const,
          partialAutoReplyDecisionAt: '',
        },
      } : {
        company: {
          ...companyPatch,
          name: enterprise.company.name || submittedConfig.companyName,
          industry: enterprise.company.industry || submittedConfig.industry,
          mainMarkets: enterprise.company.mainMarkets || submittedConfig.targetMarkets,
        },
        strategy: {
          ...enterprise.strategy,
          focusMarkets: enterprise.strategy?.focusMarkets || submittedConfig.targetMarkets,
          focusProducts: enterprise.strategy?.focusProducts || submittedConfig.focusProducts,
        },
        customers: {
          ...enterprise.customers,
          targetProfiles: enterprise.customers?.targetProfiles || submittedConfig.customerProfile,
        },
        customerService: {
          ...enterprise.customerService,
          enabled: customerAgentEnabled,
          enabledAt: customerAgentEnabled ? (enterprise.customerService?.enabledAt || now) : '',
          disabledAt: customerAgentEnabled ? '' : now,
          partialAutoReplyEnabled: customerAgentEnabled && enterprise.customerService?.partialAutoReplyEnabled === true,
          partialAutoReplyDecision: customerAgentEnabled
            ? (enterprise.customerService?.partialAutoReplyDecision || 'pending')
            : 'pending' as const,
          partialAutoReplyDecisionAt: customerAgentEnabled ? (enterprise.customerService?.partialAutoReplyDecisionAt || '') : '',
        },
      };
      const nextVersion = Math.max(1, Number(existing?.config_version || 0) + 1);
      const prospectiveEnterprise = confirmation ? {
        ...enterprise,
        company: { ...enterprise.company, name: confirmation.companyName, industry: confirmation.industry, mainMarkets: confirmation.targetMarket },
        brand: { ...enterprise.brand, name: confirmation.brandName },
        products: { ...enterprise.products, items: confirmation.products },
        socialStrategy: { ...enterprise.socialStrategy, contentStage: confirmation.contentStage },
      } : { ...enterprise, ...enterprisePatch };
      const candidate = resolveDigitalEmployeeConfiguration({
        config: submittedConfig,
        enterpriseProfile: prospectiveEnterprise,
        configVersion: nextVersion,
        boundAt: now,
      });
      const missing = validateDigitalEmployeeConfig(candidate.config);
      if (missing.length) { res.status(400).json({ error: 'onboarding_incomplete', missing }); return; }
      let claimToken: string | null = null;
      if (confirmation) {
        try {
          claimToken = await claimEnterpriseOnboardingDraft(store, { tenantId, userId }, confirmation);
          if (!claimToken) {
            res.json(await buildOverview(tenantId));
            return;
          }
          enterprise = await applyEnterpriseOnboardingConfirmation({ tenantId, userId, confirmation });
          await assertEnterpriseOnboardingDraftClaim(store, { tenantId, userId }, confirmation.confirmationId, claimToken);
        } catch (error) {
          if (error instanceof EnterpriseOnboardingConfirmationError && error.code === 'enterprise_fact_version_conflict') {
            await releaseEnterpriseOnboardingDraftClaim(store, { tenantId, userId }, confirmation.confirmationId, claimToken);
          }
          if (error instanceof EnterpriseOnboardingDraftConflictError) {
            res.status(409).json({ error: error.code, message: error.message }); return;
          }
          if (error instanceof EnterpriseOnboardingConfirmationError) {
            res.status(error.status).json({ error: error.code, message: error.message, ...error.details }); return;
          }
          res.status(503).json({ error: 'enterprise_onboarding_confirmation_pending', message: '确认结果暂时无法核验；请保留原确认请求，约 10 分钟后重试，不要新建或重复修改。' });
          return;
        }
      }
      const enterpriseProfile = confirmation ? enterprise : await updateTenantEnterpriseProfile(tenantId, enterprisePatch, userId);
      if (confirmation && existing
        && String(existing.facts_version || '') === String(enterpriseProfile.factVersion?.id || '')) {
        const priorVersion = await first<StoredRecord>(COLLECTION.configVersions, {
          tenant_id: tenantId, config_version: Number(existing.config_version || 0),
        });
        if (priorVersion) {
          try {
            await clearEnterpriseOnboardingDraft(store, { tenantId, userId }, confirmation.confirmationId, claimToken);
            res.json(await buildOverview(tenantId));
          } catch {
            res.status(503).json({ error: 'enterprise_onboarding_completion_pending', message: '确认已保存，但回执暂时无法核验，请保留原请求；约 10 分钟后重试。' });
          }
          return;
        }
      }
      const persistedVersion = confirmation && existing
        && String(existing.facts_version || '') === String(enterpriseProfile.factVersion?.id || '')
        ? Math.max(1, Number(existing.config_version || 0)) : nextVersion;
      const resolved = resolveDigitalEmployeeConfiguration({
        config: submittedConfig,
        enterpriseProfile,
        configVersion: persistedVersion,
        boundAt: now,
      });
      const payload = {
        tenant_id: tenantId,
        config: resolved.config,
        status: 'active',
        config_version: resolved.configVersion,
        policy_version: resolved.policyVersion,
        facts_version: resolved.knowledgeBinding.factsVersion,
        effective_config: publicConfigurationMetadata(resolved),
        activated_at: now,
        updated_by: userId,
        updated_at: now,
      };
      try {
      if (confirmation) await assertEnterpriseOnboardingDraftClaim(store, { tenantId, userId }, confirmation.confirmationId, claimToken);
      if (confirmation) {
        const configAtomic = await (store.supportsAtomicCompareAndSwapFor?.(COLLECTION.config)
          ?? store.supportsAtomicCompareAndSwap?.() ?? false);
        const versionUnique = await (store.supportsAtomicCompareAndSwapFor?.(COLLECTION.configVersions)
          ?? store.supportsAtomicCompareAndSwap?.() ?? false);
        if (!configAtomic || !versionUnique || !store.compareAndSwap) throw new Error('digital_employee_config_atomicity_unavailable');
      }
      const saved = existing
        ? confirmation
          ? await store.compareAndSwap!(COLLECTION.config, existing.id, {
            tenant_id: tenantId,
            config: existing.config,
            ...(typeof existing.config_version === 'number' ? { config_version: existing.config_version } : {}),
            ...(typeof existing.updated_at === 'string' ? { updated_at: existing.updated_at } : {}),
          }, payload)
          : await store.update(COLLECTION.config, existing.id, payload)
        : Boolean(await store.create(COLLECTION.config, { ...payload, created_at: now }));
      if (!saved) throw !existing && confirmation
        ? new KnownConfigurationNoWriteError('digital_employee_config_create_returned_null')
        : new Error('onboarding_storage_unavailable');
      await requiredCreate(COLLECTION.configVersions, {
        tenant_id: tenantId,
        config_version: resolved.configVersion,
        policy_version: resolved.policyVersion,
        facts_version: resolved.knowledgeBinding.factsVersion,
        config: resolved.config,
        knowledge_binding: resolved.knowledgeBinding,
        runtime_policy: resolved.runtimePolicy,
        status: 'active',
        created_by: userId,
        created_at: now,
      });
      const activeRuns = await store.list<RunRecord>(COLLECTION.runs, { where: { tenant_id: tenantId }, perPage: 100 });
      for (const run of activeRuns.items.filter(item => !['succeeded', 'failed', 'cancelled'].includes(item.status))) {
        const activePlan = await tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId);
        if (!activePlan) continue;
        const changedFields = criticalBusinessConfigChanges(configSnapshotForPlan(activePlan, resolved.config), resolved.config);
        if (!changedFields.length) continue;
        await appendEvent({
          tenantId,
          runId: run.id,
          type: 'critical_business_change',
          level: 'warning',
          summary: '产品、市场、平台账号或真实发布许可已变更；运行中周包（含原预算边界）仍使用原授权快照，请查看影响并决定是否重新规划。',
          payload: { eventType: 'critical_business_change', changedFields, action: 'review_weekly_package' },
        });
      }
      await appendAudit({ tenantId, userId, action: 'digital_employee.onboarding.completed', targetType: 'digital_employee_config', targetId: existing?.id || tenantId, metadata: { autonomyMode: resolved.config.autonomyMode, minimalOnboarding, configVersion: resolved.configVersion, policyVersion: resolved.policyVersion, factsVersion: resolved.knowledgeBinding.factsVersion, deferredPublishingAccountIds: boundPublishing.invalidAccountIds } });
      if (confirmation) await clearEnterpriseOnboardingDraft(store, { tenantId, userId }, confirmation.confirmationId, claimToken);
      res.json(await buildOverview(tenantId));
      } catch (error) {
        let safeImmediateRetry = false;
        if (confirmation && error instanceof KnownConfigurationNoWriteError) {
          try {
            await markEnterpriseOnboardingDraftRetryable(store, { tenantId, userId }, confirmation.confirmationId, claimToken);
            safeImmediateRetry = true;
          } catch { /* Unknown claim state remains fail-closed. */ }
        }
        console.error('[onboarding] completion needs recovery', { errorType: error instanceof Error ? error.message : 'unknown' });
        res.status(503).json({
          error: confirmation
            ? safeImmediateRetry ? 'enterprise_onboarding_completion_retryable' : 'enterprise_onboarding_completion_pending'
            : 'onboarding_storage_unavailable',
          message: confirmation
            ? safeImmediateRetry
              ? '企业事实已保存，经营配置明确未写入；请保留原确认请求并立即重试，勿重新建档。'
              : '企业事实可能已保存，但经营配置尚未核实完成。请保留原确认请求，约 10 分钟后重试，勿重新建档。'
            : '经营配置暂时无法保存，请核验后重试。',
        });
      }
    });
  }

  return { registerPostOnboardingHistoryCollection, registerGetGoalsGoalIdInitialPreparation, registerPostGoalsGoalIdInitialPreparation, registerPostOnboardingComplete };
}

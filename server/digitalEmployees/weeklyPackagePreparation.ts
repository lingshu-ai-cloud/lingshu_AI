import { recommendPackage } from './weeklyPackage.js';
import { type WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { fillMatrixVideos } from '../../src/lib/weeklyMatrix.js';
import { store } from '../storage/index.js';
import { readTenantEnterpriseProfile, type EnterpriseProfile } from '../routes/enterprise.js';
import { bindDefaultProductsToPackage, enrichPackageWithContentSignals } from './contentPlanRecommendation.js';
import { evaluatePlannedReferenceReuse, hasParseableExactVideoAnalysis, reusableExplicitReferenceIds } from './viralAnalysisCoverage.js';
import { contentRoutingEvidence } from '../routes/digitalEmployeeContentEvidence.js';
import { goalInput } from './overviewProjection.js';
import { type DigitalEmployeeConfig } from './domain.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, type GoalRecord, type PlanRecord, type RunRecord, type StoredRecord } from './records.js';
import type { DigitalEmployeeApplicationPorts } from './applicationPorts.js';
import { bindWeeklyImageProducts, bindWeeklyImageReferences } from './weeklyImageReferences.js';

export function createWeeklyPackagePreparation(deps: Pick<DigitalEmployeeApplicationPorts, 'frozenEnterpriseProfileForPlan' | 'appendAudit'>) {
  const appendAudit: DigitalEmployeeApplicationPorts['appendAudit'] = (...args) => deps.appendAudit(...args);

  async function recommendPackageWithTenantEvidence(
    tenantId: string,
    goal: ReturnType<typeof goalInput>,
    config: DigitalEmployeeConfig,
    ownerId = '',
    ownerName = '',
    frozenProfile?: EnterpriseProfile,
  ): Promise<WeeklyPackage> {
    const pack = recommendPackage(goal, config, ownerId, ownerName);
    const [videos, benchmarks, enterpriseProfile, routingEvidence] = await Promise.all([
      store.list<StoredRecord>('trend_videos', { where: { tenantId }, sort: '-updatedAt', perPage: 500 }).catch(() => ({ items: [] })),
      store.list<StoredRecord>('competitor_accounts', { where: { tenantId }, sort: '-createdAt', perPage: 200 }).catch(() => ({ items: [] })),
      frozenProfile ? Promise.resolve(structuredClone(frozenProfile)) : readTenantEnterpriseProfile(tenantId),
      contentRoutingEvidence(tenantId, config, frozenProfile),
    ]);
    const enabledRoutes = enterpriseProfile.socialStrategy?.enabledRoutes || [];
    const enterprisePrimaryCta = enabledRoutes
      .map(route => enterpriseProfile.socialStrategy?.routeStrategies?.[route]?.primaryCta?.trim() || '')
      .find(Boolean) || Object.values(enterpriseProfile.socialStrategy?.routeStrategies || {})
        .map(strategy => strategy?.primaryCta?.trim() || '')
        .find(Boolean) || '';
    const matrixPlan = pack.matrixPlan?.map(row => ({ ...row, cta: enterprisePrimaryCta || row.cta }));
    const matrixBound = matrixPlan?.length
      ? fillMatrixVideos({ ...pack, matrixPlan }, config.videoDefaults || {}, goal.endsAt)
      : pack;
    const productBound = bindDefaultProductsToPackage(matrixBound, routingEvidence.products);
    // Reference selection only needs an admissible analysis. Material coverage
    // is a separate production-readiness decision, never a reason to claim the
    // tenant has no analyzed viral videos while establishing a weekly outline.
    const producibleReferences = videos.items.filter(hasParseableExactVideoAnalysis);
    // A reference is unique inside one weekly package, not permanently spent.
    // Keeping the full analyzed library lets a later week reuse a proven content
    // logic after real performance review, while package enrichment still
    // prevents the same source from occupying two slots in the current week.
    return bindWeeklyImageReferences(enrichPackageWithContentSignals({ pack: bindWeeklyImageProducts(productBound, routingEvidence.products), goal, config,
      videos: producibleReferences, benchmarks: benchmarks.items }), videos.items);
  }

  function clearAutomaticViralReferences(pack: WeeklyPackage): WeeklyPackage {
    return {
      ...pack,
      tasks: pack.tasks.map(task => task.templateId !== 'production' ? task : {
        ...task,
        videoPlans: task.videoPlans?.map(video => video.planningEvidence?.generatedFrom ? {
          ...video,
          referenceId: '',
          benchmarkAnalysis: undefined,
          preproduction: undefined,
        } : video),
      }),
    };
  }

  async function bindWeeklyViralLibraryToPackage(input: {
    tenantId: string;
    run: RunRecord;
    goal: GoalRecord;
    plan: PlanRecord | null;
    config: DigitalEmployeeConfig;
    pack: WeeklyPackage;
  }): Promise<{ pack: WeeklyPackage; inventory: ReturnType<typeof evaluatePlannedReferenceReuse>; changed: boolean }> {
    const production = input.pack.tasks.find(task => task.templateId === 'production');
    const plans = production?.videoPlans || [];
    const library = await store.list<StoredRecord>('trend_videos', { where: { tenantId: input.tenantId }, sort: '-updatedAt', perPage: 500 });
    const coveredReferenceIds = new Set(library.items.filter(hasParseableExactVideoAnalysis).map(item => item.id));
    // Cross-week use is allowed. The evaluator receives only the current weekly
    // selection and therefore enforces one-content-one-slot for this week.
    const usedReferenceIds: string[] = [];
    const currentInventory = evaluatePlannedReferenceReuse(plans, library.items, usedReferenceIds);
    const selectedReferencesCovered = plans.every(plan => plan.route !== 'clone'
      || Boolean(plan.referenceId && coveredReferenceIds.has(plan.referenceId)));
    if (currentInventory.ready && selectedReferencesCovered) return { pack: input.pack, inventory: currentInventory, changed: false };
    const explicitReferenceIds = new Set(reusableExplicitReferenceIds(plans));
    const candidates = library.items.filter(item => coveredReferenceIds.has(item.id)
      && (explicitReferenceIds.has(item.id) || hasParseableExactVideoAnalysis(item)));
    const benchmarks = await store.list<StoredRecord>('competitor_accounts', { where: { tenantId: input.tenantId }, sort: '-createdAt', perPage: 200 }).catch(() => ({ items: [] }));
    const cleared = clearAutomaticViralReferences(input.pack);
    const rebound = enrichPackageWithContentSignals({
      pack: cleared,
      goal: goalInput(input.goal),
      config: input.config,
      videos: candidates,
      benchmarks: benchmarks.items,
    });
    const originalByContentId = new Map(plans.map(video => [video.contentId, video]));
    const preserved: WeeklyPackage = {
      ...rebound,
      tasks: rebound.tasks.map(task => task.templateId !== 'production' ? task : {
        ...task,
        videoPlans: task.videoPlans?.map(video => {
          const original = originalByContentId.get(video.contentId);
          return original?.referenceId && original.referenceId === video.referenceId && original.preproduction
            ? { ...video, preproduction: original.preproduction }
            : video;
        }),
      }),
    };
    const reboundPlans = preserved.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
    const inventory = evaluatePlannedReferenceReuse(reboundPlans, library.items, usedReferenceIds);
    const changed = JSON.stringify(preserved) !== JSON.stringify(input.pack);
    if (changed && input.plan) {
      const body = jsonObject<Record<string, unknown>>(input.plan.plan, {});
      const nextBody = { ...body, businessPackage: preserved, viralInventoryBoundAt: new Date().toISOString() };
      await store.update(COLLECTION.plans, input.plan.id, { plan: nextBody });
      input.plan.plan = nextBody;
      await appendAudit({
        tenantId: input.tenantId,
        userId: input.goal.owner_id || 'digital_employee_agent',
        action: 'weekly_viral_inventory.bound',
        targetType: 'weekly_plan',
        targetId: input.plan.id,
        metadata: {
          runId: input.run.id,
          reusableReferenceIds: inventory.selectedReferenceIds,
          missingCount: inventory.missingCount,
        },
      });
    }
    return { pack: preserved, inventory, changed };
  }

  return { recommendPackageWithTenantEvidence, bindWeeklyViralLibraryToPackage };
}

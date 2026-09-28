import { store } from '../storage/index.js';
import { crawlVideosForTenant, inferPlatformFromUrl } from '../routes/videos.js';
import { dueDiscoveryModes, nextDiscoveryRunAt, validateDiscoveryBrief } from './domain.js';
import { planRollingSevenDayQuotas } from './qualityOrchestration.js';
import { hasLegacyProductTitleQueries } from '../../shared/productDiscovery.js';
import { runCandidateEvidenceWorker, type CandidateEvidenceWorkResult } from './candidateEvidenceWorker.js';
import { createR3CandidateEvidenceAdapter, type R3CandidateEvidenceAdapter } from './r3CandidateEvidenceAdapter.js';
import type { CrawlVideosInput, CrawlVideosResult } from '../routes/videos.js';
import type { DataStore } from '../storage/datastore.js';
import type {
  SocialCrawlStrategy,
  SocialDiscoveryBrief,
  SocialDiscoveryMode,
  SocialDiscoveryModeRunStats,
  SocialInspirationCollectionRun,
} from '../../shared/contracts/socialContentWorkflow.js';

type SocialDiscoveryBriefWithQuality = SocialDiscoveryBrief & { innovationExperimentShare?: number };

export const DISCOVERY_SCOPE_COLLECTION = 'social_discovery_scopes';
export const DISCOVERY_RUN_COLLECTION = 'social_discovery_runs';

export interface ApprovedDiscoveryRunDependencies {
  dataStore: DataStore;
  crawl(input: CrawlVideosInput): Promise<CrawlVideosResult>;
  candidateEvidenceAdapter: R3CandidateEvidenceAdapter;
  runCandidateEvidence(items: Parameters<typeof runCandidateEvidenceWorker>[0]): Promise<CandidateEvidenceWorkResult>;
}

const defaultDependencies: ApprovedDiscoveryRunDependencies = {
  dataStore: store,
  crawl: crawlVideosForTenant,
  candidateEvidenceAdapter: createR3CandidateEvidenceAdapter(),
  runCandidateEvidence: runCandidateEvidenceWorker,
};

export type DiscoveryScopeRecord = {
  id: string;
  tenant_id: string;
  keyword_set_id: string;
  version: number;
  status: 'active' | 'retired';
  payload: SocialCrawlStrategy;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export async function loadActiveDiscoveryScope(tenantId: string): Promise<DiscoveryScopeRecord | null> {
  const result = await store.list<DiscoveryScopeRecord>(DISCOVERY_SCOPE_COLLECTION, {
    where: { tenant_id: tenantId, status: 'active' }, sort: '-updated_at', page: 1, perPage: 1,
  });
  return result.items[0] ?? null;
}

function modeRefs(scope: DiscoveryScopeRecord, mode: SocialDiscoveryMode): string[] {
  const brief = scope.payload.discoveryBrief;
  const policy = brief.modePolicies?.[mode];
  if (policy?.sourceRefs.length) return policy.sourceRefs;
  if (mode === 'account') return brief.competitorAccounts;
  if (mode === 'innovation' && brief.productionGap) return [brief.productionGap];
  return scope.payload.keywords
    .filter(item => mode === 'momentum'
      ? item.category === 'discovery_seed' || item.category === 'scene_cluster'
      : item.category === 'evidence_query')
    .flatMap(item => item.values);
}

export async function executeApprovedDiscoveryRun(input: {
  tenantId: string;
  triggerType: 'scheduled' | 'manual' | 'production_gap';
  requestedModes?: SocialDiscoveryMode[];
  expectedScopeId?: string;
  expectedScopeVersion?: number;
  productionGapContext?: {
    gapTaskId: string;
    upstreamTaskRef: string;
    description: string;
    remainingBudgetCny: number;
  };
}, dependencies: ApprovedDiscoveryRunDependencies = defaultDependencies): Promise<{ run?: SocialInspirationCollectionRun; skipped?: true; reason?: string; nextRunAt?: string | null }> {
  if (input.triggerType === 'production_gap' && !input.productionGapContext) throw new Error('production_gap_context_required');
  const scopeResult = await dependencies.dataStore.list<DiscoveryScopeRecord>(DISCOVERY_SCOPE_COLLECTION, {
    where: { tenant_id: input.tenantId, status: 'active' }, sort: '-updated_at', page: 1, perPage: 1,
  });
  const scope = scopeResult.items[0] ?? null;
  if (!scope) throw new Error('discovery_scope_not_found');
  if (input.expectedScopeId && input.expectedScopeId !== scope.id) return { skipped: true, reason: 'discovery_scope_superseded' };
  if (input.expectedScopeVersion && input.expectedScopeVersion !== scope.version) return { skipped: true, reason: 'discovery_scope_version_superseded' };
  if (scope.payload.approval?.status !== 'approved' || scope.payload.approval.scopeVersion !== scope.version) {
    throw new Error('discovery_scope_not_approved');
  }

  const brief = structuredClone(scope.payload.discoveryBrief);
  // The account library is the user's current source of truth. A saved scope
  // snapshot must not keep collecting an account after it is removed there.
  const savedAccounts = await dependencies.dataStore.list<{ accountUrl: string; accountName?: string }>('competitor_accounts', {
    where: { tenantId: input.tenantId }, page: 1, perPage: 200,
  });
  const accountNameByUrl = new Map(savedAccounts.items.map(account => [account.accountUrl, account.accountName || account.accountUrl]));
  brief.competitorAccounts = [...accountNameByUrl.keys()];
  if (brief.modePolicies?.account) brief.modePolicies.account.sourceRefs = brief.competitorAccounts;
  if (input.productionGapContext) {
    brief.productionGap = input.productionGapContext.description;
    brief.budgetLimitCny = Math.max(0, input.productionGapContext.remainingBudgetCny);
  }
  const previousRuns = (await dependencies.dataStore.list<SocialInspirationCollectionRun>(DISCOVERY_RUN_COLLECTION, {
      where: { tenant_id: input.tenantId, keywordSetId: brief.keywordSetId }, sort: '-startedAt', page: 1, perPage: 200,
    })).items;
  const candidates = input.triggerType === 'scheduled'
    ? dueDiscoveryModes(brief, previousRuns)
    : input.requestedModes ?? brief.discoveryModes;
  const legacyProductTitles = !scope.payload.keywordRecommendation
    && hasLegacyProductTitleQueries(scope.payload.keywordSet?.graph?.discoverySeeds ?? []);
  const configuredShare = Number((brief as SocialDiscoveryBriefWithQuality).innovationExperimentShare ?? 0.15);
  const quotaPlan = planRollingSevenDayQuotas(previousRuns, {
    totalAcceptedTarget: brief.resultLimit,
    innovationShare: configuredShare,
  });
  const requestedModes = [...new Set(candidates)].filter(mode => brief.discoveryModes.includes(mode)
    && brief.modePolicies?.[mode]?.enabled
    && (mode === 'account' || !legacyProductTitles)
    && (mode !== 'account' || brief.competitorAccounts.length > 0)
    && (input.triggerType === 'production_gap' || quotaPlan.remainingByMode[mode] > 0));
  if (!requestedModes.length) return { skipped: true, reason: 'no_discovery_mode_due', nextRunAt: nextDiscoveryRunAt(brief, previousRuns) };
  brief.discoveryModes = requestedModes;
  const issues = validateDiscoveryBrief(brief);
  if (issues.length) throw new Error(`discovery_run_scope_invalid: ${issues.join('; ')}`);

  const startedAt = new Date().toISOString();
  const runId = `discovery_run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const queryBasis = Object.fromEntries(requestedModes.map(mode => [mode, mode === 'account' ? brief.competitorAccounts : modeRefs(scope, mode)])) as Partial<Record<SocialDiscoveryMode, string[]>>;
  const initial: SocialInspirationCollectionRun & { tenant_id: string } = {
    tenant_id: input.tenantId, runId, planId: brief.discoveryBriefId, keywordSetId: brief.keywordSetId, keywordSetVersion: brief.keywordSetVersion,
    discoveryScopeId: scope.id, discoveryScopeVersion: scope.version, status: 'running', triggerType: input.triggerType,
    scopeSnapshot: brief, modeStats: {}, evidenceOutcomes: {}, sourceRunRefs: [], queryBasis, market: scope.payload.market || brief.market, language: scope.payload.language || '',
    stopReason: null, startedAt, finishedAt: null, error: null,
  };
  const created = await dependencies.dataStore.create<SocialInspirationCollectionRun & { id: string }>(DISCOVERY_RUN_COLLECTION, { ...initial });
  if (!created) throw new Error('discovery_run_storage_unavailable');

  const modeStats: SocialInspirationCollectionRun['modeStats'] = {};
  const evidenceOutcomes: NonNullable<SocialInspirationCollectionRun['evidenceOutcomes']> = {};
  const sourceRunRefs: string[] = [];
  let error: string | null = null;
  for (const mode of requestedModes) {
    const policy = brief.modePolicies![mode]!;
    const stats: SocialDiscoveryModeRunStats = { requested: 0, fetched: 0, deduplicated: 0, accepted: 0, momentumCandidates: 0, failed: 0, costCny: null, effectiveRate: null };
    const refs = queryBasis[mode] ?? [];
    const configuredPlatforms = policy.platforms.length ? policy.platforms : brief.platforms;
    const targets = refs.flatMap(ref => /^https?:\/\//i.test(ref)
      ? [{ ref, platform: inferPlatformFromUrl(ref) }]
      : configuredPlatforms.filter(platform => ['tiktok', 'instagram', 'youtube', 'facebook'].includes(platform)).map(platform => ({ ref, platform: platform as ReturnType<typeof inferPlatformFromUrl> })));
    // Scheduled/manual discovery fills accepted-item gaps. A production gap owns its
    // independent budget and is therefore bounded by its explicit mode policy.
    let remaining = input.triggerType === 'production_gap'
      ? policy.resultLimit
      : Math.min(policy.resultLimit, quotaPlan.remainingByMode[mode]);
    const alreadyAccepted = new Set(quotaPlan.acceptedCandidateIdsByMode[mode]);
    const acceptedCandidateIds = new Set<string>();
    const acceptedEvidenceRefs = new Set<string>();
    const suggestionCandidateIds = new Set<string>();
    const failedCandidateIds = new Set<string>();
    const momentumCandidateIds = new Set<string>();
    for (const [index, target] of targets.entries()) {
      if (remaining <= 0) break;
      const perSourceLimit = Math.max(1, Math.ceil(remaining / Math.max(1, targets.length - index)));
      stats.requested += perSourceLimit;
      try {
        const dateTo = new Date().toISOString().slice(0, 10);
        const dateFrom = new Date(Date.now() - brief.lookbackDays * 86_400_000).toISOString().slice(0, 10);
        const result = await dependencies.crawl({
          tenantId: input.tenantId,
          platform: target.platform,
          mode: mode === 'account' ? 'account' : 'keyword',
          ...(mode === 'account' ? { accountUrl: target.ref, accountName: accountNameByUrl.get(target.ref) || target.ref } : { keyword: target.ref }),
          limit: perSourceLimit,
          dateFrom,
          dateTo,
          discoveryContext: { runId, scopeId: scope.id, scopeVersion: scope.version, mode, queryRef: target.ref },
        });
        stats.fetched += Number(result.total || 0);
        stats.deduplicated += Number(result.skippedExisting || 0);
        const workItems = await dependencies.candidateEvidenceAdapter.toEvidenceWorkItems({
          tenantId: input.tenantId, runId, scopeId: scope.id, scopeVersion: scope.version,
          mode, queryRef: target.ref, result, observedAt: new Date().toISOString(),
        });
        const evidenceResult = await dependencies.runCandidateEvidence(workItems);
        for (const item of evidenceResult.accepted) {
          acceptedCandidateIds.add(item.candidateId);
          acceptedEvidenceRefs.add(`${item.evidenceId}@${item.version}`);
        }
        evidenceResult.suggestions.forEach(item => suggestionCandidateIds.add(item.candidateId));
        evidenceResult.failed.forEach(item => failedCandidateIds.add(item.candidateId));
        stats.failed += evidenceResult.failed.length;
        if (mode === 'momentum') evidenceResult.accepted
          .filter(item => item.evidence.momentum.level !== 'unknown')
          .forEach(item => momentumCandidateIds.add(item.candidateId));
        const newlyQualified = evidenceResult.accepted
          .filter(item => !alreadyAccepted.has(item.candidateId))
          .filter((item, itemIndex, values) => values.findIndex(value => value.candidateId === item.candidateId) === itemIndex).length;
        evidenceResult.accepted.forEach(item => alreadyAccepted.add(item.candidateId));
        remaining = Math.max(0, remaining - newlyQualified);
        sourceRunRefs.push(`${mode}:${target.platform}:${result.source}`);
      } catch (cause) {
        stats.failed += 1;
        error = cause instanceof Error ? cause.message : '采集来源失败';
      }
    }
    stats.accepted = acceptedCandidateIds.size;
    stats.momentumCandidates = momentumCandidateIds.size;
    stats.effectiveRate = stats.fetched > 0 ? stats.accepted / stats.fetched : null;
    modeStats[mode] = stats;
    evidenceOutcomes[mode] = {
      acceptedCandidateIds: [...acceptedCandidateIds], acceptedEvidenceRefs: [...acceptedEvidenceRefs],
      suggestionCandidateIds: [...suggestionCandidateIds], failedCandidateIds: [...failedCandidateIds],
    };
  }
  const failed = Object.values(modeStats).reduce((sum, item) => sum + (item?.failed || 0), 0);
  const accepted = Object.values(modeStats).reduce((sum, item) => sum + (item?.accepted || 0), 0);
  const status = failed ? (accepted ? 'partial' as const : 'failed' as const) : accepted ? 'succeeded' as const : 'stopped' as const;
  const finishedAt = new Date().toISOString();
  const run: SocialInspirationCollectionRun = {
    ...initial, status, modeStats, evidenceOutcomes, sourceRunRefs,
    stopReason: status === 'failed' ? 'source_failed' : status === 'stopped' ? 'no_valid_results' : 'completed', finishedAt, error,
  };
  const saved = await dependencies.dataStore.update(DISCOVERY_RUN_COLLECTION, created.id, { status, modeStats, evidenceOutcomes, sourceRunRefs, stopReason: run.stopReason, finishedAt, error });
  if (!saved) throw new Error('discovery_run_storage_unavailable');
  return { run };
}

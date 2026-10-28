import type { BenchmarkAnalysis, BenchmarkMaterialType, BenchmarkShot } from '../../shared/benchmarkAnalysis.js';
import {
  buildLocalMaterialSegmentProfile,
  evaluateLocalMaterialSegmentProfile,
  inferLocalMaterialSegmentType,
  normalizeLocalMaterialSegmentProfile,
  type LocalMaterialSegmentProfile,
} from '../../shared/contracts/localMaterialSegmentProfile.js';
import {
  evaluateProductionOnboardingReadiness,
  type ProductionOnboardingEvidence,
  type ProductionOnboardingPreferences,
  type ProductionOnboardingReadiness,
} from '../../shared/contracts/productionOnboarding.js';
import type { VideoCreationPlan } from '../../shared/contracts/videoCreationPlan.js';
import {
  FIXED_YIELD_ARCHETYPE_IDS,
  type FixedYieldArchetypeId,
} from '../../shared/fixedYieldMaterialRegistry.js';
import type { DataStore } from '../storage/datastore.js';
import { validateHeyGenPresenterRecord } from '../lib/presenterAssetTrust.js';
import type { EnterpriseProfile } from '../routes/enterprise.js';
import { verifyEnterpriseFactContent } from '../routes/enterprise.js';
import { normalizeProfile } from '../routes/enterpriseProfileStore.js';
import { frozenEnterpriseProfileMatchesCanonical } from './configuration.js';
import { collectProductionAssets } from './contentProduction.js';
import type { AssetCandidate } from './contentProductionContracts.js';

const text = (value: unknown): string => String(value ?? '').normalize('NFKC').trim();
const normalized = (value: unknown): string => text(value).toLocaleLowerCase();
const archetypeIds = new Set<string>(FIXED_YIELD_ARCHETYPE_IDS);

function shotText(shot: BenchmarkShot): string {
  return normalized([
    shot.visual, shot.environment, shot.framing, shot.camera, shot.purpose,
    shot.onScreenText, shot.dialogue, shot.authenticity,
    ...Object.values(shot.detailedAnalysis || {}),
  ].filter(Boolean).join(' '));
}

/** Deterministic classification of an already-reviewed reference shot. It
 * never invokes a model and therefore can be used before any paid work. */
export function fixedYieldArchetypeForBenchmarkShot(shot: BenchmarkShot): FixedYieldArchetypeId | null {
  const value = shotText(shot);
  if (shot.materialType === 'unknown') return null;
  if (shot.materialType === 'talking_head') {
    if (shot.narrativeRole === 'cta' || /联系|私信|咨询|whatsapp|email|website|call.?to.?action|\bcta\b/.test(value)) return 'P1E_PRESENTER_CTA';
    if (/手持|手拿|拿着|触碰|演示产品|holding product|product contact/.test(value)) return 'P1F_REAL_PRODUCT_CONTACT';
    const moves = /走|行走|移动|推车|转身|walk|moving|cart|turn/.test(value);
    const shelf = /货架|样品间|展厅|陈列|shelf|showroom|retail/.test(value);
    if (shelf) return moves ? 'P1D_SHELF_ACTION_TALK' : 'P1C_SHELF_STAND_TALK';
    return moves ? 'P1A_FACTORY_WALK_TALK' : 'P1B_FACTORY_STAND_TALK';
  }
  if (shot.materialType === 'product') {
    if (/第一视角|手持|手拿|拿着|handheld|holding product/.test(value)) return 'P2A_HANDHELD_PRODUCT_WALL';
    if (/标签|包装|材质|结构|细节|特写|微距|label|package|detail|macro|close.?up/.test(value)) return 'P2C_PACKAGE_DETAIL';
    if (/平移|推进|环绕|旋转|运镜|pan|push|orbit|rotate|product motion/.test(value)) return 'P2D_PRODUCT_MOTION';
    return 'P2B_PRODUCT_SHELF';
  }
  if (shot.materialType === 'factory') {
    if (/质检|抽检|称重|贴标|装箱|码垛|包装|inspection|quality|packing|labeling/.test(value)) return 'P3C_QC_PACKING';
    if (/工人|员工|人工|装配|组装|操作员|worker|operator|assembly/.test(value)) return 'P3A_WORKER_PROCESS';
    if (/机器|设备|灌装|旋盖|输送|喷码|machine|filling|capping|conveyor/.test(value)) return 'P3B_MACHINE_CLOSEUP';
    return 'P3D_FACTORY_ESTABLISH';
  }
  if (shot.materialType === 'consumer_demo') {
    if (shot.narrativeRole === 'effect_proof' || /结果|使用后|效果|对比|result|after/.test(value)) return 'P4C_USAGE_RESULT';
    if (/使用|涂抹|擦拭|揉搓|起泡|清洁|按压|喷洒|apply|use|rub|foam|press|spray/.test(value)) return 'P4B_USAGE_ACTION';
    return 'P4A_USAGE_SETUP';
  }
  if (/展会|展位|博览会|exhibition|trade.?show|booth/.test(value)) return 'P5A_EXHIBITION';
  if (/客户|案例|合作|customer.?case|client/.test(value)) return 'P5B_CUSTOMER_CASE';
  if (/仓储|物流|出货|发货|装车|warehouse|logistics|shipping/.test(value)) return 'P5C_LOGISTICS_WAREHOUSE';
  if (shot.narrativeRole === 'cta' || /品牌收尾|联系|私信|二维码|logo|\bcta\b/.test(value)) return 'P5E_BRAND_CTA';
  return 'P5D_VERIFIED_FACT';
}

export function requiredFixedYieldArchetypes(
  plans: Array<Pick<VideoCreationPlan, 'productionRole' | 'benchmarkAnalysis'> & Partial<Pick<VideoCreationPlan, 'route'>>>,
): FixedYieldArchetypeId[] {
  return [...new Set(plans
    .filter(plan => plan.productionRole !== 'platform_adaptation')
    .flatMap(plan => (plan.benchmarkAnalysis?.shots ?? []).map(shot => ({ shot, route: plan.route })))
    .map(({ shot, route }) => {
      const archetype = fixedYieldArchetypeForBenchmarkShot(shot);
      // Managed clone executes non-person shots through its own material
      // matcher/generator. The fixed-yield local-video catalogue is not its
      // production executor and must not veto a usable weekly plan.
      return route === 'clone' && archetype && !archetype.startsWith('P1') ? null : archetype;
    })
    .filter((item): item is FixedYieldArchetypeId => Boolean(item)))];
}

export interface FixedYieldLocalMaterialRequirement {
  requirementId: string;
  planIndex: number;
  shotIndex: number;
  archetypeId: FixedYieldArchetypeId;
  materialType: Exclude<BenchmarkMaterialType, 'unknown'>;
  requiredDurationSeconds: number;
  requestedProductRef: string | null;
}

export function requiredFixedYieldLocalMaterials(
  plans: Array<Pick<VideoCreationPlan, 'productionRole' | 'benchmarkAnalysis' | 'productId'> & Partial<Pick<VideoCreationPlan, 'route'>>>,
): FixedYieldLocalMaterialRequirement[] {
  return plans.flatMap((plan, planIndex) => plan.productionRole === 'platform_adaptation' || plan.route === 'clone' ? [] : (plan.benchmarkAnalysis?.shots ?? []).flatMap((shot, shotIndex) => {
    const archetypeId = fixedYieldArchetypeForBenchmarkShot(shot);
    if (!archetypeId || archetypeId.startsWith('P1') || shot.materialType === 'unknown'
      || shot.start === null || shot.end === null || shot.end <= shot.start) return [];
    return [{
      requirementId: `${planIndex + 1}:${plan.benchmarkAnalysis?.source.videoId || 'reference'}:${shot.shotId}`,
      planIndex,
      shotIndex,
      archetypeId,
      materialType: shot.materialType,
      requiredDurationSeconds: shot.end - shot.start,
      requestedProductRef: text(plan.productId) || null,
    }];
  }));
}

type AssetProfileCarrier = AssetCandidate & {
  sourceRevision?: unknown;
  currentSourceRevision?: unknown;
};

interface InventorySegmentProfile {
  asset: AssetCandidate;
  profile: LocalMaterialSegmentProfile;
  currentSourceRevision: string;
  persisted: boolean;
  assetRightsConsistent: boolean;
}

function overlaps(left: string[], right: string[]): boolean {
  const values = new Set(left);
  return right.some(value => values.has(value));
}

/** A persisted profile is authoritative on its own, but an explicit asset-level
 * revocation or conflicting approval receipt always wins. Missing asset-level
 * fields do not erase a complete persisted profile; they do prevent creating a
 * new profile from analysis alone. */
function assetRightsConsistentWithProfile(asset: AssetCandidate, profile: LocalMaterialSegmentProfile): boolean {
  if (asset.commercialUseApproved !== undefined && asset.commercialUseApproved !== true) return false;
  if (asset.derivativeUseAllowed !== undefined && asset.derivativeUseAllowed !== true) return false;
  if (asset.rightsEvidenceRefs?.length && !overlaps(asset.rightsEvidenceRefs, profile.rightsEvidenceRefs)) return false;
  if (asset.commercialUseApprovalEvidenceRefs?.length
    && !overlaps(asset.commercialUseApprovalEvidenceRefs, profile.commercialUseApprovalEvidenceRefs)) return false;
  return true;
}

function candidateProfiles(asset: AssetCandidate, tenantId: string): InventorySegmentProfile[] {
  const owned = asset.authorization.status === 'owned' && asset.authorization.scope === 'tenant' && asset.source === 'tenant_material';
  const shared = asset.authorization.status === 'licensed' && asset.authorization.scope === 'shared' && asset.source === 'licensed_shared_material';
  if (asset.type !== 'video' || asset.synthetic || (!owned && !shared) || asset.duration <= 0) return [];
  const carrier = asset as AssetProfileCarrier;
  const rawProfiles = [
    ...(Array.isArray(carrier.segmentProfiles) ? carrier.segmentProfiles : []),
    ...(asset.segments ?? []).flatMap(segment => [segment.segmentProfile, segment.localMaterialSegmentProfile].filter(Boolean)),
  ];
  const result: InventorySegmentProfile[] = rawProfiles.flatMap(value => {
    const profile = normalizeLocalMaterialSegmentProfile(value);
    if (!profile) return [];
    const currentSourceRevision = text(carrier.currentSourceRevision) || text(carrier.sourceRevision)
      || text(asset.scriptAnalysis?.sourceRevision) || profile.sourceRevision;
    return [{ asset, profile: shared ? { ...profile, tenantId } : profile, currentSourceRevision, persisted: true,
      assetRightsConsistent: assetRightsConsistentWithProfile(asset, profile) }];
  });
  const analysis = asset.scriptAnalysis;
  if (analysis?.schemaVersion === 'material-script-analysis.v3' && analysis.status === 'ready') {
    const currentSourceRevision = text(carrier.currentSourceRevision) || text(carrier.sourceRevision) || text(analysis.sourceRevision);
    for (const shot of analysis.shots) {
      const assessment = buildLocalMaterialSegmentProfile({
        tenantId,
        sourceTenantId: shared ? null : tenantId,
        origin: shared ? 'shared_library' : 'my_materials',
        assetId: asset.id,
        segmentId: shot.segmentId,
        sourceRevision: analysis.sourceRevision,
        currentSourceRevision,
        mediaType: asset.type,
        synthetic: asset.synthetic,
        startSeconds: shot.editorial.trim.preferredStartSeconds,
        endSeconds: shot.editorial.trim.preferredEndSeconds,
        materialType: inferLocalMaterialSegmentType({ materialRoles: shot.materialRoles, visualContract: shot.visualContract }),
        materialRoles: shot.materialRoles,
        productId: shot.visualContract.product.requestedProductId || asset.productId || null,
        productRef: shot.visualContract.product.requestedProductRef || asset.productId || null,
        visualContract: shot.visualContract,
        observedActionTags: shot.editorial.actions,
        framingTags: shot.editorial.shotLanguage,
        cameraMovementTags: [shot.visualContract.camera.movement],
        entityAndTextTags: [...shot.editorial.subjects, ...shot.observedEvidence],
        // Analysis describes the picture; it never grants usage rights. A new
        // profile can only inherit explicit, persisted rights facts.
        rightsEvidenceRefs: asset.rightsEvidenceRefs ?? [],
        commercialUseApproved: asset.commercialUseApproved === true,
        commercialUseApprovalEvidenceRefs: asset.commercialUseApprovalEvidenceRefs ?? [],
        modelInputAllowed: asset.modelInputAllowed === true,
        derivativeUseAllowed: asset.derivativeUseAllowed === true,
        confidence: shot.confidence,
        needsReview: shot.needsReview,
        cleanEntry: shot.editorial.trim.cleanEntry,
        cleanExit: shot.editorial.trim.cleanExit,
      });
      if (assessment.profile) result.push({ asset, profile: assessment.profile, currentSourceRevision,
        persisted: false, assetRightsConsistent: assetRightsConsistentWithProfile(asset, assessment.profile) });
    }
  }
  const unique = new Map<string, InventorySegmentProfile>();
  for (const item of result) {
    const key = `${item.profile.assetId}:${item.profile.segmentId}:${item.profile.sourceRevision}`;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, item);
      continue;
    }
    // Never allow an analysis-derived duplicate (or a later optimistic stored
    // duplicate) to overwrite a persisted rejection for the same immutable
    // segment revision.
    if (existing.persisted && (!existing.profile.productionEligible || !existing.assetRightsConsistent)) continue;
    if (item.persisted && (!item.profile.productionEligible || !item.assetRightsConsistent)) unique.set(key, item);
  }
  return [...unique.values()];
}

function structurallyCurrentProfile(item: InventorySegmentProfile, tenantId: string): boolean {
  const { asset, profile, currentSourceRevision } = item;
  return item.assetRightsConsistent
    && profile.productionEligible && profile.commercialUseApproved
    && profile.derivativeUseAllowed
    && profile.rightsEvidenceRefs.length > 0 && profile.commercialUseApprovalEvidenceRefs.length > 0
    && profile.tenantId === tenantId && profile.assetId === asset.id
    && Boolean(currentSourceRevision) && profile.sourceRevision === currentSourceRevision
    && profile.startMs >= 0 && profile.endMs > profile.startMs
    && profile.endMs <= Math.round(asset.duration * 1000);
}

/** Maps authorized and analyzed tenant videos or licensed shared-library videos.
 * Product images, reference-only viral videos and synthetic output cannot satisfy footage readiness. */
export function inventoryFixedYieldArchetypes(
  assets: AssetCandidate[],
  input: { tenantId: string; requirements?: FixedYieldLocalMaterialRequirement[] },
): FixedYieldArchetypeId[] {
  const requirements = input.requirements ?? [];
  if (requirements.length) {
    const missing = new Set(missingFixedYieldLocalMaterials(assets, { tenantId: input.tenantId, requirements }).map(item => item.archetypeId));
    return [...new Set(requirements.map(item => item.archetypeId).filter(item => !missing.has(item)))];
  }
  const profiles = assets.flatMap(asset => candidateProfiles(asset, input.tenantId))
    .filter(item => structurallyCurrentProfile(item, input.tenantId));
  return [...new Set(profiles.flatMap(item => item.profile.archetypeCandidates).filter(item => archetypeIds.has(item)))];
}

/** Exact unmatched shot requirements, using the same one-segment-per-shot
 * matching as the production preflight. An upload is not ready until analysis
 * produces a current, eligible segment profile. */
export function missingFixedYieldLocalMaterials(
  assets: AssetCandidate[],
  input: { tenantId: string; requirements: FixedYieldLocalMaterialRequirement[] },
): FixedYieldLocalMaterialRequirement[] {
  const profiles = assets.flatMap(asset => candidateProfiles(asset, input.tenantId))
    .filter(item => structurallyCurrentProfile(item, input.tenantId));
  const used = new Set<string>();
  const missing: FixedYieldLocalMaterialRequirement[] = [];
  for (const requirement of input.requirements) {
    const match = profiles.find(item => {
      const identity = `${item.profile.assetId}:${item.profile.segmentId}:${item.profile.sourceRevision}`;
      if (used.has(identity)) return false;
      const reasons = evaluateLocalMaterialSegmentProfile({
        profile: item.profile,
        tenantId: input.tenantId,
        assetId: item.asset.id,
        segmentId: item.profile.segmentId,
        sourceRevision: item.currentSourceRevision,
        targetMaterialType: requirement.materialType,
        targetArchetypeId: requirement.archetypeId,
        requestedProductRef: requirement.requestedProductRef,
        requiredDurationSeconds: requirement.requiredDurationSeconds,
      });
      return reasons.length === 0;
    });
    if (!match) {
      missing.push(requirement);
      continue;
    }
    used.add(`${match.profile.assetId}:${match.profile.segmentId}:${match.profile.sourceRevision}`);
  }
  return missing;
}

function confirmedEnterpriseFacts(profile: EnterpriseProfile): boolean {
  const version = profile.factVersion;
  return Boolean(version?.id && version.contentHash && version.confirmedBy && version.confirmedBy !== 'system'
    && Number.isFinite(Date.parse(version.confirmedAt)) && Date.parse(version.confirmedAt) <= Date.now()
    && verifyEnterpriseFactContent(profile).verified);
}

export function enterpriseOnboardingEvidence(
  profile: EnterpriseProfile,
  presenterDefaults: Array<{ tenant_id?: string; payload?: Record<string, unknown> }>,
  tenantId: string,
  assets: AssetCandidate[],
  budgetConfirmed: boolean,
  materialRequirements?: FixedYieldLocalMaterialRequirement[],
  confirmedByCanonical = false,
): ProductionOnboardingEvidence {
  const confirmed = confirmedByCanonical || confirmedEnterpriseFacts(profile);
  const companyReady = confirmed && Boolean(text(profile.company?.name) && text(profile.company?.industry) && text(profile.company?.description));
  const brandReady = confirmed && Boolean(text(profile.brand?.name) && (text(profile.brand?.tone) || text(profile.brand?.style) || text(profile.brand?.usp)));
  const productFactsReady = confirmed && Boolean((profile.products?.items ?? []).some(product => text(product.name)
    && Boolean(text(product.sku) || text(product.category) || text(product.material) || text(product.highlights)
      || text(product.moq) || text(product.certifications) || Object.keys(product.attributes ?? {}).length)));
  let presenterReady = false;
  let voiceReady = false;
  if (presenterDefaults.length === 1 && presenterDefaults[0]!.tenant_id === tenantId) {
    const payload = presenterDefaults[0]!.payload ?? {};
    const presenters = Array.isArray(payload.presenters) ? payload.presenters.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>> : [];
    const selectedId = text(payload.defaultPresenterId);
    const matches = selectedId
      ? presenters.filter(item => text(item.id) === selectedId || text(item.avatarId) === selectedId)
      : presenters.length === 1 ? presenters : [];
    if (matches.length === 1) {
      const checked = validateHeyGenPresenterRecord(matches[0]!);
      presenterReady = checked.ok;
      voiceReady = checked.ok && Boolean(checked.voiceId);
    }
  }
  return {
    companyReady, brandReady, productFactsReady, presenterReady, voiceReady,
    inventoryArchetypes: inventoryFixedYieldArchetypes(assets, { tenantId, requirements: materialRequirements }), budgetConfirmed,
  };
}

export type ServerProductionOnboardingReadiness = ProductionOnboardingReadiness & {
  requiredArchetypes: FixedYieldArchetypeId[];
  evidence: ProductionOnboardingEvidence;
  materialRequirementGaps?: FixedYieldLocalMaterialRequirement[];
};

export function compatibleProductionOnboardingPreferences(
  profile: EnterpriseProfile,
  evidence: ProductionOnboardingEvidence,
  preferences?: ProductionOnboardingPreferences,
): ProductionOnboardingPreferences | undefined {
  if (preferences) return preferences;
  const confirmedAt = text(profile.factVersion?.confirmedAt);
  if (!confirmedAt || !evidence.companyReady || !evidence.brandReady || !evidence.productFactsReady) return undefined;
  return {
    schemaVersion: 'fixed-yield.production-onboarding.v1',
    contact: { kind: 'none', value: '', primaryCta: '' },
    presenterPolicy: 'local_video_only',
    output: { primaryLanguage: 'en', aspectRatio: '9:16', resolution: '1080p' },
    includeOneRevision: true,
    confirmedAt,
  };
}

export function evaluateServerProductionOnboardingReadiness(input: {
  preferences?: ProductionOnboardingPreferences;
  evidence: ProductionOnboardingEvidence;
  plans: Array<Pick<VideoCreationPlan, 'productionRole' | 'benchmarkAnalysis' | 'productId'> & Partial<Pick<VideoCreationPlan, 'route'>>>;
}): ServerProductionOnboardingReadiness {
  const requiredArchetypes = requiredFixedYieldArchetypes(input.plans);
  if (!input.preferences) {
    return {
      ready: false,
      blockers: [{
        code: 'production_preferences_missing',
        message: '生产资料尚未在新手引导中确认',
        action: 'complete_production_onboarding',
      }],
      requiredArchetypes,
      evidence: input.evidence,
    };
  }
  return {
    ...evaluateProductionOnboardingReadiness({
      preferences: input.preferences,
      evidence: input.evidence,
      requiredArchetypes,
    }),
    requiredArchetypes,
    evidence: input.evidence,
  };
}

export async function readServerProductionOnboardingReadiness(input: {
  store: DataStore;
  tenantId: string;
  profile: EnterpriseProfile;
  preferences?: ProductionOnboardingPreferences;
  plans: Array<Pick<VideoCreationPlan, 'productionRole' | 'benchmarkAnalysis' | 'productId'> & Partial<Pick<VideoCreationPlan, 'route'>>>;
  budgetConfirmed: boolean;
  assets?: AssetCandidate[];
}): Promise<ServerProductionOnboardingReadiness> {
  const [presenterDefaults, assets, profiles] = await Promise.all([
    input.store.list<{ tenant_id?: string; payload?: Record<string, unknown> }>('studio_production_defaults', {
      where: { tenant_id: input.tenantId }, page: 1, perPage: 2,
    }),
    input.assets ? Promise.resolve(input.assets) : collectProductionAssets(input.tenantId, input.profile),
    input.store.list<{ tenant_id?: string; profile?: unknown }>('tenant_profiles', {
      where: { tenant_id: input.tenantId }, page: 1, perPage: 2,
    }),
  ]);
  const raw = profiles.totalItems === 1 && profiles.items.length === 1 && profiles.items[0]?.tenant_id === input.tenantId
    ? profiles.items[0].profile : null;
  let canonical: EnterpriseProfile | null = null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) canonical = normalizeProfile(parsed as EnterpriseProfile);
  } catch { /* malformed profiles do not establish confirmed facts */ }
  const snapshotVerified = Boolean(canonical && confirmedEnterpriseFacts(canonical)
    && canonical.factVersion?.id === input.profile.factVersion?.id
    && frozenEnterpriseProfileMatchesCanonical(input.profile, canonical));
  const evidence = enterpriseOnboardingEvidence(
    input.profile,
    presenterDefaults.items,
    input.tenantId,
    assets,
    input.budgetConfirmed,
    requiredFixedYieldLocalMaterials(input.plans),
    snapshotVerified,
  );
  if (input.profile.factVersion?.contentHash && !confirmedEnterpriseFacts(input.profile) && !snapshotVerified) {
    return {
      ready: false,
      blockers: [{
        code: 'enterprise_facts_mismatch',
        message: '无法核验企业资料的已确认版本，可能是资料变更或历史快照不完整；请核对资料后重新确认并更新周计划',
        action: 'complete_enterprise_profile',
      }],
      requiredArchetypes: requiredFixedYieldArchetypes(input.plans),
      evidence,
    };
  }
  const result = evaluateServerProductionOnboardingReadiness({
    preferences: compatibleProductionOnboardingPreferences(input.profile, evidence, input.preferences),
    evidence,
    plans: input.plans,
  });
  return { ...result, materialRequirementGaps: result.blockers.some(item => item.code === 'local_material_missing')
    ? missingFixedYieldLocalMaterials(assets, { tenantId: input.tenantId, requirements: requiredFixedYieldLocalMaterials(input.plans) }) : [] };
}

export function referenceCoveredByProductionEvidence(input: {
  analysis: BenchmarkAnalysis;
  preferences?: ProductionOnboardingPreferences;
  evidence: ProductionOnboardingEvidence;
}): boolean {
  if (input.analysis.status !== 'ready' || !input.analysis.timelineComplete) return false;
  const result = evaluateServerProductionOnboardingReadiness({
    preferences: input.preferences,
    evidence: { ...input.evidence, companyReady: true, brandReady: true, productFactsReady: true, budgetConfirmed: true },
    plans: [{ productionRole: 'master', benchmarkAnalysis: input.analysis }],
  });
  return result.ready;
}

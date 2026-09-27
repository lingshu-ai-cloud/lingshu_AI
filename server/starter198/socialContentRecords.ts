import { parseSocialReplicationContext } from './socialContentValidation.js';
import {
  SOCIAL_ARTIFACT_STATUSES,
  SOCIAL_CONTENT_TASK_STATUSES,
  SOCIAL_SOURCE_KINDS,
  SOCIAL_CONTENT_TASK_MODES,
  SOCIAL_CONTENT_PRODUCTION_MODES,
  SOCIAL_ASSET_AVAILABILITIES,
  SOCIAL_CONTENT_CREATION_MODES,
  SOCIAL_CONTENT_MANAGEMENT_MODES,
  SOCIAL_REPLICATION_REFERENCE_MODES,
  SOCIAL_CONTENT_THEME_IDS,
  SOCIAL_WORK_PACKAGE_KINDS,
  type SocialArtifactStatus,
  type SocialAccountPlaybookRef,
  type SocialAccountPresenterLock,
  type SocialContentArtifact,
  type SocialContentTaskBrief,
  type SocialContentTaskDetail,
  type SocialContentTaskStatus,
  type SocialContentTaskSummary,
  type SocialContentThemeSelection,
  type SocialMaterialReadiness,
  type SocialDeliveryPackage,
  type SocialMetricSubmission,
  type SocialPublicationRecord,
  type SocialProductionResult,
  type SocialReplicationEvaluation,
  type SocialTaskSource,
  type SocialWorkPackageSelection,
  type SocialVersionedObjectRef,
} from '../../shared/contracts/socialContentWorkflow.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import {
  SocialContentWorkflowError,
  socialJson,
  socialObject,
  socialText,
} from './socialContentValidation.js';
import {
  materialReadiness,
  parseStoredMaterialRequirements,
  publicMaterialRequirements,
} from './socialContentThemes.js';
import {
  parseStoredSocialScriptBaseline,
  publicSocialScriptBaselineSummary,
} from './socialContentScriptBaseline.js';
import {
  parseStoredSocialDirectorPlan,
  publicSocialDirectorPlanSummary,
} from './socialContentDirectorPlan.js';
import { createSocialAssetSupplyPlan } from '../../shared/socialContentAssetSupply.js';
import {
  parseStoredSocialReferenceVideoAnalysis,
  parseStoredSocialReplicationScript,
  parseStoredSocialShotMaterialMap,
} from './socialContentScriptSources.js';
import { buildSocialAgentWorkflow } from './socialContentAgentWorkflow.js';
import { readMaterialLibrary, type MaterialRecord } from '../lib/materialLibrary.js';
import { decodeMaterialRef } from './socialContentProductionMaterials.js';

type StoredPresenter = Record<string, unknown> & {
  id?: string; authorized?: boolean; avatarId?: string; voiceId?: string;
  socialAccountId?: string; presenterProfileId?: string; presenterProfileVersion?: string;
  presenterProfileStatus?: string; commercialRightsStatus?: string; consistencyKey?: string;
  rightsEvidence?: { authorizationRef?: string; consentRef?: string; expiresAt?: string; revokedAt?: string;
    subjectAdultConfirmed?: boolean; permittedUses?: string[] };
  toolMappings?: { heygen?: { avatarId?: string; voiceId?: string }; runway?: { referenceMaterialIds?: unknown[] } };
  referenceMaterialIds?: unknown[];
};

export async function readAuthorizedPresenterInventory(repository: Starter198Repository, tenantId: string, socialAccountId?: string | null): Promise<{
  assetIds: string[];
  accountPresenterLock: SocialAccountPresenterLock | null;
}> {
  if (!repository.dataStore) return { assetIds: [], accountPresenterLock: null };
  try {
    const defaults = await repository.dataStore.list<{ tenant_id: string; payload?: { presenters?: StoredPresenter[] } }>('studio_production_defaults', { where: { tenant_id: tenantId }, perPage: 2 });
    if (defaults.totalItems > 1 || defaults.items.length > 1) throw new Error('duplicate_defaults');
    const usable = (defaults.items[0]?.payload?.presenters || []).filter(item => {
      const mappings = item.toolMappings && typeof item.toolMappings === 'object' ? item.toolMappings as Record<string, any> : {};
      return item.authorized === true && String(item.id || '').trim() && (Boolean(String(item.avatarId || '').trim() && String(item.voiceId || '').trim())
        || (Array.isArray(item.referenceMaterialIds) && item.referenceMaterialIds.some(Boolean))
        || Boolean(String(mappings.heygen?.avatarId || '').trim() && String(mappings.heygen?.voiceId || '').trim())
        || (Array.isArray(mappings.runway?.referenceMaterialIds) && mappings.runway.referenceMaterialIds.some(Boolean)));
    });
    if (!socialAccountId) return { assetIds: usable.map(item => String(item.id)), accountPresenterLock: null };
    const profiles = usable.flatMap(item => {
      const avatarId = String(item.toolMappings?.heygen?.avatarId || item.avatarId || '').trim();
      const voiceProfileId = String(item.toolMappings?.heygen?.voiceId || item.voiceId || '').trim();
      const presenterProfileId = String(item.presenterProfileId || '').trim();
      const presenterProfileVersion = String(item.presenterProfileVersion || '').trim();
      const expectedKey = `${socialAccountId}:${presenterProfileId}:${presenterProfileVersion}`;
      const authorizationRef = String(item.rightsEvidence?.authorizationRef || '').trim();
      const consentRef = String(item.rightsEvidence?.consentRef || '').trim();
      const expiresAt = item.rightsEvidence?.expiresAt ? Date.parse(item.rightsEvidence.expiresAt) : null;
      const rightsReady = Boolean(authorizationRef && consentRef && !item.rightsEvidence?.revokedAt
        && item.rightsEvidence?.subjectAdultConfirmed === true
        && item.rightsEvidence?.permittedUses?.includes('digital_presenter')
        && (expiresAt === null || (Number.isFinite(expiresAt) && expiresAt > Date.now())));
      return item.socialAccountId === socialAccountId && item.presenterProfileStatus === 'published'
        && item.commercialRightsStatus === 'cleared' && rightsReady
        && presenterProfileId && presenterProfileVersion && avatarId && voiceProfileId
        && item.consistencyKey === expectedKey
        ? [{ socialAccountId, presenterProfileId, presenterProfileVersion, presenterAssetId: String(item.id),
          avatarId, voiceProfileId, consentRef, commercialRightsStatus: 'cleared' as const,
          status: 'published' as const, consistencyKey: expectedKey }]
        : [];
    });
    if (profiles.length > 1) throw new Error('duplicate_published_account_presenter');
    return { assetIds: profiles.map(item => item.presenterAssetId), accountPresenterLock: profiles[0] ?? null };
  } catch {
    throw new SocialContentWorkflowError('social_content_presenter_assets_unavailable', 503);
  }
}

export async function readAuthorizedPresenterAssetIds(repository: Starter198Repository, tenantId: string): Promise<string[]> {
  return (await readAuthorizedPresenterInventory(repository, tenantId)).assetIds;
}

const storedCount = (value: unknown): number => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) {
    throw new SocialContentWorkflowError('social_content_task_counter_invalid', 503);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new SocialContentWorkflowError('social_content_task_counter_invalid', 503);
  }
  return parsed;
};

function nullable(value: unknown): string | null {
  return socialText(value) || null;
}

function versionedObjectRef(value: unknown, expectedObjectType?: string): SocialVersionedObjectRef | null {
  if (value === null || value === undefined || value === '') return null;
  const row = socialObject(value);
  const objectType = socialText(row?.objectType);
  const id = socialText(row?.id);
  const version = socialText(row?.version);
  if (!row || !objectType || !id || !version || (expectedObjectType && objectType !== expectedObjectType)) {
    throw new SocialContentWorkflowError('social_content_task_record_invalid', 503);
  }
  return { objectType, id, version };
}

function accountPlaybookRef(value: unknown): SocialAccountPlaybookRef | null {
  const base = versionedObjectRef(value, 'account_playbook');
  if (!base) return null;
  const accountRef = socialText(socialObject(value)?.accountRef);
  if (!accountRef) throw new SocialContentWorkflowError('social_content_task_record_invalid', 503);
  return { ...base, objectType: 'account_playbook', accountRef };
}

function jsonRecord(value: unknown, code: string): Record<string, unknown> {
  const parsed = socialObject(socialJson(value));
  if (!parsed) throw new SocialContentWorkflowError(code, 503);
  return parsed;
}

function strings(value: unknown, code: string): string[] {
  const parsed = socialJson(value);
  if (!Array.isArray(parsed) || parsed.some(item => !socialText(item))) {
    throw new SocialContentWorkflowError(code, 503);
  }
  return parsed.map(socialText);
}

export function parseSocialTaskBrief(value: unknown): SocialContentTaskBrief {
  const record = jsonRecord(value, 'social_content_task_record_invalid');
  const title = socialText(record.title);
  const objective = socialText(record.objective);
  if (!title || !objective) throw new SocialContentWorkflowError('social_content_task_record_invalid', 503);
  const requested = record.requestedOutputCount;
  const optionalStoredNumber = (field: string, maximum: number, integer = false): number | null => {
    const raw = record[field];
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > maximum || (integer && !Number.isSafeInteger(raw))) {
      throw new SocialContentWorkflowError('social_content_task_record_invalid', 503);
    }
    return raw;
  };
  const planningMode = socialText(record.planningMode) || 'auto_adjust';
  if (!['fixed', 'auto_adjust'].includes(planningMode)) {
    throw new SocialContentWorkflowError('social_content_task_record_invalid', 503);
  }
  // Records written before the publish-quality mode existed keep their
  // historic preview behavior. Every newly created customer task explicitly
  // stores `social_ready` through defaultBrief().
  const productionMode = socialText(record.productionMode) || 'concept_preview';
  if (!SOCIAL_CONTENT_PRODUCTION_MODES.includes(productionMode as NonNullable<SocialContentTaskBrief['productionMode']>)) {
    throw new SocialContentWorkflowError('social_content_task_record_invalid', 503);
  }
  const creationMode = socialText(record.creationMode);
  const assetAvailability = socialText(record.assetAvailability);
  const managementMode = socialText(record.managementMode);
  const referenceMode = socialText(record.referenceMode);
  if ((creationMode && !SOCIAL_CONTENT_CREATION_MODES.includes(creationMode as typeof SOCIAL_CONTENT_CREATION_MODES[number]))
    || (assetAvailability && !SOCIAL_ASSET_AVAILABILITIES.includes(assetAvailability as typeof SOCIAL_ASSET_AVAILABILITIES[number]))
    || (managementMode && !SOCIAL_CONTENT_MANAGEMENT_MODES.includes(managementMode as typeof SOCIAL_CONTENT_MANAGEMENT_MODES[number]))
    || (referenceMode && !SOCIAL_REPLICATION_REFERENCE_MODES.includes(referenceMode as typeof SOCIAL_REPLICATION_REFERENCE_MODES[number]))) {
    throw new SocialContentWorkflowError('social_content_task_record_invalid', 503);
  }
  return {
    title,
    objective,
    productRef: nullable(record.productRef),
    audience: nullable(record.audience),
    markets: strings(record.markets, 'social_content_task_record_invalid'),
    languages: strings(record.languages, 'social_content_task_record_invalid'),
    platforms: strings(record.platforms, 'social_content_task_record_invalid'),
    formats: strings(record.formats, 'social_content_task_record_invalid'),
    aspectRatio: nullable(record.aspectRatio),
    cadence: nullable(record.cadence),
    requestedOutputCount: typeof requested === 'number' && Number.isSafeInteger(requested) && requested > 0 ? requested : null,
    weeklyBudgetCny: optionalStoredNumber('weeklyBudgetCny', 10_000_000),
    perItemBudgetCny: optionalStoredNumber('perItemBudgetCny', 1_000_000),
    retryReserveCny: optionalStoredNumber('retryReserveCny', 10_000_000),
    planningMode: planningMode as SocialContentTaskBrief['planningMode'],
    shootingWindowMinutes: optionalStoredNumber('shootingWindowMinutes', 10_080, true),
    specialRequirements: nullable(record.specialRequirements),
    dueAt: nullable(record.dueAt),
    brandNotes: nullable(record.brandNotes),
    restrictions: strings(record.restrictions, 'social_content_task_record_invalid'),
    callToAction: nullable(record.callToAction),
    ...parseSocialReplicationContext(record),
    programRef: versionedObjectRef(record.programRef),
    targetAccountRef: versionedObjectRef(record.targetAccountRef, 'owned_social_account'),
    accountPlaybookRef: accountPlaybookRef(record.accountPlaybookRef),
    ...(referenceMode ? { referenceMode: referenceMode as NonNullable<SocialContentTaskBrief['referenceMode']> } : {}),
    primaryExperimentVariable: nullable(record.primaryExperimentVariable),
    ...(creationMode ? { creationMode: creationMode as NonNullable<SocialContentTaskBrief['creationMode']> } : {}),
    ...(assetAvailability ? { assetAvailability: assetAvailability as NonNullable<SocialContentTaskBrief['assetAvailability']> } : {}),
    ...(managementMode ? { managementMode: managementMode as NonNullable<SocialContentTaskBrief['managementMode']> } : {}),
    productionMode: productionMode as SocialContentTaskBrief['productionMode'],
  };
}

export function parsePackageSelection(value: unknown): SocialWorkPackageSelection[] {
  const parsed = socialJson(value);
  if (!Array.isArray(parsed) || parsed.length !== SOCIAL_WORK_PACKAGE_KINDS.length) {
    throw new SocialContentWorkflowError('social_content_task_record_invalid', 503);
  }
  const selection = parsed.map(item => {
    const record = socialObject(item);
    const kind = socialText(record?.kind) as SocialWorkPackageSelection['kind'];
    const packageKey = socialText(record?.packageKey);
    const version = socialText(record?.version);
    const name = socialText(record?.name);
    if (!SOCIAL_WORK_PACKAGE_KINDS.includes(kind) || !packageKey || !version || !name) {
      throw new SocialContentWorkflowError('social_content_task_record_invalid', 503);
    }
    return { kind, packageKey, version, name };
  });
  if (new Set(selection.map(item => item.kind)).size !== SOCIAL_WORK_PACKAGE_KINDS.length) {
    throw new SocialContentWorkflowError('social_content_task_record_invalid', 503);
  }
  return selection;
}

export interface SocialSourceCoverage {
  total: number;
  knowledge: number;
  material: number;
}

export function socialTaskReadiness(
  brief: SocialContentTaskBrief,
  coverage: SocialSourceCoverage,
  themeWorkflow?: { theme: SocialContentThemeSelection | null; materialReadiness: SocialMaterialReadiness },
): { complete: boolean; missing: string[]; personalizationGaps: string[] } {
  const missing: string[] = [];
  const personalizationGaps: string[] = [];
  if (!brief.productRef) personalizationGaps.push('product');
  if (!brief.audience) personalizationGaps.push('audience');
  if (!brief.markets.length) personalizationGaps.push('market');
  if (!brief.languages.length) personalizationGaps.push('language');
  if (!brief.platforms.length) personalizationGaps.push('platform');
  if (!brief.formats.length) personalizationGaps.push('content_format');
  if (coverage.knowledge < 1) personalizationGaps.push('enterprise_knowledge');
  if (coverage.material < 1) personalizationGaps.push('source_material');
  if (themeWorkflow) {
    if (!themeWorkflow.theme || themeWorkflow.theme.classificationStatus !== 'confirmed' || !themeWorkflow.theme.themeId) {
      missing.push('theme_confirmation');
    }
    // Missing customer material is a production-routing decision, not an
    // admission blocker. The content workflow may use licensed/system assets,
    // generated visuals, a digital presenter, or a non-claiming graphic
    // substitute. Verified proof shots must be rewritten rather than invented.
  } else {
    // Preserve the stricter contract for historic non-theme workflows. The
    // fast-start fallback applies only to the new theme-driven workflow.
    missing.push(...personalizationGaps);
  }
  return { complete: missing.length === 0, missing, personalizationGaps };
}

export function parseSocialTaskThemeSelection(value: unknown): SocialContentThemeSelection | null {
  const parsed = socialJson(value);
  if (parsed === undefined || parsed === null || parsed === '') return null;
  const record = socialObject(parsed);
  const rawThemeId = socialText(record?.themeId);
  const themeId = rawThemeId || null;
  const inputKind = socialText(record?.inputKind);
  const classificationStatus = socialText(record?.classificationStatus);
  if (!record || (themeId && !SOCIAL_CONTENT_THEME_IDS.includes(themeId as typeof SOCIAL_CONTENT_THEME_IDS[number]))
    || !['preset', 'custom'].includes(inputKind)
    || !['confirmed', 'pending_confirmation'].includes(classificationStatus)) {
    throw new SocialContentWorkflowError('social_content_theme_record_invalid', 503);
  }
  return {
    themeId: themeId as SocialContentThemeSelection['themeId'],
    inputKind: inputKind as SocialContentThemeSelection['inputKind'],
    topic: socialText(record.topic),
    classificationStatus: classificationStatus as SocialContentThemeSelection['classificationStatus'],
  };
}

export function socialTaskSummary(record: StarterRecord): SocialContentTaskSummary {
  const taskId = socialText(record.task_id);
  const status = socialText(record.status) as SocialContentTaskStatus;
  const version = socialText(record.version);
  const createdAt = socialText(record.created_at);
  const updatedAt = socialText(record.updated_at);
  if (!taskId || !SOCIAL_CONTENT_TASK_STATUSES.includes(status) || !version || !createdAt || !updatedAt) {
    throw new SocialContentWorkflowError('social_content_task_record_invalid', 503);
  }
  const brief = parseSocialTaskBrief(record.brief);
  const modeValue = socialText(record.task_mode) || 'weekly';
  if (!SOCIAL_CONTENT_TASK_MODES.includes(modeValue as typeof SOCIAL_CONTENT_TASK_MODES[number])) {
    throw new SocialContentWorkflowError('social_content_task_record_invalid', 503);
  }
  const theme = parseSocialTaskThemeSelection(record.theme_selection);
  const scriptBaseline = publicSocialScriptBaselineSummary(parseStoredSocialScriptBaseline(record.script_baseline));
  const directorPlan = publicSocialDirectorPlanSummary(parseStoredSocialDirectorPlan(record.director_plan));
  const requirements = publicMaterialRequirements(parseStoredMaterialRequirements(record.material_requirements));
  const requirementReadiness = materialReadiness(requirements);
  const sourceCount = storedCount(record.source_count);
  const knowledgeSourceCount = storedCount(record.knowledge_source_count);
  const materialSourceCount = storedCount(record.material_source_count);
  const artifactCount = storedCount(record.artifact_count);
  const approvedArtifactCount = storedCount(record.approved_artifact_count);
  // Supplemental text notes count toward lineage but are deliberately excluded
  // from both confirmed-knowledge and source-material readiness counters.
  if (knowledgeSourceCount + materialSourceCount > sourceCount || approvedArtifactCount > artifactCount) {
    throw new SocialContentWorkflowError('social_content_task_counter_invalid', 503);
  }
  return {
    taskId,
    brief,
    status,
    version,
    packageSelection: parsePackageSelection(record.package_selection),
    readiness: socialTaskReadiness(brief, {
      total: sourceCount,
      knowledge: knowledgeSourceCount,
      material: materialSourceCount,
    }, theme ? { theme, materialReadiness: requirementReadiness } : undefined),
    runId: nullable(record.run_id),
    sourceCount,
    knowledgeSourceCount,
    materialSourceCount,
    artifactCount,
    approvedArtifactCount,
    deliveryPackageCount: storedCount(record.delivery_package_count),
    publicationCount: storedCount(record.publication_count),
    metricSubmissionCount: storedCount(record.metric_submission_count),
    createdAt,
    updatedAt,
    mode: modeValue as typeof SOCIAL_CONTENT_TASK_MODES[number],
    weeklyPlanId: nullable(record.weekly_plan_id),
    theme,
    ...(theme ? { materialReadiness: requirementReadiness } : {}),
    ...(scriptBaseline ? { scriptBaseline } : {}),
    ...(directorPlan ? { directorPlan } : {}),
  };
}

export function socialTaskSource(record: StarterRecord): SocialTaskSource {
  const kind = socialText(record.source_kind) as SocialTaskSource['kind'];
  const status = socialText(record.status) as SocialTaskSource['status'];
  if (!SOCIAL_SOURCE_KINDS.includes(kind) || !['active', 'replaced', 'removed'].includes(status)) {
    throw new SocialContentWorkflowError('social_content_source_record_invalid', 503);
  }
  return {
    sourceId: socialText(record.source_id),
    taskId: socialText(record.task_id),
    kind,
    sourceRef: socialText(record.source_ref),
    sourceVersion: nullable(record.source_version),
    label: socialText(record.label),
    purpose: nullable(record.purpose),
    status,
    createdAt: socialText(record.created_at),
  };
}

export function socialArtifact(record: StarterRecord): SocialContentArtifact {
  const status = socialText(record.status) as SocialArtifactStatus;
  const origin = socialText(record.origin) as SocialContentArtifact['origin'];
  if (!SOCIAL_ARTIFACT_STATUSES.includes(status) || !['agent', 'manual'].includes(origin)) {
    throw new SocialContentWorkflowError('social_artifact_record_invalid', 503);
  }
  const contentValue = socialJson(record.content);
  const content = contentValue === null || contentValue === undefined || contentValue === ''
    ? null : socialObject(contentValue);
  if (contentValue && !content) throw new SocialContentWorkflowError('social_artifact_record_invalid', 503);
  return {
    artifactId: socialText(record.artifact_id),
    taskId: socialText(record.task_id),
    kind: socialText(record.artifact_kind),
    platform: nullable(record.platform),
    language: nullable(record.language),
    version: socialText(record.version),
    status,
    origin,
    resourceRef: nullable(record.resource_ref),
    content,
    parentArtifactId: nullable(record.parent_artifact_id),
    createdAt: socialText(record.created_at),
    updatedAt: socialText(record.updated_at),
  };
}

export function socialDeliveryPackage(record: StarterRecord): SocialDeliveryPackage {
  const status = socialText(record.status) as SocialDeliveryPackage['status'];
  const packageId = socialText(record.package_id);
  if (!['preparing', 'ready', 'confirmed', 'superseded'].includes(status) || !packageId) {
    throw new SocialContentWorkflowError('social_delivery_package_record_invalid', 503);
  }
  return {
    packageId,
    taskId: socialText(record.task_id),
    version: socialText(record.version),
    status,
    artifactIds: strings(record.artifact_ids, 'social_delivery_package_record_invalid'),
    packageHash: socialText(record.package_hash),
    downloadHref: status === 'ready' || status === 'confirmed'
      ? `/api/overseas/starter-198/social-content/delivery-packages/${encodeURIComponent(packageId)}/download`
      : null,
    createdAt: socialText(record.created_at),
    updatedAt: socialText(record.updated_at),
  };
}

export function socialPublication(record: StarterRecord): SocialPublicationRecord {
  if (socialText(record.status) !== 'registered') {
    throw new SocialContentWorkflowError('social_publication_record_invalid', 503);
  }
  return {
    publicationId: socialText(record.publication_id),
    taskId: socialText(record.task_id),
    packageId: socialText(record.package_id),
    platform: socialText(record.platform),
    accountLabel: nullable(record.account_label),
    publicUrl: nullable(record.public_url),
    platformPostId: nullable(record.platform_post_id),
    publishedAt: socialText(record.published_at),
    notes: nullable(record.notes),
    status: 'registered',
    createdAt: socialText(record.created_at),
    updatedAt: socialText(record.updated_at),
  };
}

export function socialMetricSubmission(record: StarterRecord): SocialMetricSubmission {
  const method = socialText(record.method) as SocialMetricSubmission['method'];
  const status = socialText(record.status) as SocialMetricSubmission['status'];
  const parsedMetrics = jsonRecord(record.metrics, 'social_metrics_record_invalid');
  if (!['link', 'platform_id', 'table', 'screenshot', 'manual', 'connected_account'].includes(method)
    || !['received', 'needs_confirmation', 'confirmed'].includes(status)
    || Object.values(parsedMetrics).some(value => value !== null && typeof value !== 'number')) {
    throw new SocialContentWorkflowError('social_metrics_record_invalid', 503);
  }
  return {
    submissionId: socialText(record.submission_id),
    taskId: socialText(record.task_id),
    publicationId: socialText(record.publication_id),
    method,
    capturedAt: socialText(record.captured_at),
    metrics: parsedMetrics as Record<string, number | null>,
    evidenceRefs: strings(record.evidence_refs, 'social_metrics_record_invalid'),
    notes: nullable(record.notes),
    status,
    version: socialText(record.version),
    createdAt: socialText(record.created_at),
  };
}

export async function socialTaskRecord(input: {
  repository: Starter198Repository;
  tenantId: string;
  taskId: string;
}): Promise<StarterRecord | null> {
  const result = await input.repository.list(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, {
    where: { task_id: input.taskId }, perPage: 2,
  });
  if (result.totalItems > 1 || result.items.length > 1) {
    throw new SocialContentWorkflowError('social_content_task_integrity_violation', 503);
  }
  return result.items[0] ?? null;
}

async function taskRows(
  repository: Starter198Repository,
  collection: Parameters<Starter198Repository['list']>[0],
  tenantId: string,
  taskId: string,
): Promise<StarterRecord[]> {
  const result = await repository.list(collection, tenantId, {
    where: { task_id: taskId }, sort: 'created_at', perPage: 500,
  });
  if (result.totalItems !== result.items.length) {
    throw new SocialContentWorkflowError('social_content_task_children_truncated', 503);
  }
  return result.items;
}

export async function readSocialTaskDetail(input: {
  repository: Starter198Repository;
  tenantId: string;
  taskId: string;
}): Promise<SocialContentTaskDetail | null> {
  const task = await socialTaskRecord(input);
  if (!task) return null;
  const [sources, artifacts, packages, publications, metrics] = await Promise.all([
    taskRows(input.repository, STARTER_COLLECTIONS.socialTaskSources, input.tenantId, input.taskId),
    taskRows(input.repository, STARTER_COLLECTIONS.socialContentArtifacts, input.tenantId, input.taskId),
    taskRows(input.repository, STARTER_COLLECTIONS.socialDeliveryPackages, input.tenantId, input.taskId),
    taskRows(input.repository, STARTER_COLLECTIONS.socialPublications, input.tenantId, input.taskId),
    taskRows(input.repository, STARTER_COLLECTIONS.socialMetricSubmissions, input.tenantId, input.taskId),
  ]);
  const summary = socialTaskSummary(task);
  const sourceViews = sources.map(socialTaskSource);
  const artifactViews = artifacts.map(socialArtifact);
  const activeSources = sourceViews.filter(source => source.status === 'active');
  const actual = {
    sourceCount: activeSources.length,
    knowledgeSourceCount: activeSources.filter(source => source.kind === 'knowledge').length,
    materialSourceCount: activeSources.filter(source => source.kind === 'material').length,
    artifactCount: artifacts.length,
    approvedArtifactCount: artifactViews.filter(artifact => artifact.status === 'approved').length,
    deliveryPackageCount: packages.length,
    publicationCount: publications.length,
    metricSubmissionCount: metrics.length,
  };
  if (Object.entries(actual).some(([key, value]) => summary[key as keyof typeof actual] !== value)) {
    throw new SocialContentWorkflowError('social_content_task_projection_out_of_sync', 503);
  }
  const activeMaterials = activeSources.filter(source => source.kind === 'material');
  const materialInventory = await readMaterialLibrary(input.tenantId).catch(() => ({ items: [] as MaterialRecord[] }));
  const materialById = new Map(materialInventory.items.map(item => [socialText(item.id), item]));
  const linkedMaterialRows = activeMaterials.flatMap(source => {
    const record = materialById.get(decodeMaterialRef(source.sourceRef));
    return record ? [{ source, record }] : [];
  });
  const searchable = (record: MaterialRecord) => [record.name, record.title, record.tags, record.visualObservations, record.observations]
    .flatMap(value => Array.isArray(value) ? value : [value]).map(socialText).join(' ').toLocaleLowerCase();
  const productImageScore = (record: MaterialRecord) => {
    const text = searchable(record);
    return (/产品|瓶|罐|包装|product|bottle|jar|package/.test(text) ? 30 : 0)
      + (/组合|系列|陈列|静物|矩阵/.test(text) ? 20 : 0)
      + (socialText(record.productRef || record.productName) ? 10 : 0)
      - (/工具|化妆刷|黄瓜|人物|真人|口红上妆/.test(text) ? 50 : 0);
  };
  const productCandidates = [
    ...linkedMaterialRows.filter(item => socialText(item.record.type) === 'image')
      .map(item => ({ id: item.source.sourceId, record: item.record, linked: true })),
    ...materialInventory.items.filter(record => socialText(record.type) === 'image')
      .map(record => ({ id: socialText(record.id), record, linked: false })),
  ].filter((item, index, rows) => productImageScore(item.record) > 0
    && rows.findIndex(other => other.id === item.id) === index)
    .sort((left, right) => Number(right.linked) - Number(left.linked)
      || productImageScore(right.record) - productImageScore(left.record));
  // A product scene may use multiple views only when the library explicitly
  // identifies them as the same product. Otherwise use the strongest single
  // product-family image instead of silently mixing unrelated SKUs.
  const primaryProduct = productCandidates[0];
  const primaryProductRef = socialText(primaryProduct?.record.productRef || primaryProduct?.record.productName)
    || summary.brief.productRef || socialText(primaryProduct?.record.id) || 'task-product';
  const productImageIds = primaryProduct ? productCandidates
    .filter(item => item.id === primaryProduct.id || (socialText(item.record.productRef || item.record.productName)
      && socialText(item.record.productRef || item.record.productName) === socialText(primaryProduct.record.productRef || primaryProduct.record.productName)))
    .slice(0, 4).map(item => item.id) : [];
  const linkedVideoRows = linkedMaterialRows.filter(item => socialText(item.record.type) === 'video');
  const factoryRows = materialInventory.items.filter(record => socialText(record.type) === 'video'
    && /工厂|车间|产线|生产|灌装|旋盖|包装|实验室|机器人|factory|production|manufactur|filling|capping/.test(searchable(record)));
  const factoryEvidenceAssetIds = [...new Set(factoryRows.map(record => socialText(record.id)).filter(Boolean))];
  const customerVideoIds = linkedVideoRows.filter(item => !factoryEvidenceAssetIds.includes(socialText(item.record.id)))
    .map(item => item.source.sourceId);
  const licensedStockAssetIds = materialInventory.items.filter(record => socialText(record.type) === 'video'
    && !factoryEvidenceAssetIds.includes(socialText(record.id))).map(record => socialText(record.id)).filter(Boolean);
  const presenterInventory = await readAuthorizedPresenterInventory(
    input.repository,
    input.tenantId,
    summary.brief.targetAccountRef?.id,
  );
  const confirmedFactRefs = [
    ...activeSources.filter(source => source.kind === 'knowledge').map(source => source.sourceId),
    ...(summary.brief.brandNotes ? ['brief:confirmed-facts'] : []),
  ];
  const referenceVideoAnalysis = parseStoredSocialReferenceVideoAnalysis(task.reference_video_analysis);
  const replicationScript = parseStoredSocialReplicationScript(task.replication_script);
  const shotMaterialMap = parseStoredSocialShotMaterialMap(task.shot_material_map);
  const assetSupplyPlan = createSocialAssetSupplyPlan({
    creationMode: summary.brief.creationMode ?? 'material_processing',
    assetAvailability: summary.brief.assetAvailability,
    managementMode: summary.brief.managementMode,
    planVersion: summary.version,
    inventory: { customerVideoIds, productImageIds,
      productIdentityGroups: productImageIds.length ? [{
        productRef: primaryProductRef, imageIds: productImageIds,
      }] : [],
      presenterAssetIds: presenterInventory.assetIds,
      referenceVideoIds: (summary.brief.creationMode ?? 'material_processing') === 'viral_replication'
        && referenceVideoAnalysis ? [referenceVideoAnalysis.referenceRecordId
          ? `system-reference:${referenceVideoAnalysis.referenceRecordId}`
          : referenceVideoAnalysis.referenceSourceId] : [],
      factoryEvidenceAssetIds,
      licensedStockAssetIds },
    confirmedFactRefs,
    accountPresenterLock: presenterInventory.accountPresenterLock,
    referenceShots: referenceVideoAnalysis?.shots,
    shots: replicationScript?.shots.map(shot => ({
      shotId: shot.shotId,
      function: shot.purpose,
      requestedDescription: shot.visualInstruction,
      truthSensitiveSubject: shot.materialPlan.truthBoundary.subject,
      referenceShotId: shot.referenceShotId,
    })),
    rightsConfirmationRequired: false,
  });
  const agentWorkflow = buildSocialAgentWorkflow({
    taskId: summary.taskId,
    taskVersion: summary.version,
    taskStatus: summary.status,
    mode: summary.mode ?? 'weekly',
    weeklyPlanId: summary.weeklyPlanId ?? null,
    brief: summary.brief,
    sources: activeSources,
    factSourceRefs: confirmedFactRefs,
    assetSupplyPlan,
    referenceAnalysis: referenceVideoAnalysis,
    replicationScript,
  });
  const productionResult = [...artifactViews].reverse().flatMap(artifact => {
    const row = socialObject(artifact.content?.productionResult);
    return row && socialText(row.productionResultId) && socialText(row.executionPlanId)
      ? [{
        ...(structuredClone(row) as unknown as SocialProductionResult),
        artifactId: artifact.artifactId,
        publishAssignmentId: publications.map(socialPublication).reverse()[0]?.publicationId ?? null,
      }]
      : [];
  })[0] ?? null;
  const replicationEvaluation = [...artifactViews].reverse().flatMap(artifact => {
    const row = socialObject(artifact.content?.replicationEvaluation);
    return row && socialText(row.evaluationId) && socialText(row.replicationJobId)
      ? [structuredClone(row) as unknown as SocialReplicationEvaluation]
      : [];
  })[0] ?? null;
  agentWorkflow.productionResult = productionResult;
  agentWorkflow.replicationEvaluation = replicationEvaluation;
  const privateBrief = socialObject(socialJson(task.brief));
  const referenceRecovery = socialObject(privateBrief?._managedStart);
  const publishingRecovery = socialObject(privateBrief?._managedPublishing);
  const recoveryView = (value: Record<string, unknown>) => ({
    status: socialText(value.status), attempts: Number(value.attempts) || 0,
    nextAttemptAt: socialText(value.nextAttemptAt) || null, reason: socialText(value.reason) || null,
  });
  return {
    ...summary,
    ...(referenceRecovery || publishingRecovery ? { managedExecution: {
      ...(referenceRecovery ? { reference: { ...recoveryView(referenceRecovery),
        ...(['producing', 'asset_review', 'packaging', 'delivered', 'awaiting_publish', 'awaiting_metrics', 'reviewed'].includes(summary.status)
          ? { status: 'completed', nextAttemptAt: null, reason: null } : {}),
      } } : {}),
      ...(publishingRecovery ? { publishing: { ...recoveryView(publishingRecovery), retryExhausted: publishingRecovery.retryExhausted === true } } : {}),
    } } : {}),
    assetSupplyPlan,
    sources: sourceViews,
    artifacts: artifactViews,
    deliveryPackages: packages.map(socialDeliveryPackage),
    publications: publications.map(socialPublication),
    metricSubmissions: metrics.map(socialMetricSubmission),
    agentWorkflow,
    ...(referenceVideoAnalysis ? { referenceVideoAnalysis } : {}),
    ...(replicationScript ? { replicationScript } : {}),
    ...(shotMaterialMap.length ? { shotMaterialMap } : {}),
    ...(summary.theme
      ? { materialRequirements: publicMaterialRequirements(parseStoredMaterialRequirements(task.material_requirements)) }
      : {}),
  };
}

export async function requireSocialTask(input: {
  repository: Starter198Repository;
  tenantId: string;
  taskId: string;
}): Promise<StarterRecord> {
  const record = await socialTaskRecord(input);
  if (!record) throw new SocialContentWorkflowError('social_content_task_not_found', 404);
  return record;
}

export async function findSocialRecord(input: {
  repository: Starter198Repository;
  collection: Parameters<Starter198Repository['list']>[0];
  tenantId: string;
  where: Record<string, string | number | boolean>;
  notFoundCode: string;
}): Promise<StarterRecord> {
  const result = await input.repository.list(input.collection, input.tenantId, { where: input.where, perPage: 2 });
  if (result.totalItems > 1 || result.items.length > 1) {
    throw new SocialContentWorkflowError(`${input.notFoundCode}_integrity`, 503);
  }
  const record = result.items[0];
  if (!record) throw new SocialContentWorkflowError(input.notFoundCode, 404);
  return record;
}

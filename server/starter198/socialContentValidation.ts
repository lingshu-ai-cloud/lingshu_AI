import { createHash, randomBytes } from 'node:crypto';
import {
  SOCIAL_CONTENT_TASK_MODES,
  SOCIAL_CONTENT_THEME_IDS,
  SOCIAL_SOURCE_KINDS,
  SOCIAL_WORK_PACKAGE_KINDS,
  type AddSocialTaskSourceInput,
  type CreateSocialArtifactInput,
  type CreateSocialContentTaskInput,
  type CreateSocialWeeklyPlanInput,
  type CreateSocialDeliveryPackageInput,
  type DecideSocialArtifactBatchInput,
  type DecideSocialArtifactInput,
  type RegisterSocialPublicationInput,
  type SelectSocialWorkPackagesInput,
  type SubmitSocialMetricsInput,
  type UpdateSocialContentTaskInput,
} from '../../shared/contracts/socialContentWorkflow.js';

export class SocialContentWorkflowError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = 'SocialContentWorkflowError';
  }
}

export const socialText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export function socialObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function socialJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; }
  catch { return undefined; }
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const set = new Set(allowed);
  if (Object.keys(value).some(key => !set.has(key))) {
    throw new SocialContentWorkflowError('social_content_input_invalid', 400);
  }
}

function requiredText(value: unknown, code: string, max: number): string {
  const parsed = socialText(value);
  if (!parsed || parsed.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(parsed)) {
    throw new SocialContentWorkflowError(code, 400);
  }
  return parsed;
}

function optionalText(value: unknown, code: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, code, max);
}

function textList(value: unknown, code: string, maximumItems = 20, itemMax = 100): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new SocialContentWorkflowError(code, 400);
  }
  const values = value.map(item => requiredText(item, code, itemMax));
  return [...new Set(values)];
}

function isoTime(value: unknown, code: string, required = false): string | null {
  if (!required && (value === undefined || value === null || value === '')) return null;
  const parsed = requiredText(value, code, 80);
  const milliseconds = Date.parse(parsed);
  if (!Number.isFinite(milliseconds)) throw new SocialContentWorkflowError(code, 400);
  return new Date(milliseconds).toISOString();
}

function reference(value: unknown, code: string, max = 600): string {
  const parsed = requiredText(value, code, max);
  if (/^(?:javascript|data|file):/i.test(parsed)) throw new SocialContentWorkflowError(code, 400);
  if (/^https?:/i.test(parsed)) {
    let url: URL;
    try { url = new URL(parsed); } catch { throw new SocialContentWorkflowError(code, 400); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new SocialContentWorkflowError(code, 400);
    }
  }
  return parsed;
}

function publicUrl(value: unknown, code: string): string | null {
  const parsed = optionalText(value, code, 1_000);
  if (!parsed) return null;
  let url: URL;
  try { url = new URL(parsed); } catch { throw new SocialContentWorkflowError(code, 400); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new SocialContentWorkflowError(code, 400);
  }
  return url.toString();
}

function safeId(value: unknown, code: string): string {
  const parsed = socialText(value);
  if (!/^[a-z0-9:_-]{1,200}$/i.test(parsed)) throw new SocialContentWorkflowError(code, 400);
  return parsed;
}

function safeRecord(value: unknown, code: string, maxBytes: number): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  const record = socialObject(value);
  if (!record || Buffer.byteLength(JSON.stringify(record), 'utf8') > maxBytes
    || Object.keys(record).some(key => !/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(key))) {
    throw new SocialContentWorkflowError(code, 400);
  }
  return record;
}

const BRIEF_KEYS = [
  'title', 'objective', 'productRef', 'audience', 'markets', 'languages', 'platforms', 'formats',
  'aspectRatio', 'cadence', 'requestedOutputCount', 'weeklyBudgetCny', 'perItemBudgetCny',
  'retryReserveCny', 'planningMode', 'shootingWindowMinutes', 'specialRequirements', 'dueAt',
  'brandNotes', 'restrictions', 'callToAction', 'mode', 'weeklyPlanId', 'themeId',
  'customTopic', 'topic', 'legacyCreationRoute',
] as const;

function optionalNumber(value: unknown, code: string, maximum: number, integer = false): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > maximum || (integer && !Number.isSafeInteger(parsed))) {
    throw new SocialContentWorkflowError(code, 400);
  }
  return Math.round(parsed * 100) / 100;
}

export function parseCreateSocialTask(value: unknown): CreateSocialContentTaskInput {
  const source = socialObject(value);
  if (!source) throw new SocialContentWorkflowError('social_content_task_invalid', 400);
  assertKeys(source, BRIEF_KEYS);
  const requestedOutputCount = source.requestedOutputCount === undefined || source.requestedOutputCount === null
    ? null
    : Number(source.requestedOutputCount);
  if (requestedOutputCount !== null && (!Number.isSafeInteger(requestedOutputCount) || requestedOutputCount < 1 || requestedOutputCount > 100)) {
    throw new SocialContentWorkflowError('social_content_output_count_invalid', 400);
  }
  const planningMode = source.planningMode === undefined ? 'auto_adjust' : socialText(source.planningMode);
  if (!['fixed', 'auto_adjust'].includes(planningMode)) {
    throw new SocialContentWorkflowError('social_content_planning_mode_invalid', 400);
  }
  const mode = source.mode === undefined ? undefined : socialText(source.mode);
  if (mode !== undefined && !SOCIAL_CONTENT_TASK_MODES.includes(mode as CreateSocialContentTaskInput['mode'] & string)) {
    throw new SocialContentWorkflowError('social_content_mode_invalid', 400);
  }
  const themeId = source.themeId === undefined || source.themeId === null || source.themeId === ''
    ? null : socialText(source.themeId);
  if (themeId && !SOCIAL_CONTENT_THEME_IDS.includes(themeId as typeof SOCIAL_CONTENT_THEME_IDS[number])) {
    throw new SocialContentWorkflowError('social_content_theme_invalid', 400);
  }
  const customTopic = optionalText(source.customTopic, 'social_content_custom_topic_invalid', 300);
  const topic = optionalText(source.topic, 'social_content_topic_invalid', 300);
  if ((mode !== undefined || themeId || customTopic || topic || source.weeklyPlanId) && !themeId && !customTopic) {
    throw new SocialContentWorkflowError('social_content_theme_required', 400);
  }
  const legacyCreationRoute = source.legacyCreationRoute === undefined || source.legacyCreationRoute === null || source.legacyCreationRoute === ''
    ? null : socialText(source.legacyCreationRoute);
  if (legacyCreationRoute && !['material', 'clone', 'product'].includes(legacyCreationRoute)) {
    throw new SocialContentWorkflowError('social_content_legacy_route_invalid', 400);
  }
  return {
    title: requiredText(source.title, 'social_content_title_invalid', 120),
    objective: requiredText(source.objective, 'social_content_objective_invalid', 1_000),
    productRef: optionalText(source.productRef, 'social_content_product_ref_invalid', 200),
    audience: optionalText(source.audience, 'social_content_audience_invalid', 500),
    markets: textList(source.markets, 'social_content_markets_invalid', 10, 80),
    languages: textList(source.languages, 'social_content_languages_invalid', 10, 40),
    platforms: textList(source.platforms, 'social_content_platforms_invalid', 10, 40),
    formats: textList(source.formats, 'social_content_formats_invalid', 20, 80),
    aspectRatio: optionalText(source.aspectRatio, 'social_content_aspect_ratio_invalid', 40),
    cadence: optionalText(source.cadence, 'social_content_cadence_invalid', 200),
    requestedOutputCount: mode === 'instant' ? 1 : requestedOutputCount,
    weeklyBudgetCny: optionalNumber(source.weeklyBudgetCny, 'social_content_weekly_budget_invalid', 10_000_000),
    perItemBudgetCny: optionalNumber(source.perItemBudgetCny, 'social_content_item_budget_invalid', 1_000_000),
    retryReserveCny: optionalNumber(source.retryReserveCny, 'social_content_retry_reserve_invalid', 10_000_000),
    planningMode: planningMode as CreateSocialContentTaskInput['planningMode'],
    shootingWindowMinutes: optionalNumber(source.shootingWindowMinutes, 'social_content_shooting_window_invalid', 10_080, true),
    specialRequirements: optionalText(source.specialRequirements, 'social_content_special_requirements_invalid', 2_000),
    dueAt: isoTime(source.dueAt, 'social_content_due_at_invalid'),
    brandNotes: optionalText(source.brandNotes, 'social_content_brand_notes_invalid', 3_000),
    restrictions: textList(source.restrictions, 'social_content_restrictions_invalid', 30, 240),
    callToAction: optionalText(source.callToAction, 'social_content_call_to_action_invalid', 500),
    ...(mode ? { mode: mode as CreateSocialContentTaskInput['mode'] } : {}),
    weeklyPlanId: source.weeklyPlanId === undefined || source.weeklyPlanId === null || source.weeklyPlanId === ''
      ? null : safeId(source.weeklyPlanId, 'social_content_weekly_plan_id_invalid'),
    themeId: themeId as CreateSocialContentTaskInput['themeId'],
    customTopic,
    topic,
    legacyCreationRoute: legacyCreationRoute as CreateSocialContentTaskInput['legacyCreationRoute'],
  };
}

export function parseCreateSocialWeeklyPlan(value: unknown): CreateSocialWeeklyPlanInput {
  const source = socialObject(value);
  if (!source) throw new SocialContentWorkflowError('social_weekly_plan_invalid', 400);
  assertKeys(source, ['title', 'objective', 'productRef', 'audience', 'items']);
  if (!Array.isArray(source.items) || source.items.length < 1 || source.items.length > 20) {
    throw new SocialContentWorkflowError('social_weekly_plan_items_invalid', 400);
  }
  const items = source.items.map(item => {
    const row = socialObject(item);
    if (!row) throw new SocialContentWorkflowError('social_weekly_plan_item_invalid', 400);
    assertKeys(row, ['title', 'objective', 'themeId', 'customTopic', 'topic']);
    const themeId = row.themeId === undefined || row.themeId === null || row.themeId === '' ? null : socialText(row.themeId);
    if (themeId && !SOCIAL_CONTENT_THEME_IDS.includes(themeId as typeof SOCIAL_CONTENT_THEME_IDS[number])) {
      throw new SocialContentWorkflowError('social_content_theme_invalid', 400);
    }
    const customTopic = optionalText(row.customTopic, 'social_content_custom_topic_invalid', 300);
    if (!themeId && !customTopic) throw new SocialContentWorkflowError('social_content_theme_required', 400);
    return {
      title: requiredText(row.title, 'social_content_title_invalid', 120),
      objective: requiredText(row.objective, 'social_content_objective_invalid', 1_000),
      themeId: themeId as CreateSocialContentTaskInput['themeId'],
      customTopic,
      topic: optionalText(row.topic, 'social_content_topic_invalid', 300),
    };
  });
  return {
    title: requiredText(source.title, 'social_weekly_plan_title_invalid', 120),
    objective: requiredText(source.objective, 'social_weekly_plan_objective_invalid', 1_000),
    productRef: optionalText(source.productRef, 'social_content_product_ref_invalid', 200),
    audience: optionalText(source.audience, 'social_content_audience_invalid', 500),
    items,
  };
}

export function parseUpdateSocialTask(value: unknown): UpdateSocialContentTaskInput {
  const source = socialObject(value);
  if (!source) throw new SocialContentWorkflowError('social_content_task_update_invalid', 400);
  assertKeys(source, ['expectedVersion', 'changes']);
  const expectedVersion = requiredText(source.expectedVersion, 'social_content_version_required', 80);
  const changes = socialObject(source.changes);
  if (!changes || !Object.keys(changes).length) throw new SocialContentWorkflowError('social_content_changes_required', 400);
  assertKeys(changes, BRIEF_KEYS);
  const baseline = parseCreateSocialTask({ title: '_', objective: '_', ...changes });
  const parsed = Object.fromEntries(Object.keys(changes).map(key => [key, baseline[key as keyof CreateSocialContentTaskInput]]));
  return { expectedVersion, changes: parsed as Partial<CreateSocialContentTaskInput> };
}

export function parseSocialSource(value: unknown): AddSocialTaskSourceInput {
  const source = socialObject(value);
  if (!source) throw new SocialContentWorkflowError('social_content_source_invalid', 400);
  assertKeys(source, ['kind', 'sourceRef', 'sourceVersion', 'label', 'purpose']);
  const kind = socialText(source.kind) as AddSocialTaskSourceInput['kind'];
  if (!SOCIAL_SOURCE_KINDS.includes(kind)) throw new SocialContentWorkflowError('social_content_source_kind_invalid', 400);
  const sourceRef = reference(source.sourceRef, 'social_content_source_ref_invalid');
  if (kind === 'reference_link' && !/^https?:/i.test(sourceRef)) {
    throw new SocialContentWorkflowError('social_content_source_ref_invalid', 400);
  }
  return {
    kind,
    sourceRef,
    sourceVersion: optionalText(source.sourceVersion, 'social_content_source_version_invalid', 100),
    label: requiredText(source.label, 'social_content_source_label_invalid', 160),
    purpose: optionalText(source.purpose, 'social_content_source_purpose_invalid', 500),
  };
}

export function parsePackageSelection(value: unknown): SelectSocialWorkPackagesInput {
  const source = socialObject(value);
  if (!source) throw new SocialContentWorkflowError('social_package_selection_invalid', 400);
  assertKeys(source, ['expectedVersion', 'selections']);
  if (!Array.isArray(source.selections) || source.selections.length !== SOCIAL_WORK_PACKAGE_KINDS.length) {
    throw new SocialContentWorkflowError('social_package_selection_incomplete', 400);
  }
  const selections = source.selections.map(item => {
    const row = socialObject(item);
    if (!row) throw new SocialContentWorkflowError('social_package_selection_invalid', 400);
    assertKeys(row, ['kind', 'packageKey', 'version']);
    const kind = socialText(row.kind) as SelectSocialWorkPackagesInput['selections'][number]['kind'];
    if (!SOCIAL_WORK_PACKAGE_KINDS.includes(kind)) throw new SocialContentWorkflowError('social_package_kind_invalid', 400);
    return {
      kind,
      packageKey: safeId(row.packageKey, 'social_package_key_invalid'),
      version: safeId(row.version, 'social_package_version_invalid'),
    };
  });
  if (new Set(selections.map(item => item.kind)).size !== SOCIAL_WORK_PACKAGE_KINDS.length) {
    throw new SocialContentWorkflowError('social_package_selection_incomplete', 400);
  }
  return {
    expectedVersion: requiredText(source.expectedVersion, 'social_content_version_required', 80),
    selections,
  };
}

export function parseSocialArtifact(value: unknown): CreateSocialArtifactInput {
  const source = socialObject(value);
  if (!source) throw new SocialContentWorkflowError('social_artifact_invalid', 400);
  assertKeys(source, ['kind', 'platform', 'language', 'origin', 'resourceRef', 'content', 'parentArtifactId']);
  const origin = socialText(source.origin);
  if (!['agent', 'manual'].includes(origin)) throw new SocialContentWorkflowError('social_artifact_origin_invalid', 400);
  const resourceRef = source.resourceRef === undefined || source.resourceRef === null
    ? null : reference(source.resourceRef, 'social_artifact_resource_ref_invalid', 1_000);
  const content = safeRecord(source.content, 'social_artifact_content_invalid', 64 * 1_024);
  if (!resourceRef && !content) throw new SocialContentWorkflowError('social_artifact_payload_required', 400);
  return {
    kind: requiredText(source.kind, 'social_artifact_kind_invalid', 80),
    platform: optionalText(source.platform, 'social_artifact_platform_invalid', 40),
    language: optionalText(source.language, 'social_artifact_language_invalid', 40),
    origin: origin as 'agent' | 'manual',
    resourceRef,
    content,
    parentArtifactId: source.parentArtifactId ? safeId(source.parentArtifactId, 'social_artifact_parent_invalid') : null,
  };
}

export function parseArtifactDecision(value: unknown): DecideSocialArtifactInput {
  const source = socialObject(value);
  if (!source) throw new SocialContentWorkflowError('social_artifact_decision_invalid', 400);
  assertKeys(source, ['expectedVersion', 'decision', 'note']);
  const decision = socialText(source.decision);
  if (!['approved', 'changes_requested'].includes(decision)) {
    throw new SocialContentWorkflowError('social_artifact_decision_invalid', 400);
  }
  return {
    expectedVersion: requiredText(source.expectedVersion, 'social_artifact_version_required', 80),
    decision: decision as DecideSocialArtifactInput['decision'],
    note: optionalText(source.note, 'social_artifact_note_invalid', 2_000),
  };
}

export function parseArtifactBatchDecision(value: unknown): DecideSocialArtifactBatchInput {
  const source = socialObject(value);
  if (!source) throw new SocialContentWorkflowError('social_artifact_batch_decision_invalid', 400);
  assertKeys(source, ['artifacts', 'decision', 'note']);
  if (!Array.isArray(source.artifacts) || source.artifacts.length < 1 || source.artifacts.length > 100) {
    throw new SocialContentWorkflowError('social_artifact_batch_invalid', 400);
  }
  const artifacts = source.artifacts.map(item => {
    const record = socialObject(item);
    if (!record) throw new SocialContentWorkflowError('social_artifact_batch_invalid', 400);
    assertKeys(record, ['artifactId', 'expectedVersion']);
    return {
      artifactId: safeId(record.artifactId, 'social_artifact_id_invalid'),
      expectedVersion: requiredText(record.expectedVersion, 'social_artifact_version_required', 80),
    };
  });
  if (new Set(artifacts.map(item => item.artifactId)).size !== artifacts.length) {
    throw new SocialContentWorkflowError('social_artifact_batch_invalid', 400);
  }
  const decision = socialText(source.decision);
  if (!['approved', 'changes_requested'].includes(decision)) {
    throw new SocialContentWorkflowError('social_artifact_decision_invalid', 400);
  }
  return {
    artifacts,
    decision: decision as DecideSocialArtifactBatchInput['decision'],
    note: optionalText(source.note, 'social_artifact_note_invalid', 2_000),
  };
}

export function parseDeliveryPackage(value: unknown): CreateSocialDeliveryPackageInput {
  const source = socialObject(value);
  if (!source) throw new SocialContentWorkflowError('social_delivery_package_invalid', 400);
  assertKeys(source, ['expectedTaskVersion', 'artifactIds']);
  const artifactIds = textList(source.artifactIds, 'social_delivery_artifact_ids_invalid', 100, 200)
    .map(id => safeId(id, 'social_delivery_artifact_ids_invalid'));
  if (!artifactIds.length) throw new SocialContentWorkflowError('social_delivery_artifacts_required', 400);
  return {
    expectedTaskVersion: requiredText(source.expectedTaskVersion, 'social_content_version_required', 80),
    artifactIds,
  };
}

export function parsePublication(value: unknown): RegisterSocialPublicationInput {
  const source = socialObject(value);
  if (!source) throw new SocialContentWorkflowError('social_publication_invalid', 400);
  assertKeys(source, ['expectedTaskVersion', 'packageId', 'platform', 'accountLabel', 'publicUrl', 'platformPostId', 'publishedAt', 'notes']);
  const url = publicUrl(source.publicUrl, 'social_publication_url_invalid');
  const platformPostId = optionalText(source.platformPostId, 'social_publication_post_id_invalid', 240);
  if (!url && !platformPostId) throw new SocialContentWorkflowError('social_publication_evidence_required', 400);
  return {
    expectedTaskVersion: requiredText(source.expectedTaskVersion, 'social_content_version_required', 80),
    packageId: safeId(source.packageId, 'social_delivery_package_id_invalid'),
    platform: requiredText(source.platform, 'social_publication_platform_invalid', 40),
    accountLabel: optionalText(source.accountLabel, 'social_publication_account_invalid', 160),
    publicUrl: url,
    platformPostId,
    publishedAt: isoTime(source.publishedAt, 'social_publication_time_invalid', true)!,
    notes: optionalText(source.notes, 'social_publication_notes_invalid', 2_000),
  };
}

export function parseMetrics(value: unknown): SubmitSocialMetricsInput {
  const source = socialObject(value);
  if (!source) throw new SocialContentWorkflowError('social_metrics_invalid', 400);
  assertKeys(source, ['method', 'capturedAt', 'metrics', 'evidenceRefs', 'notes']);
  const method = socialText(source.method);
  if (!['link', 'platform_id', 'table', 'screenshot', 'manual', 'connected_account'].includes(method)) {
    throw new SocialContentWorkflowError('social_metrics_method_invalid', 400);
  }
  const metrics = socialObject(source.metrics);
  if (!metrics || !Object.keys(metrics).length || Object.keys(metrics).length > 40) {
    throw new SocialContentWorkflowError('social_metrics_values_invalid', 400);
  }
  const parsedMetrics: Record<string, number | null> = {};
  for (const [key, raw] of Object.entries(metrics)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/i.test(key)
      || (raw !== null && (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0))) {
      throw new SocialContentWorkflowError('social_metrics_values_invalid', 400);
    }
    parsedMetrics[key] = raw as number | null;
  }
  if (!Object.values(parsedMetrics).some(value => value !== null)) {
    throw new SocialContentWorkflowError('social_metrics_values_required', 400);
  }
  return {
    method: method as SubmitSocialMetricsInput['method'],
    capturedAt: isoTime(source.capturedAt, 'social_metrics_time_invalid', true)!,
    metrics: parsedMetrics,
    evidenceRefs: textList(source.evidenceRefs, 'social_metrics_evidence_invalid', 20, 600)
      .map(item => reference(item, 'social_metrics_evidence_invalid')),
    notes: optionalText(source.notes, 'social_metrics_notes_invalid', 2_000),
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  const record = socialObject(value);
  if (!record) return value;
  return Object.fromEntries(Object.keys(record).sort().map(key => [key, canonical(record[key])]));
}

export function socialRequestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function socialPublicId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

export function requireIdempotencyKey(value: unknown): string {
  const key = socialText(value);
  if (!/^[a-z0-9:_-]{8,200}$/i.test(key)) {
    throw new SocialContentWorkflowError('social_content_idempotency_key_invalid', 400);
  }
  return key;
}

export function requireSocialId(value: unknown, code = 'social_content_id_invalid'): string {
  return safeId(value, code);
}

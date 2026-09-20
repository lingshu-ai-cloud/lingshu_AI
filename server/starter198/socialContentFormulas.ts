import {
  SOCIAL_CONTENT_THEME_IDS,
  type SocialContentThemeId,
} from '../../shared/contracts/socialContentWorkflow.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import {
  INTERNAL_SOCIAL_CONTENT_FORMULAS,
  initialMaterialRequirements,
  type InternalFormulaNode,
  type InternalSocialContentFormula,
} from './socialContentThemes.js';
import {
  SocialContentWorkflowError,
  socialJson,
  socialObject,
  socialPublicId,
  socialText,
} from './socialContentValidation.js';

type FormulaStatus = InternalSocialContentFormula['status'];

const FORMULA_SCHEMA = 'social-content-formula.v1';
const FORMULA_STATUSES: readonly FormulaStatus[] = ['draft', 'internal_trial', 'gray', 'active', 'disabled'];
/** Platform-owned scope; customer tenants can select eligible versions but cannot read this store. */
export const SOCIAL_FORMULA_CATALOG_TENANT = '__starter_social_formula_catalog__';

function requiredText(value: unknown, code: string, maximum: number): string {
  const parsed = socialText(value);
  if (!parsed || parsed.length > maximum || /[\u0000-\u001f]/.test(parsed)) {
    throw new SocialContentWorkflowError(code, 400);
  }
  return parsed;
}

function formulaKey(value: unknown, code: string): string {
  const parsed = socialText(value);
  if (!/^[a-z][a-z0-9._-]{1,119}$/i.test(parsed)) throw new SocialContentWorkflowError(code, 400);
  return parsed;
}

function semanticVersion(value: unknown): string {
  const parsed = socialText(value);
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(parsed)) {
    throw new SocialContentWorkflowError('social_content_formula_version_invalid', 400);
  }
  return parsed;
}

function stringList(value: unknown, code: string, maximum = 200): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum || value.some(item => !socialText(item) || socialText(item).length > 200)) {
    throw new SocialContentWorkflowError(code, 400);
  }
  return [...new Set(value.map(socialText))];
}

function parseRollout(value: unknown, fallback?: InternalSocialContentFormula['rollout']): InternalSocialContentFormula['rollout'] {
  if (value === undefined) return fallback ?? { percentage: 0, tenantAllowlist: [] };
  const row = socialObject(value);
  const percentage = Number(row?.percentage);
  if (!row || Object.keys(row).some(key => !['percentage', 'tenantAllowlist'].includes(key))
    || !Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
    throw new SocialContentWorkflowError('social_content_formula_rollout_invalid', 400);
  }
  return {
    percentage,
    tenantAllowlist: stringList(row.tenantAllowlist, 'social_content_formula_rollout_invalid'),
  };
}

const FORMULA_TEMPLATE_TOKENS = new Set([
  'product', 'topic', 'callToAction', 'shotFunction', 'subject', 'action',
]);

function parseNarrationTemplate(
  value: unknown,
  fallback: Pick<InternalFormulaNode, 'shotFunction' | 'subject'>,
): InternalFormulaNode['narrationTemplate'] {
  if (value === undefined) {
    return {
      zh: `通过真实素材展示${fallback.subject}，重点说明${fallback.shotFunction}。`,
      en: `Using the supplied material, show ${fallback.subject} to support ${fallback.shotFunction}.`,
    };
  }
  const row = socialObject(value);
  if (!row || Object.keys(row).some(key => !['zh', 'en'].includes(key))) {
    throw new SocialContentWorkflowError('social_content_formula_script_template_invalid', 400);
  }
  const template = {
    zh: requiredText(row.zh, 'social_content_formula_script_template_invalid', 1_000),
    en: requiredText(row.en, 'social_content_formula_script_template_invalid', 1_000),
  };
  for (const valueText of Object.values(template)) {
    const tokens = [...valueText.matchAll(/\{\{([^{}]+)\}\}/g)].map(match => match[1]!);
    if (tokens.some(token => !FORMULA_TEMPLATE_TOKENS.has(token))) {
      throw new SocialContentWorkflowError('social_content_formula_script_template_invalid', 400);
    }
  }
  return template;
}

function parseNodes(value: unknown): InternalFormulaNode[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    throw new SocialContentWorkflowError('social_content_formula_nodes_invalid', 400);
  }
  const nodes = value.map(item => {
    const row = socialObject(item);
    if (!row || Object.keys(row).some(key => ![
      'nodeId', 'shotFunction', 'subject', 'action', 'environment', 'orientation', 'durationSeconds', 'required', 'narrationTemplate',
    ].includes(key))) throw new SocialContentWorkflowError('social_content_formula_nodes_invalid', 400);
    const orientation = socialText(row.orientation) || 'portrait';
    const duration = row.durationSeconds === null || row.durationSeconds === undefined
      ? null : socialObject(row.durationSeconds);
    const minimum = duration ? Number(duration.minimum) : null;
    const maximum = duration ? Number(duration.maximum) : null;
    if (!['portrait', 'landscape', 'either'].includes(orientation)
      || (duration && (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum! < 0 || maximum! < minimum! || maximum! > 600))) {
      throw new SocialContentWorkflowError('social_content_formula_nodes_invalid', 400);
    }
    const shotFunction = requiredText(row.shotFunction, 'social_content_formula_nodes_invalid', 200);
    const subject = requiredText(row.subject, 'social_content_formula_nodes_invalid', 200);
    return {
      nodeId: formulaKey(row.nodeId, 'social_content_formula_node_id_invalid'),
      shotFunction,
      subject,
      action: requiredText(row.action, 'social_content_formula_nodes_invalid', 200),
      environment: socialText(row.environment) || null,
      orientation: orientation as InternalFormulaNode['orientation'],
      durationSeconds: duration ? { minimum: minimum!, maximum: maximum! } : null,
      required: row.required !== false,
      narrationTemplate: parseNarrationTemplate(row.narrationTemplate, { shotFunction, subject }),
    };
  });
  if (new Set(nodes.map(item => item.nodeId)).size !== nodes.length) {
    throw new SocialContentWorkflowError('social_content_formula_nodes_invalid', 400);
  }
  return nodes;
}

function parseStoredFormula(record: StarterRecord): InternalSocialContentFormula | null {
  const plan = socialObject(socialJson(record.plan));
  if (!plan || socialText(plan.schemaVersion) !== FORMULA_SCHEMA) return null;
  const formula = socialObject(plan.formula);
  const themeId = socialText(formula?.themeId) as SocialContentThemeId;
  const status = socialText(record.status) as FormulaStatus;
  const auditValue = socialJson(formula?.audit);
  if (!formula || !SOCIAL_CONTENT_THEME_IDS.includes(themeId) || !FORMULA_STATUSES.includes(status)
    || !Array.isArray(auditValue)) {
    throw new SocialContentWorkflowError('social_content_formula_record_invalid', 503);
  }
  const audit = auditValue.map(item => {
    const row = socialObject(item);
    if (!row || !socialText(row.event) || !socialText(row.actor) || !socialText(row.at)) {
      throw new SocialContentWorkflowError('social_content_formula_record_invalid', 503);
    }
    return {
      event: socialText(row.event), actor: socialText(row.actor), at: socialText(row.at),
      ...(socialText(row.note) ? { note: socialText(row.note) } : {}),
    };
  });
  return {
    recordId: record.id,
    formulaId: formulaKey(formula.formulaId, 'social_content_formula_record_invalid'),
    version: semanticVersion(formula.version),
    name: requiredText(formula.name, 'social_content_formula_record_invalid', 160),
    themeId,
    status,
    rollout: parseRollout(formula.rollout),
    audit,
    nodes: parseNodes(formula.nodes),
  };
}

async function formulaRows(repository: Starter198Repository, tenantId: string): Promise<StarterRecord[]> {
  const first = await repository.list(STARTER_COLLECTIONS.plans, tenantId, { sort: '-created_at', page: 1, perPage: 500 });
  if (first.totalItems > 10_000) throw new SocialContentWorkflowError('social_content_formula_registry_scan_limit_exceeded', 503);
  const rows = [...first.items];
  for (let page = 2; page <= first.totalPages; page += 1) {
    const next = await repository.list(STARTER_COLLECTIONS.plans, tenantId, { sort: '-created_at', page, perPage: 500 });
    rows.push(...next.items);
  }
  if (rows.length !== first.totalItems) throw new SocialContentWorkflowError('social_content_formula_registry_integrity_violation', 503);
  return rows.filter(record => socialText(socialObject(socialJson(record.plan))?.schemaVersion) === FORMULA_SCHEMA);
}

export async function listSocialContentFormulas(input: {
  repository: Starter198Repository;
  tenantId: string;
}): Promise<InternalSocialContentFormula[]> {
  const stored = (await formulaRows(input.repository, input.tenantId))
    .map(parseStoredFormula).filter((item): item is InternalSocialContentFormula => Boolean(item));
  return [...stored, ...INTERNAL_SOCIAL_CONTENT_FORMULAS.map(item => ({ ...item }))];
}

async function findStoredFormula(input: {
  repository: Starter198Repository;
  tenantId: string;
  formulaId: string;
  version: string;
}): Promise<{ row: StarterRecord; formula: InternalSocialContentFormula }> {
  const matches = (await formulaRows(input.repository, input.tenantId)).map(row => ({ row, formula: parseStoredFormula(row) }))
    .filter(item => item.formula?.formulaId === input.formulaId && item.formula.version === input.version);
  if (matches.length > 1) throw new SocialContentWorkflowError('social_content_formula_integrity_violation', 503);
  const match = matches[0];
  if (!match?.formula) throw new SocialContentWorkflowError('social_content_formula_not_found', 404);
  return { row: match.row, formula: match.formula };
}

function storedPlan(formula: InternalSocialContentFormula, idempotencyKey: string) {
  return {
    schemaVersion: FORMULA_SCHEMA,
    lastIdempotencyKey: idempotencyKey,
    formula: {
      formulaId: formula.formulaId,
      version: formula.version,
      name: formula.name,
      themeId: formula.themeId,
      rollout: formula.rollout,
      nodes: formula.nodes,
      audit: formula.audit,
    },
  };
}

async function ensureUnique(input: {
  repository: Starter198Repository;
  tenantId: string;
  formulaId: string;
  version: string;
}): Promise<void> {
  const formulas = await listSocialContentFormulas(input);
  if (formulas.some(item => item.formulaId === input.formulaId && item.version === input.version)) {
    throw new SocialContentWorkflowError('social_content_formula_version_exists', 409);
  }
}

export async function createSocialContentFormula(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  idempotencyKey: string;
  value: unknown;
  now?: Date;
}): Promise<InternalSocialContentFormula> {
  const body = socialObject(input.value);
  if (!body || Object.keys(body).some(key => !['formulaId', 'version', 'name', 'themeId', 'rollout', 'nodes', 'note'].includes(key))) {
    throw new SocialContentWorkflowError('social_content_formula_input_invalid', 400);
  }
  const rows = await formulaRows(input.repository, input.tenantId);
  const replay = rows.find(row => socialText(socialObject(socialJson(row.plan))?.lastIdempotencyKey) === input.idempotencyKey);
  if (replay) return parseStoredFormula(replay)!;
  const themeId = socialText(body.themeId) as SocialContentThemeId;
  if (!SOCIAL_CONTENT_THEME_IDS.includes(themeId)) throw new SocialContentWorkflowError('social_content_theme_invalid', 400);
  const formula: InternalSocialContentFormula = {
    formulaId: formulaKey(body.formulaId, 'social_content_formula_id_invalid'),
    version: semanticVersion(body.version),
    name: requiredText(body.name, 'social_content_formula_name_invalid', 160),
    themeId,
    status: 'draft',
    rollout: parseRollout(body.rollout),
    nodes: parseNodes(body.nodes),
    audit: [{
      event: 'draft_created', actor: input.userId, at: (input.now ?? new Date()).toISOString(),
      ...(socialText(body.note) ? { note: socialText(body.note) } : {}),
    }],
  };
  await ensureUnique({ ...input, formulaId: formula.formulaId, version: formula.version });
  const created = await input.repository.create(STARTER_COLLECTIONS.plans, input.tenantId, {
    id: socialPublicId('socialformula'),
    goal_id: `social-content-formula:${formula.formulaId}`,
    status: formula.status,
    plan: storedPlan(formula, input.idempotencyKey),
    created_at: (input.now ?? new Date()).toISOString(),
    updated_at: (input.now ?? new Date()).toISOString(),
  });
  return parseStoredFormula(created)!;
}

export async function createSocialContentFormulaVersion(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  formulaId: string;
  sourceVersion: string;
  idempotencyKey: string;
  value: unknown;
  now?: Date;
}): Promise<InternalSocialContentFormula> {
  const body = socialObject(input.value);
  if (!body || Object.keys(body).some(key => !['version', 'name', 'rollout', 'nodes', 'note'].includes(key))) {
    throw new SocialContentWorkflowError('social_content_formula_input_invalid', 400);
  }
  const rows = await formulaRows(input.repository, input.tenantId);
  const replay = rows.find(row => socialText(socialObject(socialJson(row.plan))?.lastIdempotencyKey) === input.idempotencyKey);
  if (replay) return parseStoredFormula(replay)!;
  const { formula: source } = await findStoredFormula({
    repository: input.repository,
    tenantId: input.tenantId,
    formulaId: input.formulaId,
    version: input.sourceVersion,
  });
  const formula: InternalSocialContentFormula = {
    ...source,
    recordId: undefined,
    version: semanticVersion(body.version),
    name: body.name === undefined ? source.name : requiredText(body.name, 'social_content_formula_name_invalid', 160),
    rollout: parseRollout(body.rollout, source.rollout),
    nodes: body.nodes === undefined ? source.nodes : parseNodes(body.nodes),
    status: 'draft',
    audit: [...source.audit, {
      event: 'version_created', actor: input.userId, at: (input.now ?? new Date()).toISOString(),
      note: socialText(body.note) || `forked_from:${source.version}`,
    }],
  };
  await ensureUnique({ ...input, formulaId: formula.formulaId, version: formula.version });
  const created = await input.repository.create(STARTER_COLLECTIONS.plans, input.tenantId, {
    id: socialPublicId('socialformula'),
    goal_id: `social-content-formula:${formula.formulaId}`,
    status: formula.status,
    plan: storedPlan(formula, input.idempotencyKey),
    created_at: (input.now ?? new Date()).toISOString(),
    updated_at: (input.now ?? new Date()).toISOString(),
  });
  return parseStoredFormula(created)!;
}

async function transitionFormula(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  formulaId: string;
  version: string;
  idempotencyKey: string;
  event: 'trial_started' | 'published_gray' | 'published_active' | 'disabled';
  status: FormulaStatus;
  rollout?: InternalSocialContentFormula['rollout'];
  note?: string;
  now?: Date;
}): Promise<InternalSocialContentFormula> {
  const { row, formula } = await findStoredFormula(input);
  const oldPlan = socialObject(socialJson(row.plan));
  if (socialText(oldPlan?.lastIdempotencyKey) === input.idempotencyKey) return formula;
  if (formula.status === 'disabled' && input.status !== 'disabled') {
    throw new SocialContentWorkflowError('social_content_formula_transition_invalid', 409);
  }
  if (input.event === 'trial_started' && !['draft', 'internal_trial'].includes(formula.status)) {
    throw new SocialContentWorkflowError('social_content_formula_transition_invalid', 409);
  }
  if (input.event === 'published_gray' && !['internal_trial', 'gray'].includes(formula.status)) {
    throw new SocialContentWorkflowError('social_content_formula_transition_invalid', 409);
  }
  if (input.event === 'published_active' && !['internal_trial', 'gray', 'active'].includes(formula.status)) {
    throw new SocialContentWorkflowError('social_content_formula_transition_invalid', 409);
  }
  const next: InternalSocialContentFormula = {
    ...formula,
    status: input.status,
    rollout: input.rollout ?? formula.rollout,
    audit: [...formula.audit, {
      event: input.event, actor: input.userId, at: (input.now ?? new Date()).toISOString(),
      ...(input.note ? { note: input.note } : {}),
    }],
  };
  await input.repository.update(STARTER_COLLECTIONS.plans, input.tenantId, row.id, {
    status: next.status,
    plan: storedPlan(next, input.idempotencyKey),
    updated_at: (input.now ?? new Date()).toISOString(),
  });
  return (await findStoredFormula(input)).formula;
}

export async function trialSocialContentFormula(input: Omit<Parameters<typeof transitionFormula>[0], 'event' | 'status' | 'rollout'>) {
  const formula = await transitionFormula({ ...input, event: 'trial_started', status: 'internal_trial' });
  return { formula, preview: initialMaterialRequirements(formula.themeId, (input.now ?? new Date()).toISOString(), formula).requirements };
}

export async function publishSocialContentFormula(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  formulaId: string;
  version: string;
  idempotencyKey: string;
  value: unknown;
  now?: Date;
}): Promise<InternalSocialContentFormula> {
  const body = socialObject(input.value);
  if (!body || Object.keys(body).some(key => !['status', 'rollout', 'note'].includes(key))) {
    throw new SocialContentWorkflowError('social_content_formula_publish_invalid', 400);
  }
  const status = socialText(body.status);
  if (!['gray', 'active'].includes(status)) throw new SocialContentWorkflowError('social_content_formula_publish_invalid', 400);
  const rollout = status === 'active'
    ? { percentage: 100, tenantAllowlist: [] }
    : parseRollout(body.rollout);
  if (status === 'gray' && rollout.percentage === 0 && rollout.tenantAllowlist.length === 0) {
    throw new SocialContentWorkflowError('social_content_formula_rollout_invalid', 400);
  }
  return transitionFormula({
    ...input,
    event: status === 'gray' ? 'published_gray' : 'published_active',
    status: status as FormulaStatus,
    rollout,
    note: socialText(body.note) || undefined,
  });
}

export async function disableSocialContentFormula(input: Omit<Parameters<typeof transitionFormula>[0], 'event' | 'status' | 'rollout'>) {
  return transitionFormula({ ...input, event: 'disabled', status: 'disabled' });
}

function rolloutIncludes(formula: InternalSocialContentFormula, tenantId: string): boolean {
  if (formula.status === 'active') return true;
  if (formula.status !== 'gray') return false;
  // Current PRD authorizes gray releases by an explicit tenant allowlist only.
  // Keep percentage as forward-compatible metadata, but never use it as an
  // authorization signal until a later contract explicitly enables sampling.
  return formula.rollout.tenantAllowlist.length > 0
    && formula.rollout.tenantAllowlist.includes(tenantId);
}

export async function resolveSocialContentFormula(input: {
  repository: Starter198Repository;
  tenantId: string;
  themeId: SocialContentThemeId;
}): Promise<InternalSocialContentFormula> {
  const formulas = await listSocialContentFormulas({
    repository: input.repository,
    tenantId: SOCIAL_FORMULA_CATALOG_TENANT,
  });
  const eligible = formulas.filter(formula => formula.themeId === input.themeId
    && rolloutIncludes(formula, input.tenantId));
  eligible.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  const selected = eligible[0];
  if (!selected) throw new SocialContentWorkflowError('social_content_formula_unavailable', 503);
  return selected;
}

/** Resolve the exact version already frozen onto a task, even if a newer formula is active. */
export async function resolveSocialContentFormulaReference(input: {
  repository: Starter198Repository;
  formulaId: string;
  version: string;
}): Promise<InternalSocialContentFormula> {
  const formulas = await listSocialContentFormulas({
    repository: input.repository,
    tenantId: SOCIAL_FORMULA_CATALOG_TENANT,
  });
  const matches = formulas.filter(formula => formula.formulaId === input.formulaId && formula.version === input.version);
  if (matches.length !== 1) throw new SocialContentWorkflowError('social_content_formula_reference_invalid', 503);
  return matches[0]!;
}

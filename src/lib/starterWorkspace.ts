import { authHeader, type AuthSession } from './auth';
import {
  STARTER_198_CAPABILITIES,
  STARTER_198_COMMANDS,
  STARTER_AGENT_ROLES,
  type Starter198CapabilityManifest,
  type Starter198Command,
  type StarterAgentRole,
  type StarterAgentUsage,
  type StarterProductionSiteId,
  type StarterRunStatus,
  type StarterTodayItem,
  type StarterWorkspaceAction,
  type StarterWorkspaceCommandInput as CanonicalStarterWorkspaceCommandInput,
  type StarterWorkspaceCommandResult as CanonicalStarterWorkspaceCommandResult,
  type StarterWorkspaceV1,
} from '../../shared/contracts/starter198';

export type ProductProfile = 'starter_198' | 'advanced_customer';
export type StarterWorkspace = StarterWorkspaceV1;
export type StarterWorkspaceCommandInput = Omit<CanonicalStarterWorkspaceCommandInput, 'idempotencyKey'> & { idempotencyKey?: string };
export type StarterWorkspaceCommandResult = CanonicalStarterWorkspaceCommandResult;
type StarterDecision = StarterWorkspaceV1['decisions'][number];
type StarterProductionSite = StarterWorkspaceV1['productionSites'][number];
export type {
  Starter198Command,
  StarterAgentRole,
  StarterAgentUsage,
  StarterProductionSiteId,
  StarterRunStatus,
  StarterTodayItem,
  StarterWorkspaceAction,
};

const AGENT_DEFAULTS: Record<StarterAgentRole, { name: string; site: StarterProductionSiteId | null }> = {
  orchestrator: { name: '灵小枢', site: null },
  content: { name: '灵小图', site: 'content' },
  traffic: { name: '灵小量', site: 'traffic' },
  sales: { name: '灵小售', site: 'sales' },
};

const SITE_DEFAULTS: Record<StarterProductionSiteId, { title: string; role: StarterAgentRole; summary: string }> = {
  inspiration: { title: '灵感大屏', role: 'content', summary: '灵小图的趋势、对标、选题与依据' },
  content: { title: '内容制作', role: 'content', summary: '灵小图的脚本、素材、版本、质检与成品' },
  traffic: { title: '投流／发布', role: 'traffic', summary: '灵小量的发布包、状态、回执、表现与建议' },
  sales: { title: '销售／客户', role: 'sales', summary: '灵小售的询盘、缺项、计价、报价、跟进与结果' },
};

const RESOURCE_LIMIT_KEYS = [
  'workspaceCount', 'brandCount', 'memberCount', 'agentTeamCount', 'productCount', 'marketCount',
  'buyerPersonaCount', 'languageCount', 'primaryPlatformCount', 'concurrentRunCount',
  'contentArtifactCountPerCycle', 'contentRevisionCountPerCycle', 'publicationPackageCountPerContent',
  'assistedSessionCount', 'inquiryAiCountPerCycle', 'quoteDraftCountPerCycle', 'highCostVideoCount',
  'budgetCnyPerCycle',
] as const;
const CAPABILITY_REASONS = new Set([
  'allowed', 'profile_denied', 'entitlement_missing', 'entitlement_disabled', 'entitlement_expired', 'resource_limit_unavailable',
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function signedNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizeCapabilityManifest(value: unknown): Starter198CapabilityManifest | null {
  const source = record(value);
  if (
    source.schemaVersion !== 'starter-198.capabilities.v1'
    || source.productProfile !== 'starter_198'
    || source.profileVersion !== 'starter_198.v1'
    || !text(source.entitlementSnapshotId)
    || !text(source.generatedAt)
    || !Number.isFinite(Date.parse(String(source.generatedAt)))
  ) return null;
  const rawCapabilities = record(source.capabilities);
  const capabilities = {} as Starter198CapabilityManifest['capabilities'];
  for (const capability of STARTER_198_CAPABILITIES) {
    const entry = record(rawCapabilities[capability]);
    if (typeof entry.allowed !== 'boolean' || !CAPABILITY_REASONS.has(String(entry.reason))) return null;
    if ((entry.allowed && entry.reason !== 'allowed') || (!entry.allowed && entry.reason === 'allowed')) return null;
    capabilities[capability] = {
      allowed: entry.allowed,
      reason: entry.reason as Starter198CapabilityManifest['capabilities'][typeof capability]['reason'],
    };
  }
  if (capabilities['workspace.read'].allowed !== true) return null;
  const rawLimits = record(source.resourceLimits);
  if (!RESOURCE_LIMIT_KEYS.every(key => number(rawLimits[key]) !== null)) return null;
  if (!RESOURCE_LIMIT_KEYS.filter(key => key !== 'budgetCnyPerCycle').every(key => Number.isInteger(rawLimits[key]))) return null;
  const rawAgentBudget = record(rawLimits.agentBudgetCny);
  if (!STARTER_AGENT_ROLES.every(role => number(rawAgentBudget[role]) !== null)) return null;
  const resourceLimits = {
    ...Object.fromEntries(RESOURCE_LIMIT_KEYS.map(key => [key, Number(rawLimits[key])])),
    agentBudgetCny: Object.fromEntries(STARTER_AGENT_ROLES.map(role => [role, Number(rawAgentBudget[role])])),
  } as Starter198CapabilityManifest['resourceLimits'];
  if (Object.values(resourceLimits.agentBudgetCny).reduce((sum, amount) => sum + amount, 0) > resourceLimits.budgetCnyPerCycle) return null;
  return {
    schemaVersion: 'starter-198.capabilities.v1',
    productProfile: 'starter_198',
    profileVersion: 'starter_198.v1',
    entitlementSnapshotId: text(source.entitlementSnapshotId)!,
    generatedAt: text(source.generatedAt)!,
    capabilities,
    resourceLimits,
  };
}

function agentRole(value: unknown, fallback: StarterAgentRole = 'orchestrator'): StarterAgentRole {
  return value === 'content' || value === 'traffic' || value === 'sales' || value === 'orchestrator' ? value : fallback;
}

function siteId(value: unknown): StarterProductionSiteId | null {
  return value === 'inspiration' || value === 'content' || value === 'traffic' || value === 'sales' ? value : null;
}

function availability(value: unknown): 'available' | 'pending' | 'unavailable' {
  return value === 'available' || value === 'pending' || value === 'unavailable' ? value : 'unavailable';
}

function runStatus(value: unknown): StarterRunStatus {
  return value === 'idle' || value === 'running' || value === 'waiting_user' || value === 'blocked' || value === 'error' || value === 'completed' || value === 'paused' ? value : 'unknown';
}

const STARTER_COMMAND_SET = new Set<string>(STARTER_198_COMMANDS);
const TARGETLESS_WORKSPACE_COMMANDS = new Set<Starter198Command>([
  'confirm_initial_setup',
  'confirm_quote_rule',
  'submit_quote_inquiry',
  'submit_orchestrator_input',
]);

function starterCommand(value: unknown): Starter198Command | null {
  const candidate = text(value);
  return candidate && STARTER_COMMAND_SET.has(candidate) ? candidate as Starter198Command : null;
}

/**
 * Today cards have presentation ids, but commands that create/append business
 * records do not have a mutable target. Keep those ids out of the command
 * envelope so the backend audit journal cannot confuse UI context with a
 * canonical aggregate id.
 */
export function starterWorkspaceCommandTargetId(
  command: Starter198Command,
  contextualTargetId: string,
): string | undefined {
  if (TARGETLESS_WORKSPACE_COMMANDS.has(command)) return undefined;
  const targetId = contextualTargetId.trim();
  return targetId || undefined;
}

function action(value: unknown, index: number): StarterWorkspaceAction | null {
  const source = record(value);
  const command = starterCommand(source.command);
  const label = text(source.label);
  const rawKind = text(source.kind);
  const kind = rawKind === 'primary' || rawKind === 'danger' || rawKind === 'download' ? rawKind : 'secondary';
  const href = safeArtifactHref(source.href);
  if (!label || (kind === 'download' ? !href : !command)) return null;
  return {
    id: text(source.id) || `${command || 'download'}:${index}`,
    label,
    command: kind === 'download' ? null : command,
    kind,
    href,
    disabledReason: text(source.disabledReason),
    expectedVersion: text(source.expectedVersion),
  };
}

function actions(value: unknown): StarterWorkspaceAction[] {
  return array(value).map(action).filter((item): item is StarterWorkspaceAction => Boolean(item));
}

function todayItem(value: unknown, index: number): StarterTodayItem | null {
  const source = record(value);
  const what = text(source.what) || text(source.title);
  if (!what) return null;
  return {
    id: text(source.id) || `today:${index}`,
    what,
    ownerAgent: agentRole(source.ownerAgent ?? source.agentRole),
    why: text(source.why),
    status: text(source.status) || '状态未知',
    output: text(source.output),
    next: text(source.next),
    evidence: text(source.evidence),
    updatedAt: text(source.updatedAt),
    actions: actions(source.actions),
  };
}

function decision(value: unknown, index: number): StarterDecision | null {
  const source = record(value);
  const title = text(source.title);
  if (!title) return null;
  const risk = text(source.riskLevel);
  return {
    id: text(source.id) || `decision:${index}`,
    type: text(source.type) || 'decision',
    title,
    summary: text(source.summary) || '',
    riskLevel: risk === 'L0' || risk === 'L1' || risk === 'L2' || risk === 'L3' ? risk : 'unknown',
    dueAt: text(source.dueAt),
    recommendedOption: text(source.recommendedOption),
    difference: text(source.difference),
    effect: text(source.effect),
    evidence: text(source.evidence),
    subjectVersion: text(source.subjectVersion),
    actions: actions(source.actions),
  };
}

function normalizeAgent(value: unknown, fallbackRole: StarterAgentRole): StarterAgentUsage {
  const source = record(value);
  const role = agentRole(source.role, fallbackRole);
  const tokenSource = record(source.tokens);
  const costSource = record(source.costCny ?? source.cost_cny);
  const budgetSource = record(source.budgetCny ?? source.budget_cny);
  const outputSource = record(source.outputs);
  const settlement = text(costSource.settlementStatus);
  return {
    role,
    displayName: text(source.displayName) || AGENT_DEFAULTS[role].name,
    stage: text(source.stage) || '尚未开始',
    status: runStatus(source.status),
    tokens: {
      input: number(tokenSource.input),
      output: number(tokenSource.output),
      cache: number(tokenSource.cache),
      total: number(tokenSource.total),
    },
    costCny: {
      estimated: number(costSource.estimated),
      reserved: number(costSource.reserved),
      settled: number(costSource.settled),
      settlementStatus: settlement === 'settled' || settlement === 'pending' ? settlement : 'unknown',
      updatedAt: text(costSource.updatedAt),
    },
    budgetCny: {
      total: number(budgetSource.total),
      used: number(budgetSource.used),
      reserved: number(budgetSource.reserved),
      remaining: signedNumber(budgetSource.remaining),
      projectedOverrun: boolean(budgetSource.projectedOverrun),
    },
    outputs: {
      completed: number(outputSource.completed),
      usable: number(outputSource.usable),
      awaitingDecision: number(outputSource.awaitingDecision),
      summary: text(outputSource.summary),
    },
    waits: {
      count: number(record(source.waits).count) ?? 0,
      reasons: array(record(source.waits).reasons).map(text).filter((item): item is string => Boolean(item)),
    },
    anomalies: array(source.anomalies).map(text).filter((item): item is string => Boolean(item)),
    productionSite: siteId(source.productionSite) ?? AGENT_DEFAULTS[role].site,
  };
}

function normalizeSite(value: unknown, fallbackId?: StarterProductionSiteId): StarterProductionSite | null {
  const source = record(value);
  const id = siteId(source.id) ?? fallbackId ?? null;
  if (!id) return null;
  const defaults = SITE_DEFAULTS[id];
  return {
    id,
    title: text(source.title) || defaults.title,
    agentRole: agentRole(source.agentRole, defaults.role),
    summary: text(source.summary) || defaults.summary,
    status: runStatus(source.status),
    updatedAt: text(source.updatedAt),
    sections: array(source.sections).map((entry, sectionIndex) => {
      const section = record(entry);
      return {
        id: text(section.id) || `${id}:section:${sectionIndex}`,
        label: text(section.label) || '未命名分组',
        status: text(section.status) || '状态未知',
        count: number(section.count),
        items: array(section.items).map((rawItem, itemIndex) => {
          const item = record(rawItem);
          return {
            id: text(item.id) || `${id}:item:${sectionIndex}:${itemIndex}`,
            title: text(item.title) || '未命名产物',
            summary: text(item.summary),
            status: text(item.status) || '状态未知',
            updatedAt: text(item.updatedAt),
            evidence: text(item.evidence),
          };
        }),
      };
    }),
  };
}

export function normalizeStarterWorkspace(value: unknown): StarterWorkspace {
  const source = record(value);
  if (source.productProfile !== 'starter_198') throw new Error('工作台产品能力未开通');
  const capabilityManifest = normalizeCapabilityManifest(source.capabilityManifest);
  if (!capabilityManifest) {
    throw new Error('工作台权限清单缺失，已停止加载');
  }
  const todaySource = record(source.today);
  const resultsSource = record(source.results);
  const runSource = record(source.run);
  const suppliedAgents = new Map<StarterAgentRole, unknown>();
  for (const rawAgent of array(source.agents)) {
    const role = agentRole(record(rawAgent).role);
    suppliedAgents.set(role, rawAgent);
  }
  const suppliedSites = new Map<StarterProductionSiteId, unknown>();
  for (const rawSite of array(source.productionSites)) {
    const id = siteId(record(rawSite).id);
    if (id) suppliedSites.set(id, rawSite);
  }
  const stages = array(resultsSource.stages).map((rawStage, index) => {
    const stage = record(rawStage);
    return {
      id: text(stage.id) || `stage:${index}`,
      label: text(stage.label) || '未命名阶段',
      value: number(stage.value),
      availability: availability(stage.availability),
      source: text(stage.source),
      note: text(stage.note),
    };
  });
  const artifacts = array(resultsSource.artifacts).map((rawArtifact, index) => {
    const artifact = record(rawArtifact);
    return {
      id: text(artifact.id) || `artifact:${index}`,
      title: text(artifact.title) || '未命名成果',
      kind: text(artifact.kind) || '成果',
      status: text(artifact.status) || '状态未知',
      agentRole: agentRole(artifact.agentRole),
      createdAt: text(artifact.createdAt),
      evidence: text(artifact.evidence),
      actions: actions(artifact.actions),
    };
  });
  return {
    productProfile: 'starter_198',
    generatedAt: text(source.generatedAt) || '',
    greeting: text(source.greeting),
    capabilityManifest,
    run: {
      id: text(runSource.id),
      status: runStatus(runSource.status),
      cycleLabel: text(runSource.cycleLabel),
      nextCheckpointAt: text(runSource.nextCheckpointAt),
    },
    today: {
      completed: array(todaySource.completed).map(todayItem).filter((item): item is StarterTodayItem => Boolean(item)),
      resultChanges: array(todaySource.resultChanges).map((rawChange, index) => {
        const change = record(rawChange);
        return {
          id: text(change.id) || `change:${index}`,
          label: text(change.label) || '未命名指标',
          value: number(change.value),
          unit: text(change.unit) || '',
          delta: signedNumber(change.delta),
          availability: availability(change.availability),
          note: text(change.note),
        };
      }),
      inProgress: array(todaySource.inProgress).map(todayItem).filter((item): item is StarterTodayItem => Boolean(item)),
      nextSteps: array(todaySource.nextSteps).map(todayItem).filter((item): item is StarterTodayItem => Boolean(item)),
    },
    decisions: array(source.decisions).map(decision).filter((item): item is StarterDecision => Boolean(item)),
    results: { stages, artifacts },
    agents: (Object.keys(AGENT_DEFAULTS) as StarterAgentRole[]).map(role => normalizeAgent(suppliedAgents.get(role), role)),
    productionSites: (Object.keys(SITE_DEFAULTS) as StarterProductionSiteId[]).map(id => normalizeSite(suppliedSites.get(id), id)!),
    controls: actions(source.controls),
  };
}

export function resolveProductProfile(session: AuthSession | null): ProductProfile | null {
  if (!session) return null;
  const candidate = (session as AuthSession & { productProfile?: unknown }).productProfile ??
    (session.tenant as (typeof session.tenant & { productProfile?: unknown }) | null)?.productProfile;
  if (candidate === 'starter_198' || candidate === 'advanced_customer') return candidate;
  return null;
}

export function isStarter198Session(session: AuthSession | null): boolean {
  return resolveProductProfile(session) === 'starter_198';
}

/** Subscription labels are presentation metadata, never product-boundary authority. */
export function shouldBypassStarter198Probe(session: AuthSession | null): boolean {
  return Boolean(session?.supportAccess || session?.platformAdmin === true);
}

export function safeArtifactHref(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
    const url = new URL(raw, origin);
    if (url.username || url.password) return null;
    if (url.protocol !== 'https:' && url.origin !== origin) return null;
    return url.href;
  } catch {
    return null;
  }
}

type WorkspaceCacheEntry = { value: StarterWorkspace; at: number };

// A browser can switch tenants without a full reload (login/logout and support
// sessions). Never let one identity reuse another identity's projection or
// in-flight request. The bearer value is kept only as an in-memory map key and
// is never rendered, persisted, or logged.
const cachedWorkspaces = new Map<string, WorkspaceCacheEntry>();
const inFlightWorkspaces = new Map<string, Promise<StarterWorkspace>>();
const CACHE_MS = 15_000;

function workspaceRequestContext(): { scope: string; headers: Record<string, string> } {
  const headers = authHeader();
  return { scope: headers.Authorization || '__anonymous__', headers };
}

function pruneWorkspaceCaches(now = Date.now()): void {
  for (const [scope, entry] of cachedWorkspaces) {
    if (now - entry.at >= CACHE_MS) cachedWorkspaces.delete(scope);
  }
}

export class StarterWorkspaceRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
    this.name = 'StarterWorkspaceRequestError';
  }
}

function responseError(payload: unknown, fallback: string): { code: string | null; message: string } {
  const source = record(payload);
  const rawError = source.error;
  if (typeof rawError === 'string') return { code: rawError, message: text(source.message) || rawError };
  const error = record(rawError);
  return { code: text(error.code), message: text(error.message) || text(source.message) || fallback };
}

function downloadFilename(response: Response, href: string): string {
  const disposition = response.headers.get('Content-Disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  let candidate = encoded ? decodeURIComponent(encoded) : plain;
  if (!candidate) {
    try { candidate = new URL(href).pathname.split('/').filter(Boolean).at(-1) || '发布包.zip'; }
    catch { candidate = '发布包.zip'; }
  }
  const safe = candidate.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180);
  return safe || '发布包.zip';
}

export async function fetchStarterArtifact(href: string): Promise<{ blob: Blob; filename: string }> {
  const safeHref = safeArtifactHref(href);
  if (!safeHref) throw new Error('下载地址无效');
  const url = new URL(safeHref);
  const currentOrigin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const response = await fetch(safeHref, {
    headers: {
      ...(url.origin === currentOrigin ? authHeader() : {}),
      Accept: 'application/zip,application/octet-stream,application/json;q=0.5',
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const failure = responseError(payload, '发布包下载失败');
    throw new StarterWorkspaceRequestError(failure.message, response.status, failure.code);
  }
  return { blob: await response.blob(), filename: downloadFilename(response, safeHref) };
}

async function downloadStarterArtifact(href: string): Promise<void> {
  const result = await fetchStarterArtifact(href);
  const objectUrl = URL.createObjectURL(result.blob);
  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = result.filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

async function requestWorkspace(headers: Record<string, string>): Promise<StarterWorkspace> {
  const response = await fetch('/api/overseas/starter-198/workspace', {
    headers: { ...headers, Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = responseError(payload, '灵小枢工作台暂时无法读取');
    throw new StarterWorkspaceRequestError(failure.message, response.status, failure.code);
  }
  return normalizeStarterWorkspace(payload);
}

export const starterWorkspaceApi = {
  get: async (options?: { force?: boolean }): Promise<StarterWorkspace> => {
    const context = workspaceRequestContext();
    const now = Date.now();
    pruneWorkspaceCaches(now);
    const cached = cachedWorkspaces.get(context.scope);
    if (!options?.force && cached && now - cached.at < CACHE_MS) return cached.value;
    const existing = inFlightWorkspaces.get(context.scope);
    if (!options?.force && existing) return existing;
    const request = requestWorkspace(context.headers);
    inFlightWorkspaces.set(context.scope, request);
    try {
      const value = await request;
      // A newer forced refresh for the same identity wins even if this older
      // network response arrives last.
      if (inFlightWorkspaces.get(context.scope) === request) {
        cachedWorkspaces.set(context.scope, { value, at: Date.now() });
      }
      return value;
    } finally {
      if (inFlightWorkspaces.get(context.scope) === request) {
        inFlightWorkspaces.delete(context.scope);
      }
    }
  },
  command: async (input: StarterWorkspaceCommandInput): Promise<StarterWorkspaceCommandResult> => {
    const context = workspaceRequestContext();
    const idempotencyKey = input.idempotencyKey || (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `starter-command-${Date.now()}`);
    const response = await fetch('/api/overseas/starter-198/commands', {
      method: 'POST',
      headers: { ...context.headers, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...input, idempotencyKey }),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const failure = responseError(payload, '操作未生效，请刷新后重试');
      throw new StarterWorkspaceRequestError(failure.message, response.status, failure.code);
    }
    cachedWorkspaces.delete(context.scope);
    return {
      accepted: payload.accepted === true,
      commandId: text(payload.commandId),
      message: text(payload.message),
      workspace: payload.workspace ? normalizeStarterWorkspace(payload.workspace) : undefined,
    };
  },
  download: downloadStarterArtifact,
  invalidate: () => { cachedWorkspaces.delete(workspaceRequestContext().scope); },
  clearAll: () => {
    cachedWorkspaces.clear();
    inFlightWorkspaces.clear();
  },
};

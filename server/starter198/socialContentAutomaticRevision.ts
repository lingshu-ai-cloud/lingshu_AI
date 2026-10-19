import { socialRequestHash } from './socialContentValidation.js';

export type SocialContentAutomaticRevisionKind = 'asset_supply_fallback' | 'budget_degrade';

export interface SocialContentAutomaticRevisionCommand {
  schemaVersion: 'social-content-automatic-revision-command.v1';
  commandId: string;
  tenantId: string;
  taskId: string;
  expectedTaskVersion: string;
  sourceRunId: string;
  sourcePlanHash: string;
  revisionPlanHash: string;
  budgetLedgerRef: string;
  kind: SocialContentAutomaticRevisionKind;
  affectedShotIds: string[];
  evidenceRefs: string[];
  revisionPayloadHash: string;
}
export interface SocialContentAutomaticRevisionSnapshot {
  tenantId: string;
  taskId: string;
  taskVersion: string;
  runId: string;
  planHash: string;
  budgetLedgerRef: string;
  runStatus: string;
}

export interface SocialContentAutomaticRevisionPrepared {
  command: SocialContentAutomaticRevisionCommand;
  preparedTaskVersion: string;
  preparedPlanHash: string;
}

export interface SocialContentAutomaticRevisionPorts {
  readSnapshot(input: Pick<SocialContentAutomaticRevisionCommand, 'tenantId' | 'taskId'>): Promise<SocialContentAutomaticRevisionSnapshot>;
  /** Existing run cancellation/archive implementation. Supplier receipts and
   * artifacts remain immutable evidence; this operation only fences callbacks. */
  sealSourceRun(input: { command: SocialContentAutomaticRevisionCommand; snapshot: SocialContentAutomaticRevisionSnapshot }): Promise<void>;
  /** Existing task revision CAS. It must persist the compiled plan and return
   * the resulting task version; it must not mint a new budget identity. */
  prepareRevision(input: { command: SocialContentAutomaticRevisionCommand; snapshot: SocialContentAutomaticRevisionSnapshot }): Promise<SocialContentAutomaticRevisionPrepared>;
  /** Existing startSocialContentTask/queue path. */
  startPreparedRevision(input: { command: SocialContentAutomaticRevisionCommand; prepared: SocialContentAutomaticRevisionPrepared }): Promise<{ runId: string; planHash: string; budgetLedgerRef: string }>;
  /** Existing AssistantDecisionCenter command path. */
  createDecision?(input: { command: SocialContentAutomaticRevisionCommand; reason: string }): Promise<void>;
}

const SHA256 = /^[a-f0-9]{64}$/;
const TERMINAL = new Set(['completed', 'succeeded', 'cancelled', 'failed']);

function normalizedStrings(values: string[], code: string): string[] {
  const result = [...new Set(values.map(value => String(value).trim()).filter(Boolean))].sort();
  if (!result.length) throw new Error(code);
  return result;
}

/**
 * Shared command boundary for ADR-027/028. It deliberately owns no storage,
 * queue, budget, approval or decision implementation. The supplied ports must
 * be adapters over the existing revision/start/DecisionCenter services.
 */
export async function executeSocialContentAutomaticRevision(
  raw: SocialContentAutomaticRevisionCommand,
  ports: SocialContentAutomaticRevisionPorts,
): Promise<{ action: 'started'; runId: string; planHash: string; budgetLedgerRef: string }> {
  const command: SocialContentAutomaticRevisionCommand = {
    ...structuredClone(raw),
    affectedShotIds: normalizedStrings(raw.affectedShotIds, 'automatic_revision_affected_shots_required'),
    evidenceRefs: normalizedStrings(raw.evidenceRefs, 'automatic_revision_evidence_required'),
  };
  if (command.schemaVersion !== 'social-content-automatic-revision-command.v1'
    || !command.commandId.trim() || !command.tenantId.trim() || !command.taskId.trim()
    || !command.expectedTaskVersion.trim() || !command.sourceRunId.trim() || !command.budgetLedgerRef.trim()
    || !SHA256.test(command.sourcePlanHash) || !SHA256.test(command.revisionPlanHash)
    || !SHA256.test(command.revisionPayloadHash) || command.sourcePlanHash === command.revisionPlanHash
    || !['asset_supply_fallback', 'budget_degrade'].includes(command.kind)) {
    throw new Error('automatic_revision_command_invalid');
  }
  const snapshot = await ports.readSnapshot(command);
  if (snapshot.tenantId !== command.tenantId || snapshot.taskId !== command.taskId
    || snapshot.taskVersion !== command.expectedTaskVersion || snapshot.runId !== command.sourceRunId
    || snapshot.planHash !== command.sourcePlanHash || snapshot.budgetLedgerRef !== command.budgetLedgerRef) {
    throw new Error('automatic_revision_source_changed');
  }
  if (!TERMINAL.has(snapshot.runStatus)) await ports.sealSourceRun({ command, snapshot });
  const prepared = await ports.prepareRevision({ command, snapshot });
  if (!prepared.preparedTaskVersion.trim() || prepared.preparedTaskVersion === command.expectedTaskVersion
    || prepared.preparedPlanHash !== command.revisionPlanHash) {
    throw new Error('automatic_revision_prepare_invalid');
  }
  const started = await ports.startPreparedRevision({ command, prepared });
  if (!started.runId.trim() || started.runId === command.sourceRunId
    || started.planHash !== command.revisionPlanHash || started.budgetLedgerRef !== command.budgetLedgerRef) {
    throw new Error('automatic_revision_start_invalid');
  }
  return { action: 'started', ...started };
}

/** Routes terminal recovery through the existing decision-center adapter. A
 * caller must supply the same frozen command identity it would have used for
 * a revision, so the decision card can retain task/run/shot/version lineage. */
export async function routeSocialContentAutomaticRevisionFailure(
  command: SocialContentAutomaticRevisionCommand,
  reason: 'no_valid_degrade_revision' | 'budget_exhausted' | 'product_assets_unavailable',
  ports: Pick<SocialContentAutomaticRevisionPorts, 'createDecision'>,
): Promise<{ action: 'needs_decision'; reason: typeof reason }> {
  if (!ports.createDecision) throw new Error('automatic_revision_decision_center_required');
  await ports.createDecision({ command: structuredClone(command), reason });
  return { action: 'needs_decision', reason };
}

export function createSocialContentAutomaticRevisionCommand(input: Omit<SocialContentAutomaticRevisionCommand, 'schemaVersion' | 'revisionPayloadHash'> & { revisionPayload: unknown }): SocialContentAutomaticRevisionCommand {
  return {
    schemaVersion: 'social-content-automatic-revision-command.v1',
    commandId: input.commandId,
    tenantId: input.tenantId,
    taskId: input.taskId,
    expectedTaskVersion: input.expectedTaskVersion,
    sourceRunId: input.sourceRunId,
    sourcePlanHash: input.sourcePlanHash,
    revisionPlanHash: input.revisionPlanHash,
    budgetLedgerRef: input.budgetLedgerRef,
    kind: input.kind,
    affectedShotIds: [...input.affectedShotIds],
    evidenceRefs: [...input.evidenceRefs],
    revisionPayloadHash: socialRequestHash(input.revisionPayload),
  };
}


import { createHash } from 'node:crypto';
import { store } from '../storage/index.js';
import { evaluateSocialCandidateEvidence } from '../../shared/socialInspirationStrategy.js';
import type { SocialCandidateEvidence, SocialDiscoveryPath } from '../../shared/contracts/socialContentWorkflow.js';
import { assessAccountRelativeMomentum, buildCandidateG1, type CandidateG1, type PerformanceSnapshot, type VersionedCandidateEvidence } from './qualityOrchestration.js';

export const CANDIDATE_EVIDENCE_COLLECTION = 'social_candidate_evidence';
export const DISCOVERY_GAP_TASK_COLLECTION = 'social_discovery_gap_tasks';
export const REFERENCE_SELECTION_COLLECTION = 'social_reference_selections';

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export interface CandidateEvidenceInput {
  tenantId: string;
  candidateId: string;
  discoveryPath: SocialDiscoveryPath[];
  sceneIds?: string[];
  taskRelevance?: number;
  currentPerformance?: number | null;
  accountPlatformBaseline?: number | null;
  performanceSnapshots?: PerformanceSnapshot[];
  transferability?: number;
  mechanisms?: string[];
  limitations?: string[];
  evidenceRefs?: string[];
  novelty?: number | null;
  g1: Parameters<typeof buildCandidateG1>[0];
  now?: Date;
}

/** Append-only evidence writer. Identical inputs are idempotent; changed inputs create a new version. */
export async function persistCandidateEvidence(input: CandidateEvidenceInput): Promise<VersionedCandidateEvidence> {
  const immutableInput = { ...input, now: undefined };
  const inputFingerprint = fingerprint(immutableInput);
  const existing = await store.list<VersionedCandidateEvidence & { id: string; tenant_id: string }>(CANDIDATE_EVIDENCE_COLLECTION, {
    where: { tenant_id: input.tenantId, candidateId: input.candidateId }, sort: '-version', page: 1, perPage: 1,
  });
  const latest = existing.items[0];
  if (latest?.inputFingerprint === inputFingerprint) return latest;
  const momentum = assessAccountRelativeMomentum({
    currentPerformance: input.currentPerformance,
    accountPlatformBaseline: input.accountPlatformBaseline,
    snapshots: input.performanceSnapshots,
  });
  const base = evaluateSocialCandidateEvidence({
    inspirationId: input.candidateId,
    discoveryPath: input.discoveryPath,
    sceneIds: input.sceneIds,
    taskRelevance: input.taskRelevance,
    currentPerformance: input.currentPerformance,
    accountPlatformBaseline: input.accountPlatformBaseline,
    hasTimeSeries: momentum.consecutiveSnapshotGrowth === true,
    transferability: input.transferability,
    mechanisms: input.mechanisms,
    limitations: input.limitations,
    evidenceRefs: input.evidenceRefs,
    novelty: input.novelty,
  });
  const evidence: SocialCandidateEvidence = { ...base, momentum: { ...base.momentum, level: momentum.level, reasons: momentum.reasons } };
  const g1 = buildCandidateG1(input.g1);
  const version = (latest?.version ?? 0) + 1;
  const createdAt = (input.now ?? new Date()).toISOString();
  const value: VersionedCandidateEvidence = {
    evidenceId: `candidate_evidence_${fingerprint({ tenantId: input.tenantId, candidateId: input.candidateId, version, inputFingerprint }).slice(0, 20)}`,
    version,
    tenantId: input.tenantId,
    candidateId: input.candidateId,
    inputFingerprint,
    evidence,
    g1,
    completeness: g1.missingFields.length === 0 ? 'complete' : g1.missingFields.length < 6 ? 'partial' : 'unknown',
    createdAt,
    supersedesEvidenceId: latest?.evidenceId ?? null,
  };
  const saved = await store.create(CANDIDATE_EVIDENCE_COLLECTION, { ...value, tenant_id: input.tenantId });
  if (!saved) throw new Error('candidate_evidence_storage_unavailable');
  return value;
}

export interface InventoryCandidate {
  candidateId: string;
  evidenceId: string;
  evidenceVersion: number;
  readiness: 'discovery_reference' | 'strategy_reference' | 'production_reference';
  taskRelevance: number;
  transferability: number;
  rightsClear: boolean;
  sceneIds: string[];
  sourceRef?: string | 'unknown';
}

export interface ReferenceSelection {
  status: 'selected' | 'needs_collection' | 'blocked';
  selected: InventoryCandidate[];
  reason: string;
  evidenceVersionRefs: string[];
}

export interface VersionedReferenceSelection extends ReferenceSelection {
  selectionId: string;
  version: number;
  tenantId: string;
  upstreamTaskRef: string;
  createdAt: string;
  supersedesSelectionId: string | null;
}

export class ReferenceSelector {
  select(input: { candidates: InventoryCandidate[]; requiredSceneIds?: string[]; minimumReferences?: number; requireProductionReady?: boolean }): ReferenceSelection {
    const required = new Set(input.requiredSceneIds ?? []);
    const minimum = Math.max(1, Math.floor(input.minimumReferences ?? 1));
    const eligible = input.candidates
      .filter(item => item.rightsClear)
      .filter(item => Boolean(item.sourceRef && item.sourceRef !== 'unknown'))
      .filter(item => !input.requireProductionReady || item.readiness === 'production_reference')
      .filter(item => required.size === 0 || item.sceneIds.some(sceneId => required.has(sceneId)))
      .filter(item => item.taskRelevance >= 0.7 && item.transferability >= 0.6)
      .sort((a, b) => b.taskRelevance + b.transferability - a.taskRelevance - a.transferability || a.candidateId.localeCompare(b.candidateId));
    if (eligible.length < minimum) return { status: 'needs_collection', selected: [], reason: 'inventory_evidence_insufficient', evidenceVersionRefs: [] };
    const selected = eligible.slice(0, minimum);
    return { status: 'selected', selected, reason: 'inventory_covered', evidenceVersionRefs: selected.map(item => `${item.evidenceId}@${item.evidenceVersion}`) };
  }
}

export async function persistReferenceSelection(input: {
  tenantId: string;
  upstreamTaskRef: string;
  selection: ReferenceSelection;
  now?: Date;
}): Promise<VersionedReferenceSelection> {
  const existing = await store.list<VersionedReferenceSelection & { id: string; tenant_id: string }>(REFERENCE_SELECTION_COLLECTION, {
    where: { tenant_id: input.tenantId, upstreamTaskRef: input.upstreamTaskRef }, sort: '-version', page: 1, perPage: 1,
  });
  const latest = existing.items[0];
  const version = (latest?.version ?? 0) + 1;
  const value: VersionedReferenceSelection = {
    ...input.selection,
    selectionId: `reference_selection_${fingerprint({ tenantId: input.tenantId, upstreamTaskRef: input.upstreamTaskRef, version, selection: input.selection }).slice(0, 20)}`,
    version,
    tenantId: input.tenantId,
    upstreamTaskRef: input.upstreamTaskRef,
    createdAt: (input.now ?? new Date()).toISOString(),
    supersedesSelectionId: latest?.selectionId ?? null,
  };
  const saved = await store.create(REFERENCE_SELECTION_COLLECTION, { ...value, tenant_id: input.tenantId });
  if (!saved) throw new Error('reference_selection_storage_unavailable');
  return value;
}

export interface ProductionGapTask {
  gapTaskId: string;
  tenantId: string;
  upstreamTaskRef: string;
  productionGap: string;
  status: 'collecting' | 'resumed' | 'blocked';
  budgetLimitCny: number;
  spentCny: number;
  runRefs: string[];
  selectedEvidenceRefs: string[];
  stopReason: 'inventory_covered' | 'evidence_satisfied' | 'budget_exhausted' | null;
  createdAt: string;
  updatedAt: string;
}

export function advanceProductionGapTask(input: {
  task: ProductionGapTask;
  selection: ReferenceSelection;
  addedCostCny?: number | null;
  runRef?: string;
  now?: Date;
}): ProductionGapTask {
  if (input.task.status !== 'collecting') return input.task;
  const spentCny = input.task.spentCny + Math.max(0, input.addedCostCny ?? 0);
  const runRefs = input.runRef ? [...new Set([...input.task.runRefs, input.runRef])] : input.task.runRefs;
  const updatedAt = (input.now ?? new Date()).toISOString();
  if (input.selection.status === 'selected') return {
    ...input.task, spentCny, runRefs, status: 'resumed', stopReason: input.task.runRefs.length ? 'evidence_satisfied' : 'inventory_covered',
    selectedEvidenceRefs: input.selection.evidenceVersionRefs, updatedAt,
  };
  if (spentCny >= input.task.budgetLimitCny) return { ...input.task, spentCny, runRefs, status: 'blocked', stopReason: 'budget_exhausted', updatedAt };
  return { ...input.task, spentCny, runRefs, updatedAt };
}

export async function saveProductionGapTask(task: ProductionGapTask): Promise<void> {
  const existing = await store.list<{ id: string }>(DISCOVERY_GAP_TASK_COLLECTION, { where: { tenant_id: task.tenantId, gapTaskId: task.gapTaskId }, page: 1, perPage: 1 });
  const payload = { ...task, tenant_id: task.tenantId };
  const saved = existing.items[0] ? await store.update(DISCOVERY_GAP_TASK_COLLECTION, existing.items[0].id, payload) : await store.create(DISCOVERY_GAP_TASK_COLLECTION, payload);
  if (!saved) throw new Error('production_gap_task_storage_unavailable');
}

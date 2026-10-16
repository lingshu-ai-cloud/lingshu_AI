import type { CapabilityState, RuntimeCapability } from './readiness.js';

export type WeeklyAgentReleaseGateIssue = {
  stage: 'weekly' | 'handoff' | 'queue' | 'graph' | 'quality' | 'delivery' | 'runtime';
  code: string;
  blocking: 'film' | 'automatic_publication';
};

export type WeeklyAgentReleaseGateInput = {
  weekly: {
    tenantId: string;
    runId: string;
    taskId: string;
    publicationTaskId: string;
    packageId: string;
    packageVersion: number;
  };
  handoff: {
    schemaVersion: string;
    handoffId: string;
    status: string;
    taskId: string;
    version: string;
    recordHash: string;
    sourceAnalysis: { analysisId: string; version: string; coverageHash: string };
    shotTraces: Array<{ sceneId: string; immutableIntentHash: string; execution: { idempotencyKey: string } }>;
  };
  queue: {
    tenantId: string;
    taskId: string;
    runId: string;
    status: string;
    planVersion: string;
    inputHash: string;
  };
  graph: {
    identity: { tenantId: string; taskId: string; runId: string; planVersion: string; inputHash: string };
    completed: boolean;
    approval: { approved: boolean; receiptRef: string; subjectVersion: string; contentHash: string } | null;
    evidence: Partial<Record<'assets' | 'render' | 'quality' | 'delivery', {
      artifactRefs: string[];
      inputHash: string;
      metadata?: Record<string, unknown>;
    }>>;
  };
  qualityReceipts: Array<{
    gate: 'G4' | 'G5' | 'G6';
    sceneId?: string | null;
    status: string;
    handoffId: string;
    handoffVersion: string;
    evidenceRefs: string[];
  }>;
  delivery: {
    artifactId: string;
    artifactStatus: string;
    mediaSha256: string;
    packageId: string;
    packageStatus: string;
    packageHash: string;
    artifactIds: string[];
  };
  capabilities: Record<RuntimeCapability, CapabilityState>;
};

const HASH = /^[a-f0-9]{64}$/;
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/**
 * Read-only evidence gate for the 1014 weekly task -> agent -> finished film chain.
 * It does not advance a task, call a provider, publish, or accept UI state as proof.
 */
export function inspectWeeklyAgentReleaseGate(input: WeeklyAgentReleaseGateInput) {
  const issues: WeeklyAgentReleaseGateIssue[] = [];
  const film = (stage: WeeklyAgentReleaseGateIssue['stage'], code: string) => issues.push({ stage, code, blocking: 'film' });
  const publication = (code: string) => issues.push({ stage: 'runtime', code, blocking: 'automatic_publication' });

  const scope = input.weekly;
  if (![scope.tenantId, scope.runId, scope.taskId, scope.publicationTaskId, scope.packageId].every(nonEmpty)
    || !Number.isSafeInteger(scope.packageVersion) || scope.packageVersion < 1) film('weekly', 'weekly_scope_invalid');

  if (input.handoff.schemaVersion !== 'social-content-production-handoff.v3' || !nonEmpty(input.handoff.handoffId)
    || input.handoff.status !== 'locked' || input.handoff.taskId !== scope.taskId
    || !nonEmpty(input.handoff.version) || !HASH.test(input.handoff.recordHash)
    || !nonEmpty(input.handoff.sourceAnalysis.analysisId) || !nonEmpty(input.handoff.sourceAnalysis.version)
    || !HASH.test(input.handoff.sourceAnalysis.coverageHash)) film('handoff', 'production_handoff_invalid');
  if (!input.handoff.shotTraces.length
    || new Set(input.handoff.shotTraces.map(item => item.sceneId)).size !== input.handoff.shotTraces.length
    || new Set(input.handoff.shotTraces.map(item => item.execution.idempotencyKey)).size !== input.handoff.shotTraces.length
    || input.handoff.shotTraces.some(item => !nonEmpty(item.sceneId) || !nonEmpty(item.execution.idempotencyKey)
      || !HASH.test(item.immutableIntentHash))) film('handoff', 'production_handoff_shot_lineage_invalid');

  const queue = input.queue;
  if (queue.tenantId !== scope.tenantId || queue.taskId !== scope.taskId || queue.runId !== scope.runId
    || queue.planVersion !== input.handoff.version || !HASH.test(queue.inputHash)
    || !['leased', 'waiting_review', 'succeeded'].includes(queue.status)) film('queue', 'durable_job_binding_invalid');

  const identity = input.graph.identity;
  if (identity.tenantId !== queue.tenantId || identity.taskId !== queue.taskId || identity.runId !== queue.runId
    || identity.planVersion !== queue.planVersion || identity.inputHash !== queue.inputHash) film('graph', 'production_graph_identity_mismatch');
  const phases = ['assets', 'render', 'quality', 'delivery'] as const;
  for (const phase of phases) {
    const evidence = input.graph.evidence[phase];
    if (!evidence || evidence.inputHash !== queue.inputHash || !evidence.artifactRefs.length
      || evidence.artifactRefs.some(ref => !nonEmpty(ref))) film('graph', `production_graph_${phase}_evidence_invalid`);
  }
  if (!input.graph.completed || queue.status !== 'succeeded') film('graph', 'production_graph_not_terminal');
  if (!input.graph.approval?.approved || !nonEmpty(input.graph.approval.receiptRef)
    || !nonEmpty(input.graph.approval.subjectVersion) || !HASH.test(input.graph.approval.contentHash)) film('graph', 'canonical_human_approval_invalid');

  for (const gate of ['G4', 'G5'] as const) {
    const matches = input.qualityReceipts.filter(receipt => receipt.gate === gate && receipt.status === 'passed'
      && receipt.handoffId === input.handoff.handoffId && receipt.handoffVersion === input.handoff.version && receipt.evidenceRefs.length > 0);
    if (!matches.length || matches.some(receipt => !nonEmpty(receipt.handoffId))) film('quality', `${gate.toLowerCase()}_quality_receipt_missing`);
  }
  const passedG4Scenes = new Set(input.qualityReceipts.filter(receipt => receipt.gate === 'G4' && receipt.status === 'passed'
    && receipt.handoffId === input.handoff.handoffId && receipt.handoffVersion === input.handoff.version)
    .map(receipt => receipt.sceneId).filter(nonEmpty));
  if (input.handoff.shotTraces.some(trace => !passedG4Scenes.has(trace.sceneId))) film('quality', 'g4_scene_coverage_incomplete');

  const delivery = input.delivery;
  if (!nonEmpty(delivery.artifactId) || !['approved', 'completed'].includes(delivery.artifactStatus)
    || !HASH.test(delivery.mediaSha256)) film('delivery', 'finished_film_artifact_invalid');
  if (!nonEmpty(delivery.packageId) || !['ready', 'confirmed'].includes(delivery.packageStatus)
    || !HASH.test(delivery.packageHash) || delivery.artifactIds.length !== 1
    || delivery.artifactIds[0] !== delivery.artifactId) film('delivery', 'delivery_package_invalid');
  const deliveryRefs = input.graph.evidence.delivery?.artifactRefs ?? [];
  if (!deliveryRefs.includes(delivery.artifactId) || !deliveryRefs.includes(delivery.packageId)) film('delivery', 'graph_delivery_lineage_invalid');

  for (const capability of ['starter_workers', 'digital_human_quality'] as const) {
    const state = input.capabilities[capability];
    if (!state.ready) film('runtime', `capability_unavailable:${capability}:${state.reason || 'not_ready'}`);
  }
  const automaticRelease = input.capabilities.digital_human_auto_release;
  if (!automaticRelease.ready) film('runtime', `capability_unavailable:digital_human_auto_release:${automaticRelease.reason || 'not_ready'}`);
  const publishing = input.capabilities.scheduled_publishing;
  if (!publishing.ready) publication(`capability_unavailable:scheduled_publishing:${publishing.reason || 'not_ready'}`);
  const g6 = input.qualityReceipts.filter(receipt => receipt.gate === 'G6' && receipt.status === 'passed'
    && receipt.handoffId === input.handoff.handoffId && receipt.handoffVersion === input.handoff.version
    && receipt.evidenceRefs.length > 0);
  if (!g6.length) publication('g6_publication_preflight_receipt_missing');

  const filmIssues = issues.filter(issue => issue.blocking === 'film');
  const publicationIssues = issues.filter(issue => issue.blocking === 'automatic_publication');
  return {
    schemaVersion: 'weekly-agent-release-gate.v1' as const,
    readOnly: true as const,
    filmReady: filmIssues.length === 0,
    automaticPublicationReady: filmIssues.length === 0 && publicationIssues.length === 0,
    issues,
  };
}

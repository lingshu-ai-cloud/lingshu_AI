import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { inspectWeeklyAgentReleaseGate, type WeeklyAgentReleaseGateInput } from './weeklyAgentReleaseGate.js';

export type P3ProviderReceipt = {
  provider: string; requestId: string; providerTaskId: string; state: string;
  synthetic?: boolean; acceptedAt?: string; completedAt?: string; actualCostCny?: number;
};
export type P3AcceptanceRun = {
  runLabel: string; weeklyPlanId: string; productionPlanHash: string; graphThreadId: string;
  checkpointRefs: string[]; providerReceipts: P3ProviderReceipt[];
  mp4Path: string; mp4Sha256: string; humanApprovalReceipt: string; deliveryArtifactId: string;
  gate: WeeklyAgentReleaseGateInput;
  recovery?: { interrupted: true; resumedFromCheckpoint: string; priorAttempt: number; resumedAttempt: number; graphThreadId: string };
  sceneRework?: { sceneId: string; correctionHash: string; beforeSha256: string; afterSha256: string };
};
export type P3AcceptanceManifest = { schemaVersion: 'weekly-agent-p3-acceptance.v1'; createdAt: string; runs: P3AcceptanceRun[] };
export type P3AcceptanceIssue = { runLabel?: string; code: string };

const HASH = /^[a-f0-9]{64}$/;
const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

export async function verifyP3RealAcceptance(manifest: P3AcceptanceManifest) {
  const issues: P3AcceptanceIssue[] = [];
  if (manifest?.schemaVersion !== 'weekly-agent-p3-acceptance.v1' || !Array.isArray(manifest.runs)) {
    return { accepted: false, issues: [{ code: 'manifest_invalid' }] };
  }
  if (manifest.runs.length !== 3) issues.push({ code: 'exactly_three_runs_required' });
  const identities = new Set<string>();
  const receiptIdentities = new Set<string>();
  for (const run of manifest.runs) {
    const fail = (code: string) => issues.push({ runLabel: run.runLabel, code });
    const identity = `${run.weeklyPlanId}\0${run.graphThreadId}\0${run.productionPlanHash}`;
    if (![run.runLabel, run.weeklyPlanId, run.graphThreadId, run.humanApprovalReceipt, run.deliveryArtifactId].every(text)
      || !HASH.test(run.productionPlanHash)) fail('run_identity_invalid');
    if (identities.has(identity)) fail('run_identity_reused'); else identities.add(identity);
    if (!run.checkpointRefs?.length || run.checkpointRefs.some(ref => !text(ref))) fail('checkpoint_evidence_missing');
    if (!run.providerReceipts?.length || run.providerReceipts.some(receipt => {
      const acceptedAt=Date.parse(String(receipt.acceptedAt||'')),completedAt=Date.parse(String(receipt.completedAt||''));
      return receipt.synthetic === true || !text(receipt.provider) || !text(receipt.requestId) || !text(receipt.providerTaskId)
        || receipt.state !== 'completed' || !Number.isFinite(acceptedAt) || !Number.isFinite(completedAt) || acceptedAt > completedAt
        || typeof receipt.actualCostCny !== 'number' || !Number.isFinite(receipt.actualCostCny) || receipt.actualCostCny < 0;
    })) {
      fail('genuine_provider_completion_receipt_missing');
    }
    for (const receipt of run.providerReceipts ?? []) {
      const receiptIdentity=`${receipt.provider}\0${receipt.requestId}\0${receipt.providerTaskId}`;
      if(receiptIdentities.has(receiptIdentity)) fail('provider_receipt_reused_across_runs'); else receiptIdentities.add(receiptIdentity);
    }
    try {
      const bytes = await readFile(run.mp4Path);
      if (!bytes.length || !HASH.test(run.mp4Sha256) || hash(bytes) !== run.mp4Sha256) fail('mp4_hash_mismatch');
    } catch { fail('mp4_unreadable'); }
    const gate = inspectWeeklyAgentReleaseGate(run.gate);
    if (!gate.filmReady) for (const issue of gate.issues.filter(item => item.blocking === 'film')) fail(`release_gate:${issue.code}`);
    if (run.gate.weekly.runId !== run.gate.graph.identity.runId
      || run.gate.weekly.taskId !== run.gate.graph.identity.taskId
      || run.deliveryArtifactId !== run.gate.delivery.artifactId) fail('manifest_gate_identity_mismatch');
    if (run.humanApprovalReceipt !== run.gate.graph.approval?.receiptRef) fail('human_approval_receipt_mismatch');
    if (run.recovery && (!run.recovery.interrupted || run.recovery.graphThreadId !== run.graphThreadId
      || !run.checkpointRefs.includes(run.recovery.resumedFromCheckpoint)
      || run.recovery.priorAttempt < 1 || run.recovery.resumedAttempt !== run.recovery.priorAttempt + 1)) fail('recovery_evidence_invalid');
    if (run.sceneRework && (!text(run.sceneRework.sceneId) || !HASH.test(run.sceneRework.correctionHash)
      || !HASH.test(run.sceneRework.beforeSha256) || !HASH.test(run.sceneRework.afterSha256)
      || run.sceneRework.beforeSha256 === run.sceneRework.afterSha256
      || !run.gate.handoff.shotTraces.some(scene => scene.sceneId === run.sceneRework?.sceneId))) fail('scene_rework_evidence_invalid');
  }
  if (!manifest.runs.some(run => run.recovery)) issues.push({ code: 'interruption_recovery_run_required' });
  if (!manifest.runs.some(run => run.sceneRework)) issues.push({ code: 'single_scene_rework_run_required' });
  return { accepted: issues.length === 0, issues };
}

export function p3RuntimeConfigurationProbe(env: NodeJS.ProcessEnv, quality: { localVisual: {ready:boolean;reason?:string}; autoRelease:{ready:boolean;reason?:string} }) {
  const required=['STARTER_198_ORCHESTRATOR_WORKER_ENABLED','SOCIAL_WEEKLY_EXECUTION_WORKER_ENABLED','DASHSCOPE_API_KEY','QWEN_DIGITAL_HUMAN_QA_MODEL'];
  const checks=[...required.map(key=>{const ready=key.endsWith('_ENABLED')?env[key]==='true':Boolean(String(env[key]||'').trim());return{key,ready,reason:ready?null:'not_ready'};}),
    {key:'visual_qa',ready:quality.localVisual.ready,reason:quality.localVisual.reason??null},
    {key:'automatic_release',ready:quality.autoRelease.ready,reason:quality.autoRelease.reason??null}];
  return {schemaVersion:'weekly-agent-p3-probe.v1' as const,ready:checks.every(item=>item.ready),checks};
}

export function createP3LedgerEntry(manifest: P3AcceptanceManifest, previousHash: string | null) {
  const payload = { schemaVersion: 'weekly-agent-p3-ledger.v1', recordedAt: new Date().toISOString(), previousHash,
    manifestHash: hash(JSON.stringify(manifest)), runIds: manifest.runs.map(run => run.gate.weekly.runId) };
  return { ...payload, entryHash: hash(JSON.stringify(payload)) };
}

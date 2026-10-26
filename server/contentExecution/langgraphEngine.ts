import { Annotation, StateGraph, START, END, interrupt, Command } from '@langchain/langgraph';
import { AsyncLocalStorage } from 'node:async_hooks';
import { AsyncLocalStorageProviderSingleton } from 'langsmith/singletons/traceable';
import { withRunTree } from 'langsmith/traceable';
import { RunTree } from 'langsmith/run_trees';
import { LocalOnlyContentGraphCallbacks } from './langgraphTracing.js';
import { createHash } from 'node:crypto';
import {
  assertCurrentContentExecutionJobContext,
  currentContentProviderReceipts,
  readCurrentContentExecutionCheckpoint,
  recordCurrentContentExecutionCheckpoint,
} from './context.js';
import type { DataStore } from '../storage/datastore.js';
import { ContentJobCheckpointSaver, createJobGraphCheckpointPort, type ContentGraphCheckpointPort } from './langgraphCheckpoint.js';
import { assertGraphJobScope, BACKGROUND_FIRST_GRAPH_VERSION, CONTENT_GRAPH_VERSION, graphIdentityHash, graphThreadId, LEGACY_CONTENT_GRAPH_VERSION, type ProductionGraphIdentity } from './langgraphIdentity.js';
import {
  assertVideoProductionSupervisorDefinition,
  type VideoProductionGraphPhase,
} from '../../shared/contracts/videoProductionSupervisor.js';

export interface PhaseEvidence {
  artifactRefs: string[];
  inputHash: string;
  metadata?: Record<string, unknown>;
}
export type ProductionGraphNodeEvidence = {
  node: ProductionGraphPhase;
  nodeVersion: string;
  graphVersion: string;
  planVersion: string;
  inputHash: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  status: 'running' | 'completed' | 'failed';
  attempt: number;
  failureCode: string | null;
  failureReason: string | null;
  outputSha256: string | null;
  providerReceiptRefs: string[];
  reservedCny: number | null;
  actualCostCny: number | null;
  phaseContractVersion: string;
  predecessorEvidenceSha256: string;
  nodeIdentityHash: string;
};
export interface ProductionGraphNodeChainIdentity {
  phaseContractVersion: string;
  predecessorEvidenceSha256: string;
  nodeIdentityHash: string;
}
const LEGACY_NODE_EVIDENCE_VERSION = '2';
const PHASE_SCOPED_NODE_EVIDENCE_VERSION = '3';
export interface GraphApproval {
  approved: boolean;
  receiptRef: string;
  subjectVersion: string;
  contentHash: string;
}
export type ProductionGraphPhase = VideoProductionGraphPhase;
const GraphState = Annotation.Root({
  identity: Annotation<ProductionGraphIdentity>(),
  evidence: Annotation<Partial<Record<ProductionGraphPhase, PhaseEvidence>>>({ reducer: (prior,next) => ({...prior,...next}), default: () => ({}) }),
  nodeChain: Annotation<Partial<Record<ProductionGraphPhase, ProductionGraphNodeChainIdentity>>>({ reducer: (prior,next) => ({...prior,...next}), default: () => ({}) }),
  approval: Annotation<GraphApproval | null>({ reducer: (_prior,next) => next, default: () => null }),
  completed: Annotation<boolean>({ reducer: (_prior,next)=>next, default:()=>false }),
});
export type ProductionGraphState = typeof GraphState.State;
export interface LangGraphProductionInput {
  identity: ProductionGraphIdentity;
  dataStore: DataStore;
  /** The durable worker must verify its current attempt/owner/lease before new work. */
  assertActive: () => Promise<void>;
  phases: Partial<Record<ProductionGraphPhase, (state: ProductionGraphState) => Promise<PhaseEvidence>>>;
  /** Bump the affected phase when its input/output policy changes without a graph topology change. */
  phaseContractVersions?: Partial<Record<ProductionGraphPhase, string>>;
  /** Production callers provide a read-only strict reader for canonical domain
   * checkpoints. It must throw when restored evidence no longer identifies the
   * authoritative artifact; isolated graph tests may omit it. */
  validateRestoredPhaseEvidence?(phase: ProductionGraphPhase, restored: PhaseEvidence,
    state: ProductionGraphState): Promise<void>;
  review: {
    /** Must reload canonical business approval with tenant, artifact hash and version checks. */
    loadApproval: (state: ProductionGraphState) => Promise<GraphApproval | null>;
    /** A client-supplied boolean cannot resume. This callback validates stored receipt authority. */
    verifyResume: (resume: unknown, identity: ProductionGraphIdentity) => Promise<boolean>;
  };
  resume?: unknown;
  /** Server-owned correction authorization hash; preserves the original graph history. */
  correctionHash?: string;
  /** Isolated tests may supply an independent durable port; production uses job context. */
  checkpointPort?: ContentGraphCheckpointPort;
}
export interface LangGraphProductionResult {
  status: 'waiting_review' | 'completed';
  state: ProductionGraphState;
  interrupts: unknown[];
}
function evidence(value: PhaseEvidence): PhaseEvidence {
  if (!value || !Array.isArray(value.artifactRefs) || value.artifactRefs.length > 100
    || value.artifactRefs.some(ref => typeof ref !== 'string' || !ref || ref.length > 512 || /^(?:\/|[a-z]:\\)/i.test(ref))
    || typeof value.inputHash !== 'string' || !value.inputHash || value.inputHash.length > 240) {
    throw new Error('content_graph_phase_evidence_invalid');
  }
  // Only compact business projections enter graph state; full provider results,
  // prompts, credentials and filesystem paths remain in their existing stores.
  const allowedMetadata = new Set(['contentHash','checkpointStage','approvalReceipt','externalPublishPerformed',
    'artifactId','packageId','sceneCount','durationSeconds','qualityPassed','outputSha256','providerReceiptRefs',
    'reservedCny','actualCostCny']);
  if (value.metadata && Object.entries(value.metadata).some(([key,item]) => !allowedMetadata.has(key)
    || key === 'outputSha256' && (typeof item !== 'string' || !/^[a-f0-9]{64}$/.test(item))
    || ['reservedCny','actualCostCny'].includes(key) && (typeof item !== 'number' || !Number.isFinite(item) || item < 0)
    || !(typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)
      || typeof item === 'string' && item.length <= 512 && !/^(?:\/|[a-z]:\\)/i.test(item)
      || key === 'providerReceiptRefs' && Array.isArray(item) && item.length <= 100
        && item.every(ref=>typeof ref === 'string' && ref.length <= 512 && !ref.startsWith('/'))))) {
    throw new Error('content_graph_phase_metadata_invalid');
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > 32_768) throw new Error('content_graph_phase_evidence_too_large');
  return JSON.parse(serialized) as PhaseEvidence;
}

const ZERO_SHA256 = '0'.repeat(64);
function phaseContractVersion(input: LangGraphProductionInput, phase: ProductionGraphPhase): string {
  const value = input.phaseContractVersions?.[phase] ?? `${input.identity.graphVersion}.${phase}.contract.v1`;
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 160) {
    throw new Error(`content_graph_phase_contract_version_invalid:${phase}`);
  }
  return value;
}
function nodeEvidenceVersion(graphVersion: ProductionGraphIdentity['graphVersion']): string {
  return graphVersion === BACKGROUND_FIRST_GRAPH_VERSION
    ? PHASE_SCOPED_NODE_EVIDENCE_VERSION
    : LEGACY_NODE_EVIDENCE_VERSION;
}
function phaseScopedNodeEvidence(graphVersion: ProductionGraphIdentity['graphVersion']): boolean {
  return graphVersion === BACKGROUND_FIRST_GRAPH_VERSION;
}
function receiptRef(value: { provider: string; requestId: string }): string {
  return `${value.provider}:${value.requestId}`;
}
function safeReceiptRefs(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string'
    && item.length > 0 && item.length <= 512 && !item.startsWith('/')))].sort() : [];
}
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]));
  return value;
}
function directPredecessors(graphVersion: ProductionGraphIdentity['graphVersion'], phase: ProductionGraphPhase): ProductionGraphPhase[] {
  const legacy: Partial<Record<ProductionGraphPhase, ProductionGraphPhase[]>> = {
    assets: [], render: ['assets'], quality: ['render'], delivery: ['quality'],
  };
  const previous: Partial<Record<ProductionGraphPhase, ProductionGraphPhase[]>> = {
    assets: [], voice: ['assets'], trim: ['voice'], effects: ['trim'], render: ['effects'],
    technical_quality: ['render'], creative_quality: ['technical_quality'], delivery: ['creative_quality'],
  };
  // Review authority is carried separately in state. Handoff therefore binds
  // both that approval (in its handler) and the last media evidence here.
  const backgroundFirst: Partial<Record<ProductionGraphPhase, ProductionGraphPhase[]>> = {
    source_assets: [], voice: ['source_assets'], presenter_assets: ['voice'], trim: ['presenter_assets'],
    effects: ['trim'], render: ['effects'], technical_quality: ['render'],
    creative_quality: ['technical_quality'], handoff: ['creative_quality'], delivery: ['handoff'],
  };
  return [...((graphVersion === LEGACY_CONTENT_GRAPH_VERSION ? legacy
    : graphVersion === BACKGROUND_FIRST_GRAPH_VERSION ? backgroundFirst : previous)[phase] ?? [])];
}
export function productionGraphNodeChainIdentity(input: Pick<LangGraphProductionInput, 'identity' | 'phaseContractVersions'>,
  phase: ProductionGraphPhase, stateEvidence: Partial<Record<ProductionGraphPhase, PhaseEvidence>>): ProductionGraphNodeChainIdentity {
  const predecessors = directPredecessors(input.identity.graphVersion, phase);
  const predecessorEvidence = predecessors.map(node => {
    const value = stateEvidence[node];
    if (!value) throw new Error(`content_graph_predecessor_evidence_missing:${phase}:${node}`);
    return [node, evidence(value)] as const;
  });
  const predecessorEvidenceSha256 = predecessors.length ? createHash('sha256')
    .update(JSON.stringify(stableValue(predecessorEvidence))).digest('hex') : ZERO_SHA256;
  const contract = phaseContractVersion(input as LangGraphProductionInput, phase);
  return {
    phaseContractVersion: contract,
    predecessorEvidenceSha256,
    nodeIdentityHash: createHash('sha256').update(JSON.stringify([
      graphIdentityHash(input.identity), phase, contract, predecessorEvidenceSha256,
    ])).digest('hex'),
  };
}

async function assertRestoredNodeChain(input: LangGraphProductionInput, state: ProductionGraphState): Promise<void> {
  const completedPhases = Object.keys(state.evidence ?? {}) as ProductionGraphPhase[];
  if (!completedPhases.length) return;
  const allowLegacySnapshot = input.identity.graphVersion !== CONTENT_GRAPH_VERSION
    && completedPhases.every(phase => !state.nodeChain?.[phase]);
  for (const phase of completedPhases) {
    const stored = state.nodeChain?.[phase];
    if (!allowLegacySnapshot) {
      if (!stored) throw new Error(`content_graph_node_chain_identity_missing:${phase}`);
      const expected = productionGraphNodeChainIdentity(input, phase, state.evidence);
      if (JSON.stringify(stored) !== JSON.stringify(expected)) {
        throw new Error(`content_graph_node_chain_identity_changed:${phase}`);
      }
    }
    await input.validateRestoredPhaseEvidence?.(phase, evidence(state.evidence[phase]!), state);
  }
}
/** Actual graph nodes call separately recoverable stages; no provider retry loop is added here. */
export async function runLangGraphProduction(input: LangGraphProductionInput): Promise<LangGraphProductionResult> {
  const identityHash = graphIdentityHash(input.identity);
  if(input.correctionHash && !/^[a-f0-9]{64}$/.test(input.correctionHash)) throw Error('content_graph_correction_identity_invalid');
  if (!input.checkpointPort) await assertCurrentContentExecutionJobContext(input.identity.jobId);
  await assertGraphJobScope(input.dataStore, input.identity);
  await input.assertActive();
  const checkpointer = new ContentJobCheckpointSaver(input.identity, input.checkpointPort ?? createJobGraphCheckpointPort(input));
  const active = async (state: ProductionGraphState) => {
    if (graphIdentityHash(state.identity) !== identityHash) throw new Error('content_graph_state_identity_changed');
    await assertGraphJobScope(input.dataStore, input.identity);
    await input.assertActive();
  };
  const phase = (name: ProductionGraphPhase) => async (state: ProductionGraphState) => {
    await active(state);
    const chainIdentity = productionGraphNodeChainIdentity(input, name, state.evidence);
    const nodeInputHash = chainIdentity.nodeIdentityHash;
    const stage = input.correctionHash?`lg.fix.${input.correctionHash}.${name}`:`langgraph.node.${name}`;
    const evidenceVersion = nodeEvidenceVersion(input.identity.graphVersion);
    const currentEvidence = readCurrentContentExecutionCheckpoint<ProductionGraphNodeEvidence>({
      stage, version: evidenceVersion, inputHash: nodeInputHash,
    });
    // v4 briefly wrote the legacy v2 aggregate evidence during rollout. Read
    // it only as retry/timestamp history; its cumulative receipt list is never
    // copied into the phase-scoped v3 evidence.
    const legacyV4Evidence = phaseScopedNodeEvidence(input.identity.graphVersion)
      && !currentEvidence ? readCurrentContentExecutionCheckpoint<ProductionGraphNodeEvidence>({
        stage, version: LEGACY_NODE_EVIDENCE_VERSION, inputHash: nodeInputHash,
      }) : null;
    const previous = currentEvidence ?? legacyV4Evidence;
    const attempt = Math.max(0, Number(previous?.attempt) || 0) + 1;
    const startedAt = new Date().toISOString();
    const phaseScopedReceipts = phaseScopedNodeEvidence(input.identity.graphVersion);
    const receiptsAtStart = new Set(currentContentProviderReceipts().map(receiptRef));
    // If a worker stopped after an accepted submission, carry both the v3
    // checkpoint refs and receipts first recorded after that attempt started.
    // The timestamp fallback covers a hard stop before the failed checkpoint
    // could be written, while excluding receipts owned by earlier phases.
    const previousStartedAt = previous && Number.isFinite(Date.parse(previous.startedAt))
      ? Date.parse(previous.startedAt) : null;
    const recoveredAttemptReceiptRefs = phaseScopedReceipts && previousStartedAt !== null
      ? currentContentProviderReceipts().filter(row => Number.isFinite(Date.parse(row.firstRecordedAt))
        && Date.parse(row.firstRecordedAt) >= previousStartedAt).map(receiptRef)
      : [];
    const carriedReceiptRefs = phaseScopedReceipts
      ? safeReceiptRefs([...safeReceiptRefs(currentEvidence?.providerReceiptRefs), ...recoveredAttemptReceiptRefs]) : [];
    const receiptEvidence = (explicitRefs: unknown = []) => {
      const receipts = currentContentProviderReceipts();
      const refs = phaseScopedReceipts
        ? new Set([...carriedReceiptRefs, ...receipts.filter(row => !receiptsAtStart.has(receiptRef(row))).map(receiptRef),
          ...safeReceiptRefs(explicitRefs)])
        : new Set([...receipts.map(receiptRef), ...safeReceiptRefs(explicitRefs)]);
      const ownedReceipts = phaseScopedReceipts ? receipts.filter(row => refs.has(receiptRef(row))) : receipts;
      const amount = (key: 'reservedCny' | 'actualCostCny') => {
        const values = ownedReceipts.map(row => Number(row.metadata[key])).filter(value => Number.isFinite(value) && value >= 0);
        return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
      };
      return {
        providerReceiptRefs: [...refs].sort(),
        reservedCny: amount('reservedCny'), actualCostCny: amount('actualCostCny'),
      };
    };
    const base = (): ProductionGraphNodeEvidence => ({
      node: name, nodeVersion: evidenceVersion, graphVersion: input.identity.graphVersion,
      planVersion: input.identity.planVersion, inputHash: input.identity.inputHash,
      startedAt, endedAt: null, durationMs: null, status: 'running', attempt,
      failureCode: null, failureReason: null, outputSha256: null, ...receiptEvidence(),
      ...chainIdentity,
    });
    await recordCurrentContentExecutionCheckpoint({ stage, version: evidenceVersion,
      inputHash: nodeInputHash, payload: base() });
    try {
      const handler = input.phases[name];
      if (!handler) throw new Error(`content_graph_phase_handler_missing:${name}`);
      const result = evidence(await handler(state));
      await active(state);
      const endedAt = new Date().toISOString();
      const ownedReceipts = receiptEvidence(result.metadata?.providerReceiptRefs);
      const completed: ProductionGraphNodeEvidence = {
        ...base(), ...ownedReceipts, endedAt,
        durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)), status: 'completed',
        outputSha256: typeof result.metadata?.outputSha256 === 'string' ? result.metadata.outputSha256 : null,
        reservedCny: typeof result.metadata?.reservedCny === 'number' ? result.metadata.reservedCny : ownedReceipts.reservedCny,
        actualCostCny: typeof result.metadata?.actualCostCny === 'number' ? result.metadata.actualCostCny : ownedReceipts.actualCostCny,
      };
      await recordCurrentContentExecutionCheckpoint({ stage, version: evidenceVersion,
        inputHash: nodeInputHash, payload: completed });
      return { evidence: { [name]: result }, nodeChain: { [name]: chainIdentity },
        ...(name === 'delivery' ? { completed: true } : {}) };
    } catch (error) {
      const endedAt = new Date().toISOString();
      const reason = String(error instanceof Error ? error.message : error || 'content_graph_node_failed').slice(0, 2000);
      const explicitCode = error && typeof error === 'object' && typeof (error as {code?:unknown}).code === 'string'
        ? String((error as {code:string}).code) : reason.split(':', 1)[0] || '';
      const failureCode = explicitCode.trim().slice(0, 120).replace(/[^a-zA-Z0-9_.-]+/g, '_') || 'content_graph_node_failed';
      await recordCurrentContentExecutionCheckpoint({ stage, version: evidenceVersion,
        inputHash: nodeInputHash, payload: { ...base(), ...receiptEvidence(), endedAt,
          durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)), status: 'failed',
          failureCode, failureReason: reason } satisfies ProductionGraphNodeEvidence });
      throw error;
    }
  };
  // withRunTree uses a no-op ALS until LangSmith is initialized. Initialize its
  // public singleton with a real Node ALS so tracing=false reaches core callbacks.
  AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new AsyncLocalStorage<ReturnType<Parameters<typeof AsyncLocalStorageProviderSingleton.initializeGlobalInstance>[0]['getStore']>>());
  // Explicitly scoped tracing=false overrides LANGSMITH_TRACING and any inherited
  // tracer without mutating process-wide environment or exposing business state.
  return withRunTree(new RunTree({ name: 'content-production-local', tracingEnabled: false }), async (): Promise<LangGraphProductionResult> => {
    const reviewNode = async (state: ProductionGraphState) => {
      await active(state);
      let receipt = await input.review.loadApproval(state);
      if (!receipt?.approved) {
        interrupt({ kind: 'content_review', tenantId: input.identity.tenantId, taskId: input.identity.taskId,
          runId: input.identity.runId, planVersion: input.identity.planVersion, inputHash: input.identity.inputHash,
          artifacts: state.evidence.creative_quality?.artifactRefs ?? state.evidence.quality?.artifactRefs ?? [] });
        // interrupt resumes by restarting this node. Always read authority again;
        // the resume payload is never used as an approval or a business result.
        receipt = await input.review.loadApproval(state);
      }
      if (!receipt?.approved || !receipt.receiptRef || !receipt.contentHash || !receipt.subjectVersion) {
        throw new Error('content_graph_review_receipt_required');
      }
      return { approval: receipt };
    };
    const deliveryNode = async (state: ProductionGraphState) => {
      await active(state);
      const receipt = await input.review.loadApproval(state);
      if (!receipt?.approved || receipt.receiptRef !== state.approval?.receiptRef
        || receipt.subjectVersion !== state.approval.subjectVersion || receipt.contentHash !== state.approval.contentHash) {
        throw new Error('content_graph_review_changed');
      }
      return phase('delivery')(state);
    };
    const handoffNode = async (state: ProductionGraphState) => {
      await active(state);
      const receipt = await input.review.loadApproval(state);
      if (!receipt?.approved || receipt.receiptRef !== state.approval?.receiptRef
        || receipt.subjectVersion !== state.approval.subjectVersion || receipt.contentHash !== state.approval.contentHash) {
        throw new Error('content_graph_review_changed');
      }
      return phase('handoff')(state);
    };
    const graph: any = input.identity.graphVersion === LEGACY_CONTENT_GRAPH_VERSION
      ? new StateGraph(GraphState)
        .addNode('assets',phase('assets')).addNode('render',phase('render')).addNode('quality',phase('quality'))
        .addNode('review',reviewNode).addNode('delivery',deliveryNode)
        .addEdge(START,'assets').addEdge('assets','render').addEdge('render','quality').addEdge('quality','review')
        .addEdge('review','delivery').addEdge('delivery',END).compile({checkpointer})
      : input.identity.graphVersion === BACKGROUND_FIRST_GRAPH_VERSION
        ? (() => {
          assertVideoProductionSupervisorDefinition();
          return new StateGraph(GraphState)
            .addNode('source_assets',phase('source_assets')).addNode('voice',phase('voice'))
            .addNode('presenter_assets',phase('presenter_assets')).addNode('trim',phase('trim'))
            .addNode('effects',phase('effects')).addNode('render',phase('render'))
            .addNode('technical_quality',phase('technical_quality')).addNode('creative_quality',phase('creative_quality'))
            .addNode('review',reviewNode).addNode('handoff',handoffNode).addNode('delivery',deliveryNode)
            .addEdge(START,'source_assets').addEdge('source_assets','voice').addEdge('voice','presenter_assets')
            .addEdge('presenter_assets','trim').addEdge('trim','effects').addEdge('effects','render')
            .addEdge('render','technical_quality').addEdge('technical_quality','creative_quality')
            .addEdge('creative_quality','review').addEdge('review','handoff').addEdge('handoff','delivery')
            .addEdge('delivery',END).compile({checkpointer});
        })()
      : (() => {
        assertVideoProductionSupervisorDefinition();
        return new StateGraph(GraphState)
          .addNode('assets',phase('assets')).addNode('voice',phase('voice')).addNode('trim',phase('trim'))
          .addNode('effects',phase('effects')).addNode('render',phase('render'))
          .addNode('technical_quality',phase('technical_quality')).addNode('creative_quality',phase('creative_quality'))
          .addNode('review',reviewNode).addNode('delivery',deliveryNode)
          .addEdge(START,'assets').addEdge('assets','voice').addEdge('voice','trim').addEdge('trim','effects')
          .addEdge('effects','render').addEdge('render','technical_quality').addEdge('technical_quality','creative_quality')
          .addEdge('creative_quality','review').addEdge('review','delivery').addEdge('delivery',END).compile({checkpointer});
      })();
    const config = { configurable: { thread_id: graphThreadId(input.identity) }, callbacks: [new LocalOnlyContentGraphCallbacks()], recursionLimit: 32, durability: 'sync' as const };
    const previous = await checkpointer.getTuple(config);
    if (previous) {
      const restored = await graph.getState(config);
      if (restored.values.identity && graphIdentityHash(restored.values.identity as ProductionGraphIdentity) !== identityHash) {
        throw new Error('content_graph_restored_identity_changed');
      }
    }
    const priorSnapshot = previous ? await graph.getState(config) : null;
    if (priorSnapshot) await assertRestoredNodeChain(input, priorSnapshot.values as ProductionGraphState);
    if (input.resume !== undefined && (!previous || !await input.review.verifyResume(input.resume, input.identity))) {
      throw new Error('content_graph_resume_not_authorized');
    }
    if (priorSnapshot?.values.completed && !priorSnapshot.next.length) {
      const restored = priorSnapshot.values as ProductionGraphState;
      const receipt = await input.review.loadApproval(restored);
      if (!receipt?.approved || receipt.receiptRef !== restored.approval?.receiptRef || receipt.contentHash !== restored.approval.contentHash
        || receipt.subjectVersion !== restored.approval.subjectVersion) throw new Error('content_graph_review_changed');
      return {status:'completed',state:restored,interrupts:[]};
    }
    const resumeInterrupt = input.resume !== undefined && priorSnapshot?.tasks.some((task: {interrupts?: unknown[]})=>task.interrupts?.length);
    await graph.invoke(resumeInterrupt ? new Command({resume: input.resume})
      : previous ? null : { identity: input.identity, evidence: {}, nodeChain: {}, approval: null, completed: false }, config);
    const snapshot = await graph.getState(config);
    const state = snapshot.values as ProductionGraphState;
    const interrupts = snapshot.tasks.flatMap((task: {interrupts?: unknown[]}) => task.interrupts ?? []);
    if (snapshot.next.length || interrupts.length || !state.completed) return {status:'waiting_review',state,interrupts};
    return {status:'completed',state,interrupts:[]};
  });
}

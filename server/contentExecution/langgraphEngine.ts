import { Annotation, StateGraph, START, END, interrupt, Command } from '@langchain/langgraph';
import { AsyncLocalStorage } from 'node:async_hooks';
import { AsyncLocalStorageProviderSingleton } from 'langsmith/singletons/traceable';
import { withRunTree } from 'langsmith/traceable';
import { RunTree } from 'langsmith/run_trees';
import { LocalOnlyContentGraphCallbacks } from './langgraphTracing.js';
import { assertCurrentContentExecutionJobContext } from './context.js';
import type { DataStore } from '../storage/datastore.js';
import { ContentJobCheckpointSaver, createJobGraphCheckpointPort, type ContentGraphCheckpointPort } from './langgraphCheckpoint.js';
import { assertGraphJobScope, graphIdentityHash, graphThreadId, type ProductionGraphIdentity } from './langgraphIdentity.js';

export interface PhaseEvidence {
  artifactRefs: string[];
  inputHash: string;
  metadata?: Record<string, unknown>;
}
export interface GraphApproval {
  approved: boolean;
  receiptRef: string;
  subjectVersion: string;
  contentHash: string;
}
export type ProductionGraphPhase = 'assets' | 'render' | 'quality' | 'delivery';
const GraphState = Annotation.Root({
  identity: Annotation<ProductionGraphIdentity>(),
  evidence: Annotation<Partial<Record<ProductionGraphPhase, PhaseEvidence>>>({ reducer: (prior,next) => ({...prior,...next}), default: () => ({}) }),
  approval: Annotation<GraphApproval | null>({ reducer: (_prior,next) => next, default: () => null }),
  completed: Annotation<boolean>({ reducer: (_prior,next)=>next, default:()=>false }),
});
export type ProductionGraphState = typeof GraphState.State;
export interface LangGraphProductionInput {
  identity: ProductionGraphIdentity;
  dataStore: DataStore;
  /** The durable worker must verify its current attempt/owner/lease before new work. */
  assertActive: () => Promise<void>;
  phases: Record<ProductionGraphPhase, (state: ProductionGraphState) => Promise<PhaseEvidence>>;
  review: {
    /** Must reload canonical business approval with tenant, artifact hash and version checks. */
    loadApproval: (state: ProductionGraphState) => Promise<GraphApproval | null>;
    /** A client-supplied boolean cannot resume. This callback validates stored receipt authority. */
    verifyResume: (resume: unknown, identity: ProductionGraphIdentity) => Promise<boolean>;
  };
  resume?: unknown;
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
    'artifactId','packageId','sceneCount','durationSeconds','qualityPassed','outputSha256','providerReceiptRefs']);
  if (value.metadata && Object.entries(value.metadata).some(([key,item]) => !allowedMetadata.has(key)
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
/** Actual graph nodes call separately recoverable stages; no provider retry loop is added here. */
export async function runLangGraphProduction(input: LangGraphProductionInput): Promise<LangGraphProductionResult> {
  const identityHash = graphIdentityHash(input.identity);
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
    const result = evidence(await input.phases[name](state));
    await active(state);
    return { evidence: { [name]: result }, ...(name === 'delivery' ? { completed: true } : {}) };
  };
  // withRunTree uses a no-op ALS until LangSmith is initialized. Initialize its
  // public singleton with a real Node ALS so tracing=false reaches core callbacks.
  AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new AsyncLocalStorage<ReturnType<Parameters<typeof AsyncLocalStorageProviderSingleton.initializeGlobalInstance>[0]['getStore']>>());
  // Explicitly scoped tracing=false overrides LANGSMITH_TRACING and any inherited
  // tracer without mutating process-wide environment or exposing business state.
  return withRunTree(new RunTree({ name: 'content-production-local', tracingEnabled: false }), async (): Promise<LangGraphProductionResult> => {
    const graph = new StateGraph(GraphState)
      .addNode('assets', phase('assets'))
      .addNode('render', phase('render'))
      .addNode('quality', phase('quality'))
      .addNode('review', async state => {
        await active(state);
        let receipt = await input.review.loadApproval(state);
        if (!receipt?.approved) {
          interrupt({ kind: 'content_review', tenantId: input.identity.tenantId, taskId: input.identity.taskId,
            runId: input.identity.runId, planVersion: input.identity.planVersion, inputHash: input.identity.inputHash,
            artifacts: state.evidence.quality?.artifactRefs ?? [] });
          // interrupt resumes by restarting this node. Always read authority again;
          // the resume payload is never used as an approval or a business result.
          receipt = await input.review.loadApproval(state);
        }
        if (!receipt?.approved || !receipt.receiptRef || !receipt.contentHash || !receipt.subjectVersion) {
          throw new Error('content_graph_review_receipt_required');
        }
        return { approval: receipt };
      })
      .addNode('delivery', async state => {
        await active(state);
        const receipt = await input.review.loadApproval(state);
        if (!receipt?.approved || receipt.receiptRef !== state.approval?.receiptRef
          || receipt.subjectVersion !== state.approval.subjectVersion || receipt.contentHash !== state.approval.contentHash) {
          throw new Error('content_graph_review_changed');
        }
        return phase('delivery')(state);
      })
      .addEdge(START,'assets').addEdge('assets','render').addEdge('render','quality')
      .addEdge('quality','review').addEdge('review','delivery').addEdge('delivery',END)
      .compile({ checkpointer });
    const config = { configurable: { thread_id: graphThreadId(input.identity) }, callbacks: [new LocalOnlyContentGraphCallbacks()], recursionLimit: 20, durability: 'sync' as const };
    const previous = await checkpointer.getTuple(config);
    if (previous) {
      const restored = await graph.getState(config);
      if (restored.values.identity && graphIdentityHash(restored.values.identity as ProductionGraphIdentity) !== identityHash) {
        throw new Error('content_graph_restored_identity_changed');
      }
    }
    const priorSnapshot = previous ? await graph.getState(config) : null;
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
    const resumeInterrupt = input.resume !== undefined && priorSnapshot?.tasks.some(task=>task.interrupts?.length);
    await graph.invoke(resumeInterrupt ? new Command({resume: input.resume})
      : previous ? null : { identity: input.identity, evidence: {}, approval: null, completed: false }, config);
    const snapshot = await graph.getState(config);
    const state = snapshot.values as ProductionGraphState;
    const interrupts = snapshot.tasks.flatMap(task => task.interrupts ?? []);
    if (snapshot.next.length || interrupts.length || !state.completed) return {status:'waiting_review',state,interrupts};
    return {status:'completed',state,interrupts:[]};
  });
}

import { appendFileSync } from 'node:fs';
import { LangGraphTestStore } from './langgraphTestStore.js';
import { CONTENT_GRAPH_VERSION } from '../server/contentExecution/langgraphIdentity.js';
import { assertCurrentContentExecutionActive, currentContentProviderReceipt, recordCurrentContentProviderReceipt, runWithContentExecutionContext } from '../server/contentExecution/context.js';

const [filename, mode, log] = process.argv.slice(2);
const store = new LangGraphTestStore(filename!);
const identity = { tenantId: 'tenant-a', taskId: 'task-a', runId: 'run-a', jobId: 'job-a', planVersion: '1', inputHash: 'frozen-plan-hash', graphVersion: CONTENT_GRAPH_VERSION };
const job = await store.getById<Record<string, unknown>>('content_execution_jobs', identity.jobId);
if (!job) throw Error('missing fixture job');
let telemetry = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => { telemetry++; const target = args[0] instanceof Request ? args[0].url : String(args[0]); process.stderr.write(`blocked-network:${new URL(target).origin}\n${new Error('network trace').stack}\n`); throw Error('Unexpected network'); };
try {
  const { runLangGraphProduction } = await import('../server/contentExecution/langgraphEngine.js');
  const result = await runWithContentExecutionContext({ dataStore: store, jobId: identity.jobId, checkpoints: job.checkpoints, providerReceipts: job.provider_receipts,
    action: () => runLangGraphProduction({ identity, dataStore: store, assertActive: assertCurrentContentExecutionActive,
      phases: {
        assets: async () => {
          const receipt = currentContentProviderReceipt({ provider: 'controlled-local', requestId: 'shot-a' });
          if (!receipt) {
            appendFileSync(log!, 'provider-submit\n');
            await recordCurrentContentProviderReceipt({ provider: 'controlled-local', requestId: 'shot-a', state: 'accepted', providerTaskId: 'provider-task-a', metadata: { source: 'controlled-no-network' } });
            if (mode === 'crash') process.exit(73);
          }
          await recordCurrentContentProviderReceipt({ provider: 'controlled-local', requestId: 'shot-a', state: 'completed', providerTaskId: 'provider-task-a', metadata: { materialId: 'material-a' } });
          appendFileSync(log!, 'assets\n'); return { artifactRefs: ['material:material-a'], inputHash: identity.inputHash };
        },
        voice: async () => { appendFileSync(log!, 'voice\n'); return { artifactRefs: ['voice:audio-a'], inputHash: identity.inputHash }; },
        trim: async () => { appendFileSync(log!, 'trim\n'); return { artifactRefs: ['trim:timeline-a'], inputHash: identity.inputHash }; },
        effects: async () => { appendFileSync(log!, 'effects\n'); return { artifactRefs: ['effects:plan-a'], inputHash: identity.inputHash }; },
        render: async () => { appendFileSync(log!, 'render\n'); return { artifactRefs: ['render:video-a'], inputHash: identity.inputHash }; },
        technical_quality: async () => { appendFileSync(log!, 'technical_quality\n'); return { artifactRefs: ['quality:technical-a'], inputHash: identity.inputHash }; },
        creative_quality: async () => { appendFileSync(log!, 'creative_quality\n'); return { artifactRefs: ['artifact:artifact-a'], inputHash: identity.inputHash }; },
        delivery: async () => { appendFileSync(log!, 'delivery\n'); return { artifactRefs: ['delivery:package-a'], inputHash: identity.inputHash }; },
      },
      review: {
        loadApproval: async () => {
          const approval = await store.getById<Record<string, unknown>>('test_approval', 'approval-a');
          return approval?.tenant_id === identity.tenantId && approval.plan_version === identity.planVersion && approval.content_hash === 'artifact-hash-a' && approval.status === 'approved'
            ? { approved: true, receiptRef: 'approval:approval-a', subjectVersion: '2', contentHash: 'artifact-hash-a' } : null;
        },
        verifyResume: async resume => resume === 'approval:approval-a',
      },
      ...(mode === 'resume' ? { resume: 'approval:approval-a' } : {}),
    }),
  });
  process.stdout.write(JSON.stringify({ status: result.status, telemetry, checkpointsPresent: !!(await store.getById<Record<string, unknown>>('content_execution_jobs', identity.jobId))?.checkpoints }));
} finally { globalThis.fetch = originalFetch; }

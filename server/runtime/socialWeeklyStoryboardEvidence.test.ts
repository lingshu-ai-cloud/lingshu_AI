import assert from 'node:assert/strict';
import test from 'node:test';
import { SOCIAL_SCRIPT_BASELINE_SCHEMA, SOCIAL_SCRIPT_GROUNDING_VERSION, type StoredSocialScriptBaseline } from '../starter198/socialContentScriptBaseline.js';
import { buildSocialDirectorPlan } from '../starter198/socialContentDirectorPlan.js';
import { buildSocialProductionPlan } from '../starter198/socialContentProductionPlan.js';
import { weeklyStoryboardEvidence } from './socialWeeklyStoryboardEvidence.js';
import { validateWeeklyExecutionResults } from './socialWeeklyResultValidation.js';
import type { DataStore } from '../storage/datastore.js';
import type { WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';

test('real locked storyboard verifies before rendering and rejects stale script, unrelated references and tampering', async () => {
  const baseline = { schemaVersion: SOCIAL_SCRIPT_BASELINE_SCHEMA, version: '2', source: 'inspiration_script', language: 'zh', lockedAt: '2026-10-01T00:00:00Z', createdBeforeMaterialAdaptation: true, groundingVersion: SOCIAL_SCRIPT_GROUNDING_VERSION,
    match: { strategy: 'inspiration', confidence: 0.9, inspirationReference: { recordId: 'candidate', confidence: 0.9 }, verifiedKnowledgeSource: 'enterprise_profile', verifiedFactKeys: ['fact'], userTextUsage: 'intent_only' },
    scenes: ['产品全貌', '产品细节', '产品使用过程'].map((subject, index) => ({ sceneId: `scene-${index}`, shotFunction: 'value', subject, action: '展示', script: subject, voiceover: subject, caption: subject, narration: subject })) } as StoredSocialScriptBaseline;
  const asset = { id: 'asset', name: '产品演示', type: 'video' as const, sourceId: 'source', url: '/tmp/verified.mp4', contentHash: 'a'.repeat(64), cloudRecordId: 'cloud', duration: 12, visualObservations: ['产品全貌、产品细节和产品使用过程'], segments: baseline.scenes.map((scene, index) => ({ start: index * 4, end: (index + 1) * 4, confidence: 0.95, observedFacts: `${scene.subject}展示` })) };
  const productionPlan = buildSocialProductionPlan({ baseline, assets: [asset] });
  assert.equal(productionPlan.ok, true, productionPlan.message);
  const plan = buildSocialDirectorPlan({ taskId: 'content', baseline, productionPlan, productionAssets: [asset], outputSpec: { aspectRatio: '9:16', resolution: '720p', platform: 'tiktok' }, createdAt: '2026-10-01T00:01:00Z', bgmSelection: { primary: { trackId: 'builtin-tech-pulse', name: '内置曲库', mood: '科技', authorization: { status: 'authorized', basis: 'lingshu_builtin_library', license: '内置授权', evidence: 'authenticated_catalog:builtin-tech-pulse' } }, fallbacks: [], fallbackPolicy: 'ordered_preapproved_tracks_only', volume: 16 } });
  assert.equal(plan.status, 'ready');
  const row: any = { id: 'row', tenant_id: 'tenant', task_id: 'content', run_id: 'run', status: 'producing', create_idempotency_key: 'weekly-production:package:1:publication', brief: { programRef: { id: 'program' }, _weeklyAuthority: { referenceSelection: { selected: [{ candidateId: 'candidate' }] } } }, script_baseline: baseline, director_plan: plan };
  const ref = weeklyStoryboardEvidence(row, ['candidate'])!;
  assert.deepEqual(ref, { type: 'starter_social_content_director_plan', id: 'content', version: Number(plan.version) });
  assert.equal(weeklyStoryboardEvidence(row, ['wrong']), null);
  assert.equal(weeklyStoryboardEvidence({ ...row, script_baseline: { ...baseline, match: { ...baseline.match, inspirationReference: { recordId: 'other-frozen-reference', confidence: 0.9 } } } }, ['candidate', 'other-frozen-reference']), null);
  assert.equal(weeklyStoryboardEvidence({ ...row, script_baseline: { ...baseline, version: '3' } }, ['candidate']), null);
  assert.throws(() => weeklyStoryboardEvidence({ ...row, director_plan: { ...plan, lineageHash: 'tampered' } }, ['candidate']));
  const pkg={id:'frozen-week',tenant_id:'tenant',program_id:'program',package_id:'package',version:1,payload:{programId:'program',packageId:'package',version:1,socialContentPackage:{publicationTasks:[{publicationTaskId:'publication'}]}}};
  const store = { list: async (collection:string) => ({ items: [collection==='social_weekly_operating_packages'?pkg:row], totalItems: 1 }), getById: async () => ({ id: 'run', tenant_id: 'tenant', status: 'running' }) } as unknown as DataStore;
  const task = { tenantId: 'tenant', programId: 'program', packageId: 'package', packageVersion: 1, publicationTaskId: 'publication', workflowKind: 'content', schedule: { stepKind: 'storyboard' } } as WeeklyExecutionTask;
  await validateWeeklyExecutionResults(store, task, [ref]);
  await validateWeeklyExecutionResults(store, {...task,workflowKind:'directing'}, [ref]);
  await assert.rejects(validateWeeklyExecutionResults(store,{...task,workflowKind:'directing',schedule:{...task.schedule,stepKind:'director_analysis'}},[ref]));
  await assert.rejects(validateWeeklyExecutionResults(store,{...task,workflowKind:'directing',schedule:{...task.schedule,stepKind:'script'}},[ref]));
  await assert.rejects(validateWeeklyExecutionResults(store, task, [{ ...ref, version: ref.version + 1 }]));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { SOCIAL_WORK_PACKAGE_KINDS } from '../../shared/contracts/socialContentWorkflow.js';
import type { DataStore } from '../storage/datastore.js';
import type { WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';
import { validateWeeklyExecutionResults } from './socialWeeklyResultValidation.js';
import { createSocialAssetSupplyPlan } from '../../shared/socialContentAssetSupply.js';
import { buildNoSharedMaterialDemand } from './socialWeeklyMaterialDemand.js';
import { classifyMaterialEvidence } from '../socialPrograms/materialEvidenceClassification.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';

test('generic content readiness cannot validate an empty frozen mandatory material contract', async () => {
  const content = { id: 'contentrow', tenant_id: 'tenant', task_id: 'content', version: '1', status: 'producing', run_id: 'run', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', package_selection: SOCIAL_WORK_PACKAGE_KINDS.map(kind => ({ kind, packageKey: kind, version: '1', name: kind })), source_count: 2, knowledge_source_count: 1, material_source_count: 1, artifact_count: 0, approved_artifact_count: 0, awaiting_approval_count: 0, actual_output_count: 0, publication_count: 0, delivery_package_count: 0, metric_submission_count: 0, create_idempotency_key: 'weekly-production:package:1:publication', brief: { title: '产品介绍', objective: '买家询盘', productRef: 'product', audience: '采购商', markets: ['US'], languages: ['en'], platforms: ['tiktok'], formats: ['short_video'], restrictions: [], programRef: { objectType: 'social_program', id: 'program', version: '1' } } };
  const weekly = { id: 'weekrow', tenant_id: 'tenant', package_id: 'package', version: 1, payload: { programId: 'program', socialContentPackage: { publicationTasks: [{ publicationTaskId: 'publication', materialRequirement: { required: true, requestIds: [] } }] } } };
  const store = { async list(collection: string) { const items = collection === 'starter_social_content_tasks' ? [content] : collection === 'social_weekly_operating_packages' ? [weekly] : []; return { items, totalItems: items.length }; }, async getById() { return { id: 'run', tenant_id: 'tenant', status: 'running' }; } } as unknown as DataStore;
  const task = { taskId: 'consumer', tenantId: 'tenant', programId: 'program', packageId: 'package', packageVersion: 1, publicationTaskId: 'publication', workflowKind: 'content', schedule: { stepKind: 'material_readiness' } } as WeeklyExecutionTask;
  await assert.rejects(validateWeeklyExecutionResults(store, task, [{ type: 'starter_social_content_task', id: 'content', version: 1 }]), { code: 'weekly_required_materials_unverified' });
  delete (weekly.payload.socialContentPackage.publicationTasks[0] as any).materialRequirement;
  await assert.rejects(validateWeeklyExecutionResults(store, task, [{ type: 'starter_social_content_task', id: 'content', version: 1 }]), { code: 'weekly_material_contract_required' });
});

test('automatic material result verifies real frozen plan and cannot override mandatory human inputs', async () => {
  const scope = { taskId: 'content', programId: 'program', packageId: 'package', packageVersion: 1, publicationTaskId: 'publication', factRefs: [{ type: 'enterprise_fact', id: 'fact', version: 1 }] };
  const row: any = { id: 'contentrow', tenant_id: 'tenant', task_id: 'content', run_id: 'run', status: 'producing', create_idempotency_key: 'weekly-production:package:1:publication', material_requirements: [], brief: {} };
  const plan = createSocialAssetSupplyPlan({ creationMode: 'material_processing', planVersion: '4', confirmedFactRefs: ['enterprise_fact:fact@1'], shots: [{ shotId: 'fact', function: 'proof', requestedDescription: '只展示已确认产品事实' }] });
  const demand = buildNoSharedMaterialDemand(row, { taskId: 'content', version: '4', assetSupplyPlan: plan } as any, scope);
  assert.ok(demand);
  row.brief._weeklyMaterialDemand = demand;
  const publication: any = { publicationTaskId: 'publication', factRefs: scope.factRefs };
  const weekly = { id: 'weekrow', tenant_id: 'tenant', package_id: 'package', version: 1, payload: { programId: 'program', socialContentPackage: { publicationTasks: [publication] } } };
  const handoff: any = { inspirationId: 'video', version: '1', analysisVersion: '1', readiness: 'production_reference', rights: { mayAnalyze: true, mayAdapt: true }, productionImplications: { requiredEvidence: [], likelyAssetNeeds: ['AI纯装饰非证据背景'] }, adaptationBoundary: { reusable: ['结构'], mustReplace: ['产品事实'], prohibited: [] } };
  const handoffRef = { inspirationId: 'video', version: '1', recordHash: socialRequestHash(handoff) };
  const classification = classifyMaterialEvidence({ scope: { packageId: 'package', packageVersion: 1, slotId: 'slot' }, handoff, handoffRef });
  const analysis = { analysisId: 'analysis', packageId: 'package', packageVersion: 1, slotId: 'slot', materialEvidenceRequirements: classification, frozenHandoffRefs: [handoffRef] };
  const item = { publicationTaskId: 'publication', slotId: 'slot', directorAnalysisRef: { id: 'analysis' }, materialEvidenceRequirements: classification, materialRequirements: classification.items.map(item => item.description) };
  const planning = { tenant_id: 'tenant', program_id: 'program', package_id: 'package', package_version: 1, planning_version: 1, payload: { status: 'dispatched', directorAnalyses: [analysis], dispatch: { scheduleItems: [item] } } };
  const store = { async list(collection: string) { const items = collection === 'starter_social_content_tasks' ? [row] : collection === 'social_weekly_operating_packages' ? [weekly] : collection === 'social_weekly_agent_planning' ? [planning] : collection === 'starter_social_inspiration_handoff_versions' ? [{ tenant_id: 'tenant', handoff_version: '1', record_hash: handoffRef.recordHash, payload: handoff }] : []; return { items, totalItems: items.length }; }, async getById() { return { id: 'run', tenant_id: 'tenant', status: 'running' }; } } as unknown as DataStore;
  const task = { ...scope, tenantId: 'tenant', taskId: 'consumer', workflowKind: 'content', schedule: { stepKind: 'material_readiness' } } as unknown as WeeklyExecutionTask;
  const ref = { type: 'starter_social_content_material_demand', id: 'content', version: 4 };
  await validateWeeklyExecutionResults(store, task, [ref]);
  await assert.rejects(validateWeeklyExecutionResults(store, task, [{ ...ref, version: 5 }]), { code: 'weekly_material_demand_unverified' });
  publication.materialRequirement = { required: true, requestIds: ['abcdef123456789'] };
  await assert.rejects(validateWeeklyExecutionResults(store, task, [ref]));
});

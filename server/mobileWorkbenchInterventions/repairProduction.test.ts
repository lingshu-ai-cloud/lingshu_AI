import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeProductionScopedRepair, loadProductionRepairSnapshot, productionRepairDetail, resolveProductionRepairProject } from './repairProduction.js';
import type { DataStore, Record_ } from '../storage/datastore.js';

function fixture() {
  const rows = new Map<string, Record_>();
  const add = (collection: string, id: string, data: Record<string, unknown>) => rows.set(`${collection}:${id}`, { id, ...data });
  add('studio_projects', 'p', { tenant_id: 't', spec: { mode: 'material', workflowRunId: 'r', workflowTaskId: 'task',
    workflowTaskKey: 'content_production', scenePlanOrigin: 'director', duration: 9, script: '电路板 背面焊点 接口安装',
    sceneSourcePlan: ['电路板', '背面焊点', '接口安装'].map((intent, sceneIndex) => ({ sceneIndex, intent, assetId: `old${sceneIndex}`, start: sceneIndex * 3, end: (sceneIndex + 1) * 3 })),
    voiceoverUrl: '/voice.wav', automation: { managedBy: 'digital_employee', contentVersion: 2, routePlan: { assetIds: ['replacement'] },
      sceneRepairAttempts: 2, quality: { sceneDiagnostics: { issues: [{ sceneIndex: 1, start: 3, end: 6, code: 'blur', reason: '模糊' }] } } } } });
  add('workflow_runs', 'r', { tenant_id: 't', status: 'waiting_approval', goal_id: 'g' });
  add('weekly_goals', 'g', { tenant_id: 't', status: 'paused' });
  add('workflow_tasks', 'task', { tenant_id: 't', run_id: 'r', task_key: 'content_production', status: 'blocked' });
  const db: DataStore = {
    getById: async <T>(collection: string, id: string) => (rows.get(`${collection}:${id}`) || null) as T | null,
    list: async <T>(collection: string, query: any) => {
      const items = [...rows].filter(([key, row]) => key.startsWith(`${collection}:`) && Object.entries(query?.where || {}).every(([name, value]) => row[name] === value)).map(([, row]) => row);
      return { items: items as T[], totalPages: 1, totalItems: items.length, page: 1, perPage: 100 };
    },
    update: async (collection, id, data) => { const row = rows.get(`${collection}:${id}`); if (!row) return false; Object.assign(row, structuredClone(data)); return true; },
    create: async <T>(collection: string, data: Record<string, unknown>) => { const row = { id: 'audit', ...data }; rows.set(`${collection}:audit`, row); return row as T; },
    delete: async () => false,
  };
  let invalidations = 0;
  const deps = { store: db, collectAssets: async () => [{ id: 'replacement', type: 'image' as const, duration: 0,
    visualObservations: ['背面焊点'], name: 'replacement', observations: [], authorization: { status: 'owned' as const, scope: 'tenant' as const, evidence: 'owned' },
    synthetic: false, tags: [], source: 'tenant_material' as const }], invalidateApproval: async () => { invalidations++; } };
  return { rows, deps, invalidations: () => invalidations };
}
test('explicit human material selection restores production without resetting exhausted automatic counter', async () => {
  const f = fixture(), snapshot = await loadProductionRepairSnapshot('t', 'p', f.deps);
  const input = { tenantId: 't', userId: 'u', projectId: 'p', commandId: 'c', payload: {
    sceneIds: ['scene:1'], repairPlanVersion: snapshot!.version, problemType: 'blur' as const,
    replacements: [{ sceneId: 'scene:1', materialId: 'replacement', trimStart: 0 }] } };
  const result = await executeProductionScopedRepair(input, f.deps);
  assert.equal(result.status, 'queued');
  const spec = f.rows.get('studio_projects:p')!.spec as any;
  assert.equal(spec.sceneSourcePlan[1].assetId, 'replacement');
  assert.equal(spec.sceneSourcePlan[0].assetId, 'old0');
  assert.equal(spec.automation.sceneRepairAttempts, 3);
  assert.equal(spec.automation.mobileRepair.mode, 'human_material_selection');
  assert.equal(f.rows.get('workflow_tasks:task')!.status, 'pending');
  assert.equal(f.rows.get('workflow_runs:r')!.status, 'running');
  assert.equal(f.rows.get('weekly_goals:g')!.status, 'active');
  assert.equal(f.invalidations(), 1);
  await executeProductionScopedRepair(input, f.deps);
  assert.equal((f.rows.get('studio_projects:p')!.spec as any).automation.contentVersion, 3, 'same command does not allocate another repair');
});
test('cross tenant and cancelled run are refused before changing project', async () => {
  const f = fixture();
  assert.equal(await loadProductionRepairSnapshot('other', 'p', f.deps), null);
  f.rows.get('workflow_runs:r')!.status = 'cancelled';
  await assert.rejects(executeProductionScopedRepair({ tenantId: 't', userId: 'u', projectId: 'p', commandId: 'c', payload: {
    sceneIds: ['scene:1'], repairPlanVersion: 'stale', problemType: 'blur' } }, f.deps));
  assert.equal((f.rows.get('studio_projects:p')!.spec as any).automation.contentVersion, 2);
});
test('failed project persistence cannot resume tasks or report success', async () => {
  const f = fixture(), snapshot = await loadProductionRepairSnapshot('t', 'p', f.deps);
  f.deps.store.update = async () => false;
  await assert.rejects(executeProductionScopedRepair({ tenantId: 't', userId: 'u', projectId: 'p', commandId: 'c', payload: {
    sceneIds: ['scene:1'], repairPlanVersion: snapshot!.version, problemType: 'blur',
    replacements: [{ sceneId: 'scene:1', materialId: 'replacement', trimStart: 0 }] } }, f.deps), /保存失败/);
  assert.equal(f.rows.get('workflow_tasks:task')!.status, 'blocked');
  assert.equal(f.invalidations(), 0);
});
test('production detail offers matching manual materials after automatic repair exhaustion', async () => {
  const f = fixture();
  const detail = await productionRepairDetail({ tenantId: 't', targetId: 'p' }, f.deps);
  assert.equal(detail.failedScenes.length, 1);
  assert.equal(detail.failedScenes[0].id, 'scene:1');
  assert.equal(detail.failedScenes[0].eligibleMaterialOptions[0].materialId, 'replacement');
  assert.equal(detail.actionOptions[0].enabled, true);
  assert.equal(detail.actionOptions[0].requiresMaterialSelection, true);
  assert.equal(detail.actionOptions[0].payload.repairPlanVersion, detail.subjectVersion);
  assert.equal(detail.source.entityId, 'p');
  assert.equal(detail.evidence[0].videoUrl, '');
  f.rows.get('workflow_tasks:task')!.output = { projectRefs: [{ type: 'studio_project', id: 'p' }] };
  assert.equal(await resolveProductionRepairProject('t', 'task', f.deps.store), 'p');
  assert.equal(await resolveProductionRepairProject('other', 'task', f.deps.store), null);
});

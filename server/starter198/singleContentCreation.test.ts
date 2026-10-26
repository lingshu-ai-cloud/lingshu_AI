import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProductionTestStore } from '../production/testStore.js';
import { readContentPreferences, saveContentPreferences } from './singleContentPreferences.js';
import { prepareSingleContent, readSingleContentContext } from './singleContentPreparation.js';
import { contentPreferencesSchema, DEFAULT_CONTENT_PREFERENCES, singleContentSelectionSchema } from '../../shared/contracts/singleContentCreation.js';
import { parseCreateSocialTask } from './socialContentValidation.js';
import { defaultBrief } from './socialContentTaskSupport.js';
import { parseSocialTaskBrief } from './socialContentRecordProjection.js';
import type { CreationEvidencePorts } from '../assistantContext/contentCreationDialogue.js';
import { assertTaskPresenterPolicy } from './socialContentPresenterExecutionPolicy.js';
import type { SocialAssetSupplyPlan } from '../../shared/contracts/socialContentWorkflow.js';

const now = new Date('2026-10-24T14:00:00Z');
const selection = singleContentSelectionSchema.parse({ productId: 'product-a', objective: '介绍产品',
  dueAt: '2026-10-25T10:00:00+08:00', usePresenter: false, preferences: DEFAULT_CONTENT_PREFERENCES });
function evidence(): CreationEvidencePorts {
  return {
    profile: async tenantId => ({ company: { name: tenantId }, dataGovernance: { aiAccessEnabled: true }, products: { items: [{ id: 'product-a', name: '产品 A' }] } }),
    references: async () => [{ id: 'reference-a', title: '结构参考', sourceUrl: 'https://example.com/reference-a' }],
    reference: async () => null, presenters: async () => [],
    materials: async () => ({ status: 'ready', items: [{ id: 'material-a', productId: 'product-a', sourceRevision: 'v1' }] }),
  };
}
test('preflight freezes actual enterprise evidence and never equates form completion with executor availability', async () => {
  const store = createProductionTestStore();
  const ctx = await readSingleContentContext({ store, evidence: evidence(), tenantId: 'tenant-a' });
  const result = prepareSingleContent(ctx, selection, { now, executionAvailable: true, localPreview: true });
  assert.equal(result.canCreate, true);
  assert.equal(result.executionAvailable, false);
  assert.equal(result.budgetLimitCny, 15);
  assert.equal(store.rows.size, 0, 'read-only preflight must not create tasks, grants or defaults');
  const enabled = prepareSingleContent(ctx, selection, { now, executionAvailable: true, localPreview: false });
  assert.notEqual(enabled.fingerprint, result.fingerprint);
  ctx.inventory.items[0]!.sourceRevision = 'v2';
  assert.notEqual(prepareSingleContent(ctx, selection, { now, executionAvailable: true, localPreview: true }).fingerprint, result.fingerprint);
});
test('deleted products, stale deadlines, missing authorized presenters and incomplete inventory block admission', async () => {
  const ctx = await readSingleContentContext({ store: createProductionTestStore(), evidence: evidence(), tenantId: 'tenant-a' });
  for (const patch of [{ productId: 'foreign-product' }, { dueAt: '2026-10-23T00:00:00Z' }, { usePresenter: true, presenterId: 'untrusted' }]) {
    assert.equal(prepareSingleContent(ctx, { ...selection, ...patch }, { now, executionAvailable: true, localPreview: false }).canCreate, false);
  }
  ctx.inventory.status = 'unavailable';
  assert.equal(prepareSingleContent(ctx, selection, { now, executionAvailable: true, localPreview: false }).canCreate, false);
});
test('enterprise preferences persist in the existing aggregate, preserve presenter evidence and reject stale writes / cross-tenant selection', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'single-content-settings-'));
  const cwd = process.cwd(); process.chdir(folder);
  try {
    const store = createProductionTestStore();
    await store.create('studio_production_defaults', { tenant_id: 'tenant-a', payload: {
      presenters: [{ id: 'person-a', authorized: true, rightsEvidence: { consentRef: 'keep-me' } }], defaultPresenterId: 'person-a',
    } });
    const before = await readContentPreferences(store, 'tenant-a');
    const after = await saveContentPreferences(store, 'tenant-a', { preferences: { ...before.preferences, languages: ['en', 'vi'] }, expectedVersion: before.version });
    assert.deepEqual(after.preferences.languages, ['en', 'vi']);
    assert.deepEqual(after.payload.presenters, before.payload.presenters);
    assert.equal(after.payload.defaultPresenterId, 'person-a');
    assert.equal((await readContentPreferences(store, 'tenant-b')).saved, false);
    await assert.rejects(saveContentPreferences(store, 'tenant-a', { preferences: before.preferences, expectedVersion: before.version }), /content_preferences_changed/);
    await assert.rejects(saveContentPreferences(store, 'tenant-a', { preferences: after.preferences, expectedVersion: after.version, defaultPresenterId: 'foreign-person' }), /content_default_presenter_invalid/);
    assert.deepEqual((await readContentPreferences(store, 'tenant-a')).preferences.languages, ['en', 'vi']);
  } finally { process.chdir(cwd); await rm(folder, { recursive: true, force: true }); }
});
test('explicit no-digital-person choice survives task parsing, persistence and projection; historical tasks retain original policy', () => {
  const input = parseCreateSocialTask({ title: '产品内容', objective: '介绍产品', presenterPolicy: 'none', dueAt: selection.dueAt });
  const brief = parseSocialTaskBrief(defaultBrief(input));
  assert.equal(brief.presenterPolicy, 'none');
  assert.equal(brief.presenterAssetId, null);
  assert.equal(parseSocialTaskBrief(defaultBrief({ title: '历史', objective: '历史任务' })).presenterPolicy, undefined);
  assert.throws(() => parseCreateSocialTask({ title: '冲突', objective: '冲突', presenterPolicy: 'none', presenterAssetId: 'person-a' }), /social_presenter_policy_conflict/);
  assert.throws(() => parseCreateSocialTask({ title: '缺人物', objective: '缺人物', presenterPolicy: 'selected' }), /social_presenter_selection_required/);
});
test('production cannot silently add a disabled presenter or deliver a selected-presenter task without presenter shots', () => {
  const presenterPlan = { shots: [{ sourceStrategy: 'authorized_digital_presenter' }] } as SocialAssetSupplyPlan;
  const productPlan = { shots: [{ sourceStrategy: 'customer_real_asset' }] } as SocialAssetSupplyPlan;
  assert.throws(() => assertTaskPresenterPolicy({ presenterPolicy: 'none' }, presenterPlan), /presenter_disabled_for_task/);
  assert.throws(() => assertTaskPresenterPolicy({ presenterPolicy: 'selected' }, productPlan), /selected_presenter_missing_from_plan/);
  assert.doesNotThrow(() => assertTaskPresenterPolicy({ presenterPolicy: 'none' }, productPlan));
  assert.doesNotThrow(() => assertTaskPresenterPolicy({ presenterPolicy: 'selected' }, presenterPlan));
  assert.doesNotThrow(() => assertTaskPresenterPolicy({}, presenterPlan));
});

test('legacy language preference migrates, multiple languages persist, and the retired duration setting is ignored', () => {
  assert.deepEqual(contentPreferencesSchema.parse({ language: 'zh', durationSeconds: 30 }).languages, ['zh']);
  assert.deepEqual(contentPreferencesSchema.parse({ languages: ['en', 'zh', 'en'] }).languages, ['en', 'zh']);
  assert.equal(contentPreferencesSchema.safeParse({ languages: [] }).success, false);
});
test('reference duration is preserved beyond 60 seconds and below 6 seconds through the original task contract', async () => {
  for (const duration of [3.5, 125, 7200]) {
    const brief = parseSocialTaskBrief(defaultBrief(parseCreateSocialTask({ title: '跟随参考', objective: '复用参考结构', targetDurationSeconds: duration })));
    assert.equal(brief.targetDurationSeconds, duration);
  }
  const ports = evidence();
  ports.references = async () => [{ id: 'reference-a', title: '长参考', duration: 125, sourceUrl: 'https://example.com/reference-a' },
    { id: 'image', contentFormat: 'image', sourceUrl: 'https://example.com/image' }, { id: '../bad', title: '无效记录' }, { id: 'uploaded', title: '本地参考', duration: 63.72 }];
  const ctx = await readSingleContentContext({ store: createProductionTestStore(), evidence: ports, tenantId: 'tenant-a' });
  assert.deepEqual(ctx.options.references.map(row => row.id), ['reference-a', 'uploaded']);
  assert.equal(ctx.options.references[0]!.durationSeconds, 125);
  const multi = { ...selection, referenceId: 'reference-a', preferences: { ...selection.preferences, languages: ['en', 'zh'] as ('en' | 'zh')[] } };
  const prepared = prepareSingleContent(ctx, multi, { now, executionAvailable: true, localPreview: false });
  assert.equal(prepared.budgetLimitCny, 125);
  assert.equal(prepared.canCreate, true);
  const unsupported = prepareSingleContent(ctx, { ...selection, preferences: { ...selection.preferences, languages: ['es'] } }, { now, executionAvailable: true, localPreview: false });
  assert.equal(unsupported.canCreate, false, 'must never silently substitute Chinese for an unsupported language');
});

test('single-task preflight reuses an imported catalog license without a new user authorization', async () => {
  const ports=evidence();
  ports.presenters=async()=>[{id:'public-person',name:'已有授权人物',authorized:true,avatarId:'public-avatar',voiceId:'public-voice',rightsEvidence:{
    authorizationRef:'license://heygen/public-catalog/public-avatar',consentRef:'license://heygen/public-catalog/public-group',
    grantedAt:'2026-09-01T00:00:00Z',subjectAdultConfirmed:false,permittedProviders:['heygen'],permittedUses:['digital_presenter','voice_synthesis'],
  }}];
  const ctx=await readSingleContentContext({store:createProductionTestStore(),evidence:ports,tenantId:'tenant-a'});
  assert.equal(ctx.options.presenters[0]!.authorized,true);
  const prepared=prepareSingleContent(ctx,{...selection,usePresenter:true,presenterId:'public-person',preferences:{...selection.preferences,materialPolicy:'ai_enhanced'}},{now,executionAvailable:true,localPreview:false});
  assert.equal(prepared.canCreate,true);
  assert.equal(prepared.checks.find(check=>check.key==='presenter')!.state,'ready');
});

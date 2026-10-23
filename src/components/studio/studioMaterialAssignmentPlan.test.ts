import assert from 'node:assert/strict';
import test from 'node:test';
import { planStudioMaterialAssignments, type StudioMaterialAssignmentInput } from './studioMaterialAssignmentPlan';
import type { Clip } from './studioSourceMaterial';
import type { StoryboardSlot } from './studioTimelineFitting';

const clip = (id: string, overrides: Partial<Clip> = {}): Clip => ({
  id, name: '工厂实拍', folder: 'factory', type: 'video', duration: 8, size: '1 MB', width: 1080, height: 1920,
  url: '/fixture/' + id, segments: [{ id: 'whole', start: 0, end: 8, duration: 8, quality: 90, confidence: .95,
    subject: ['工厂产线'], action: '工厂生产', environment: '车间', shot: '中景', recommendedFunctions: ['建立信任'],
    productVisible: false, productClarity: 'none', angle: '正面', composition: '全景', camera: '固定',
    ocrText: '', hasPerson: false, hasLogo: false, logoText: [], authenticity: 'real', needsReview: false }], ...overrides,
});
const slot = (id: string, start = 0): StoryboardSlot => ({
  id, start, end: start + 3, time: `${start}-${start + 3}s`, title: '工厂产线', detail: '画面：工厂产线实拍\n镜头功能：建立信任\n口播：无',
});
function input(overrides: Partial<StudioMaterialAssignmentInput> = {}): StudioMaterialAssignmentInput {
  return { allVisuals: [clip('evidence')], videoKickoff: null, socialViralTask: false, ratio: '9:16', selected: [], hookMaterialId: '',
    activeAssemblyId: 'a1', assemblyName: 'Current', storyboardSlots: [slot('s1')], storyboardAssignments: {}, storyboardSourcePlans: {},
    storyboardAssemblies: [], personContinuityBySlot: {}, productionFor: () => ({ locked: false }), presenterEvidenceFor: () => ({}),
    shotRouteFor: () => 'material', sourcePlanFor: () => ({ mode: 'local', confirmed: false, critical: false }),
    slotClipEditKey: (shot, material) => `${shot}:${material}`, defaultEditForSlot: () => ({ trimStart: 0, trimEnd: 3, speed: 1, transition: 'none', note: '' }), ...overrides };
}

test('planning returns a detached assignment/plan/edit patch without mutating caller state', () => {
  const context = input();
  const before = structuredClone({ assignments: context.storyboardAssignments, plans: context.storyboardSourcePlans, selected: context.selected });
  const result = planStudioMaterialAssignments(context);
  assert.equal(result.kind, 'planned');
  if (result.kind !== 'planned') return;
  assert.deepEqual(result.assignments, { s1: 'evidence' });
  assert.equal(result.nextPlans.s1?.confirmed, false);
  assert.ok(result.nextEdits['s1:evidence']);
  assert.equal(result.matchedCount, 1);
  assert.deepEqual({ assignments: context.storyboardAssignments, plans: context.storyboardSourcePlans, selected: context.selected }, before);
});

test('confirmed shots are preserved and an entirely assigned plan has no new mutations', () => {
  const result = planStudioMaterialAssignments(input({ storyboardAssignments: { s1: 'evidence' },
    storyboardSourcePlans: { s1: { mode: 'local', confirmed: true, critical: false } } }));
  assert.deepEqual(result, { kind: 'already_assigned' });
});

test('missing evidence stays unassigned and carries an explicit missing plan', () => {
  const result = planStudioMaterialAssignments(input({ socialViralTask: true,
    allVisuals: [clip('metadata-only', { segments: [], name: '无关画面', folder: 'other' })] }));
  assert.equal(result.kind, 'planned');
  if (result.kind !== 'planned') return;
  assert.deepEqual(result.assignments, {});
  assert.equal(result.missingCount, 1);
  assert.equal(result.nextPlans.s1?.matchLevel, 'missing');
  assert.match(result.nextPlans.s1?.matchReason || '', /逐片段画面校验/);
});

test('locked production, explicit AI routes and confirmed presenter routes are not silently replaced', () => {
  const slots = [slot('locked'), slot('ai', 3), slot('presenter', 6)];
  const result = planStudioMaterialAssignments(input({ socialViralTask: true, storyboardSlots: slots,
    storyboardSourcePlans: { ai: { mode: 'ai', confirmed: false, critical: false } },
    productionFor: shot => ({ locked: shot.id === 'locked' }),
    presenterEvidenceFor: shot => shot.id === 'presenter' ? { observedPresenterRole: 'sales_presenter', salesPresenterConfirmed: true, personContinuityId: 'speaker' } : {},
    shotRouteFor: shot => shot.id === 'presenter' ? 'presenter' : 'material' }));
  assert.deepEqual(result, { kind: 'already_assigned' });
});

test('cross-shot identity uses one sufficiently long source and refuses an undersized identity source', () => {
  const common = { storyboardSlots: [slot('s1'), slot('s2', 3)], personContinuityBySlot: { s1: 'same-person', s2: 'same-person' } };
  const complete = planStudioMaterialAssignments(input(common));
  assert.equal(complete.kind, 'planned');
  if (complete.kind === 'planned') assert.deepEqual(complete.assignments, { s1: 'evidence', s2: 'evidence' });
  const shortClip = clip('short', { duration: 4 });
  shortClip.segments = shortClip.segments?.map(segment => ({ ...segment, end: 4, duration: 4 }));
  const short = planStudioMaterialAssignments(input({ ...common, allVisuals: [shortClip] }));
  assert.equal(short.kind, 'planned');
  if (short.kind === 'planned') { assert.deepEqual(short.assignments, {}); assert.equal(short.missingCount, 2); }
});

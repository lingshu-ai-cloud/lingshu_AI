import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { studioApi, type FbPosterResult, type LeadContentPackageResult } from '../../lib/studioApi';
import { inferMaterialAssetV2 } from '../../../shared/imageCreativePlanning';
import type { Clip } from './studioSourceMaterial';
import { createStudioPosterActions, studioPosterEligibility, useStudioPosterWorkspace, type StudioPosterGenerationInput } from './studioPosterWorkspace';

const image = (id = 'product', extra: Partial<Clip> = {}): Clip => ({ id, name: id, type: 'image', folder: 'product',
  duration: 0, size: '', url: '/fixture/' + id, productId: 'sku',
  materialV2: inferMaterialAssetV2({ type: 'image', name: 'SKU 产品正面', productId: 'sku' }), ...extra });
const brief = (extra: Partial<FbPosterResult> = {}): FbPosterResult => ({ ok: true, source: 'ai', provenance: 'ai',
  qualityStatus: 'passed', publishable: true, fieldsToConfirm: [], caption: 'Caption', hashtags: ['one', '#two'],
  commentCta: 'CTA', dmOpening: 'Hello', imagePrompt: 'Prompt', poster: { headline: 'Headline', subheadline: '', originBadge: '',
    trustBadges: [], sellingPoints: [], process: [], categories: [], bottomBar: [], cta: 'Contact' }, ...extra });
const contentPackage = (extra: Partial<LeadContentPackageResult> = {}): LeadContentPackageResult => ({
  ok: true, source: 'ai', provenance: 'ai', qualityStatus: 'passed', publishable: true, strategySummary: 'Evidence-led',
  referenceModulesUsed: [], fieldsToConfirm: [], items: ['buyer_attention', 'capability_explanation', 'supplier_trust'].map(role => ({
    role: role as LeadContentPackageResult['items'][number]['role'], title: role, objective: 'Explain',
    slides: [{ index: 1, role: 'cover', headline: role, body: 'Observed', assetRole: 'exact_product' }],
    caption: 'Package caption', hashtags: ['package'], cta: 'Contact', dmOpening: 'Hello', imagePrompt: 'Own product',
  })), ...extra,
});
function fixture(overrides: Partial<StudioPosterGenerationInput> = {}) {
  let initial!: ReturnType<typeof useStudioPosterWorkspace>;
  function Probe() { initial = useStudioPosterWorkspace(); return null; }
  renderToStaticMarkup(createElement(Probe));
  const state = { ...initial };
  for (const key of Object.keys(initial).filter(key => key.startsWith('set'))) {
    const field = key.slice(3, 4).toLowerCase() + key.slice(4);
    Object.assign(state, { [key]: (update: unknown) => {
      const target = state as unknown as Record<string, unknown>;
      target[field] = typeof update === 'function' ? update(target[field]) : update;
    } });
  }
  const notices: string[] = [], captions: string[] = [];
  let selected = ['product', 'video'], refreshes = 0;
  const materials = [image()];
  const input: StudioPosterGenerationInput = { product: { info: 'Verified product', label: 'Product' },
    output: { imageDeliverable: 'social_poster', platform: 'facebook', lang: 'en', ratio: '1:1', posterStyle: 'oem-factory', provider: 'qwen' },
    materials, materialById: new Map(materials.map(item => [item.id, item])), selectedClips: [], selectedProductIds: ['sku'], videoKickoff: null,
    onSelect: update => { selected = typeof update === 'function' ? update(selected) : update; },
    onNotice: message => notices.push(message), onCaption: caption => captions.push(caption),
    refreshMaterials: async () => { refreshes++; return materials; }, ...overrides };
  return { state, input, notices, captions, selected: () => selected, refreshes: () => refreshes,
    actions: () => createStudioPosterActions(state), eligibility: () => studioPosterEligibility(state) };
}
const evidence = (): NonNullable<StudioPosterGenerationInput['videoKickoff']> => ({ source: 'inspiration_image_post',
  video: { title: 'Reference', aiAnalysis: { imageEvidence: { observedFacts: [{ observation: 'Observed layout' }] } } } });

test.beforeEach(t => {
  if (!('mock' in t)) throw Error('Requires per-test context');
  const network = t.mock.method(globalThis, 'fetch', async () => { throw Error('unexpected real network'); });
  t.after(() => assert.equal(network.mock.callCount(), 0));
});

test('initial poster owner is idle and cannot deliver an unverified artifact', () => {
  const f = fixture();
  assert.equal(f.state.posterLoading, false); assert.equal(f.state.posterImageReviewing, false);
  assert.deepEqual(f.eligibility(), { posterBriefIsVerified: false, posterGenerationIsVerified: false });
});

test('missing reference evidence, verified product or exact product material blocks before any generation request', async t => {
  const call = t.mock.method(studioApi, 'fbPoster', async () => { throw Error('unexpected brief'); });
  for (const overrides of [{ videoKickoff: { source: 'inspiration_image_post' } },
    { product: { info: '', label: '' } }, { materials: [] }]) {
    const f = fixture(overrides);
    await f.actions().generatePosterBrief(f.input);
    assert.equal(f.state.posterLoading, false); assert.ok(f.notices[0]);
    assert.deepEqual(f.selected(), ['product', 'video']);
  }
  assert.equal(call.mock.callCount(), 0);
});

test('standard generation carries the selected product and output contract, retains shared video selection and requires image review', async t => {
  const f = fixture();
  const request = t.mock.method(studioApi, 'fbPoster', async () => brief());
  const render = t.mock.method(studioApi, 'fbPosterRender', async () => ({ ok: true, url: '/poster', material: image('generated') }));
  await f.actions().generatePosterBrief(f.input);
  assert.equal(request.mock.calls[0]?.arguments[0]?.productInfo, 'Verified product');
  assert.equal(request.mock.calls[0]?.arguments[0]?.language, 'en');
  assert.deepEqual(render.mock.calls[0]?.arguments[0]?.productIds, ['sku']);
  assert.deepEqual(render.mock.calls[0]?.arguments[0]?.materialIds, ['product']);
  assert.deepEqual(f.selected(), ['video', 'product', 'generated']);
  assert.deepEqual(f.captions, ['Caption #one #two']); assert.equal(f.refreshes(), 1);
  assert.equal(f.state.posterImageReviewStatus, 'needs_review'); assert.equal(f.state.posterLoading, false);
  assert.equal(f.eligibility().posterGenerationIsVerified, false);
});

test('a render failure retains the successful brief and caption while invalidating an earlier image', async t => {
  const f = fixture(); f.state.setPosterImageUrl('/old'); f.state.setPosterImageMaterialId('old'); f.state.setPosterImageReviewStatus('accepted');
  t.mock.method(studioApi, 'fbPoster', async () => brief({ fieldsToConfirm: ['MOQ'] }));
  t.mock.method(studioApi, 'fbPosterRender', async () => ({ ok: false, error: 'fixture image rejected' }));
  await f.actions().generatePosterBrief(f.input);
  assert.match(f.state.posterJsonText, /Headline/); assert.equal(f.captions.length, 1);
  assert.equal(f.state.posterImageUrl, ''); assert.equal(f.state.posterImageMaterialId, '');
  assert.equal(f.state.posterImageReviewStatus, 'none'); assert.equal(f.state.posterLoading, false);
  assert.match(f.notices.at(-1)!, /fixture image rejected.*MOQ/);
});

test('a rejected or non-AI brief cannot start image production', async t => {
  const f = fixture();
  t.mock.method(studioApi, 'fbPoster', async () => brief({ source: 'ai_rejected', error: 'fixture claims unsupported' }));
  const render = t.mock.method(studioApi, 'fbPosterRender', async () => { throw Error('unexpected image'); });
  await f.actions().generatePosterBrief(f.input);
  assert.equal(render.mock.callCount(), 0); assert.equal(f.state.posterDraft, null);
  assert.equal(f.state.posterLoading, false); assert.match(f.notices.at(-1)!, /fixture claims unsupported/);
});

test('evidence-led generation excludes style references from image inputs while preserving the complete reference-role plan', async t => {
  const product = image(), style = image('style', { folder: 'hot', usage: 'reference_only', materialV2: undefined, productId: undefined });
  const f = fixture({ videoKickoff: evidence(), materials: [product, style], selectedClips: [style],
    materialById: new Map([[product.id, product], [style.id, style]]) });
  const packageCall = t.mock.method(studioApi, 'leadContentPackage', async () => contentPackage());
  const render = t.mock.method(studioApi, 'fbPosterRender', async () => ({ ok: true, url: '/package-cover', material: image('generated') }));
  await f.actions().generatePosterBrief(f.input);
  assert.equal(packageCall.mock.calls[0]?.arguments[0]?.referenceEvidence, f.input.videoKickoff?.video?.aiAnalysis?.imageEvidence);
  const request = render.mock.calls[0]?.arguments[0];
  assert.deepEqual(request?.materialIds, ['product']);
  assert.deepEqual(request?.referencePlan, [{ materialId: 'product', role: 'exact_product' }, { materialId: 'style', role: 'style' }]);
  assert.match(request?.imagePrompt || '', /Do not reproduce any competitor product/);
  assert.equal(f.state.leadContentPackage?.items.length, 3); assert.equal(f.state.posterDraft?.poster?.headline, 'buyer_attention');
  assert.match(f.state.posterJsonText, /supplier_trust/); assert.equal(f.state.posterImageReviewStatus, 'needs_review');
});

test('a partial evidence package is rejected before any image request', async t => {
  const f = fixture({ videoKickoff: evidence() });
  t.mock.method(studioApi, 'leadContentPackage', async () => contentPackage({ items: contentPackage().items.slice(0, 2) }));
  const render = t.mock.method(studioApi, 'fbPosterRender', async () => { throw Error('unexpected render'); });
  await f.actions().generatePosterBrief(f.input);
  assert.equal(render.mock.callCount(), 0); assert.equal(f.state.leadContentPackage, null);
  assert.equal(f.state.posterLoading, false);
});

test('a failed package cover retains all generated text and resets image review state', async t => {
  const f = fixture({ videoKickoff: evidence() });
  f.state.setPosterImageUrl('/old'); f.state.setPosterImageReviewStatus('accepted');
  t.mock.method(studioApi, 'leadContentPackage', async () => contentPackage({ fieldsToConfirm: ['delivery terms'] }));
  t.mock.method(studioApi, 'fbPosterRender', async () => ({ ok: false, error: 'fixture cover failed' }));
  await f.actions().generatePosterBrief(f.input);
  assert.equal(f.state.leadContentPackage?.items.length, 3); assert.equal(f.state.posterImageUrl, '');
  assert.equal(f.state.posterImageReviewStatus, 'none'); assert.equal(f.state.posterDraft?.publishable, false);
  assert.match(f.notices.at(-1)!, /三组获客内容已生成.*fixture cover failed/);
});

test('manual JSON changes invalidate generated images, provenance and package delivery without duplicating confirmation fields', () => {
  const f = fixture();
  f.state.setPosterDraft(brief()); f.state.setLeadContentPackage(contentPackage());
  f.state.setPosterImageUrl('/old'); f.state.setPosterImageMaterialId('old'); f.state.setPosterImageReviewStatus('accepted');
  f.actions().markPosterJsonAsManualDraft('{"manual":true}', f.input.onNotice);
  f.actions().markPosterJsonAsManualDraft('{"manual":false}', f.input.onNotice);
  assert.equal(f.state.posterJsonText, '{"manual":false}'); assert.equal(f.state.posterImageUrl, '');
  assert.equal(f.state.posterImageMaterialId, ''); assert.equal(f.state.leadContentPackage, null);
  assert.equal(f.state.posterDraft?.provenance, 'manual_draft'); assert.equal(f.state.posterDraft?.publishable, false);
  assert.deepEqual(f.state.posterDraft?.fieldsToConfirm, ['手动修改后的图文内容']);
  assert.equal(f.eligibility().posterGenerationIsVerified, false);
});

test('review requires a traceable material and only marks acceptance after the review receipt succeeds', async t => {
  const f = fixture();
  const review = t.mock.method(studioApi, 'reviewGeneratedImage', async () => ({ ok: true }));
  await f.actions().confirmPosterImage(f.input);
  assert.equal(review.mock.callCount(), 0); assert.match(f.notices[0]!, /可追溯/);
  f.state.setPosterDraft(brief()); f.state.setPosterImageUrl('/poster'); f.state.setPosterImageMaterialId('generated');
  f.state.setPosterImageReviewStatus('needs_review');
  await f.actions().confirmPosterImage(f.input);
  assert.deepEqual(review.mock.calls[0]?.arguments, ['generated']); assert.equal(f.refreshes(), 1);
  assert.equal(f.state.posterImageReviewStatus, 'accepted'); assert.equal(f.state.posterImageReviewing, false);
  assert.equal(f.eligibility().posterGenerationIsVerified, true);
});

test('failed review retains the pending review state and releases its busy state', async t => {
  const f = fixture(); f.state.setPosterImageMaterialId('generated'); f.state.setPosterImageReviewStatus('needs_review');
  t.mock.method(studioApi, 'reviewGeneratedImage', async () => ({ ok: false, error: 'fixture receipt rejected' }));
  await f.actions().confirmPosterImage(f.input);
  assert.equal(f.state.posterImageReviewStatus, 'needs_review'); assert.equal(f.state.posterImageReviewing, false);
  assert.equal(f.refreshes(), 0); assert.match(f.notices.at(-1)!, /fixture receipt rejected/);
});

test('delivery qualification requires AI provenance, passed quality, no unconfirmed fields and accepted image together', () => {
  const accepted = { posterDraft: brief(), posterImageUrl: '/poster', posterImageReviewStatus: 'accepted' as const };
  assert.equal(studioPosterEligibility(accepted).posterGenerationIsVerified, true);
  for (const change of [{ ok: false }, { source: 'ai_failed' as const }, { provenance: 'manual_draft' },
    { qualityStatus: 'needs_confirmation' as const }, { publishable: false }, { fieldsToConfirm: ['MOQ'] }]) {
    assert.equal(studioPosterEligibility({ ...accepted, posterDraft: brief(change) }).posterGenerationIsVerified, false);
  }
  assert.equal(studioPosterEligibility({ ...accepted, posterImageUrl: '' }).posterGenerationIsVerified, false);
  assert.equal(studioPosterEligibility({ ...accepted, posterImageReviewStatus: 'needs_review' }).posterGenerationIsVerified, false);
});

test('the active generation keeps its original output snapshot while image completion remains pending', async t => {
  const f = fixture();
  let finish!: (value: Awaited<ReturnType<typeof studioApi.fbPoster>>) => void;
  t.mock.method(studioApi, 'fbPoster', () => new Promise(resolve => { finish = resolve; }));
  const render = t.mock.method(studioApi, 'fbPosterRender', async () => ({ ok: true, url: '/poster', material: image('generated') }));
  const pending = f.actions().generatePosterBrief(f.input);
  assert.equal(f.state.posterLoading, true); assert.equal(f.state.posterDraft, null);
  f.input.output.ratio = '9:16'; f.input.output.lang = 'fr';
  finish(brief()); await pending;
  assert.equal(render.mock.calls[0]?.arguments[0]?.ratio, '1:1');
  assert.equal(f.state.posterLoading, false); assert.equal(f.state.posterImageUrl, '/poster');
});

test('a failed material refresh after a saved review keeps the original accepted receipt and reports the refresh failure', async t => {
  const f = fixture(); f.state.setPosterImageMaterialId('generated'); f.state.setPosterImageReviewStatus('needs_review');
  t.mock.method(studioApi, 'reviewGeneratedImage', async () => ({ ok: true }));
  await f.actions().confirmPosterImage({ ...f.input, refreshMaterials: async () => { throw Error('fixture inventory unavailable'); } });
  assert.equal(f.state.posterImageReviewStatus, 'accepted'); assert.equal(f.state.posterImageReviewing, false);
  assert.match(f.notices.at(-1)!, /fixture inventory unavailable/);
});

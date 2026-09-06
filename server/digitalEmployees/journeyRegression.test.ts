import { splitSubtitleUnits, freezeStoryboardNarration } from './contentProduction.js';
import assert from 'node:assert/strict';
import { normalizeVideoPlan, spokenLanguageMatches } from '../../src/lib/videoCreationPlan.js';
import { normalizeDigitalEmployeeConfig, normalizeWeeklyGoal } from './domain.js';
import { buildContentBatchPlan } from './contentBatchPlan.js';
import { contentAcceptanceHash, contentAccepted } from './contentAcceptance.js';
import { parseNarration } from './narration.js';

const config = normalizeDigitalEmployeeConfig({ enabledWorkflows: ['product_content', 'material_content', 'viral_clone'], focusProducts: 'Press', socialCadence: '每周5条' });
const video = normalizeVideoPlan({ route: 'product', productName: 'Press', theme: 'Confirm fixture identification before a changeover', language: 'en', duration: 30, platform: 'youtube' });
const goal = normalizeWeeklyGoal({ videoPlans: [video], contentPlatforms: ['youtube'], objective: 'One English video' }, config);
const input = { goalId: 'goal', goal, config, versions: { configVersion: 1, policyVersion: '1', factsVersion: '1' }, evidence: { products: [{ id: 'p', name: 'Press', materialIds: [] }], exactAnalysisIds: [], materialIds: [] } };
const plan = buildContentBatchPlan(input);
assert.equal(plan.orders.length, 1, 'explicit videos override cadence allocation');
assert.equal(plan.orders[0].route, 'product');
assert.equal(plan.orders[0].videoPlan?.language, 'en');
assert.equal(plan.orders[0].theme.label, video.theme);
assert.equal(buildContentBatchPlan({ ...input, goal: { ...goal, videoPlans: [{ ...video, route: 'material' }] } }).status, 'blocked');
assert.equal(buildContentBatchPlan({ ...input, goal: { ...goal, videoPlans: [{ ...video, route: 'clone', referenceId: 'missing' }] } }).status, 'blocked');
assert.equal(buildContentBatchPlan({ ...input, goal: { ...goal, videoPlans: [{ ...video, presenter: 'heygen', heygenAvatarId: 'avatar', avatarConsent: false }] } }).status, 'blocked');
assert.equal(buildContentBatchPlan({ ...input, goal: { ...goal, videoPlans: undefined } }).status, 'blocked', 'never drop a focus product silently');
assert.equal(spokenLanguageMatches('压力机选型不只看吨位', 'en'), false);
assert.equal(spokenLanguageMatches('Which fixture check matters to your line?', 'en'), true);
assert.throws(() => parseNarration('{"lines":["第一句中文","第二句中文","第三句中文"]}', 'en', 20));
const spec = { script: 'script', lang: 'en', voiceoverUrl: '/voice.wav', selectedMaterialIds: ['asset'], automation: { quality: { passed: true }, contentVersion: 1 } };
assert.equal(contentAccepted(spec), false);
const approved = { ...spec, contentAcceptance: { hash: contentAcceptanceHash(spec), approvedBy: 'reviewer', approvedAt: 'now' } };
assert.equal(contentAccepted(approved), true);
assert.equal(contentAccepted({ ...approved, lang: 'zh' }), false);
assert.equal(contentAccepted({ ...approved, voiceoverUrl: '/changed.wav' }), false);
console.log('Journey production plan, language and approval regressions passed');

assert.equal(spokenLanguageMatches('これは治具の確認方法です。', 'ja'), true);
assert.equal(spokenLanguageMatches('这是中文内容', 'ja'), false);
assert.equal(spokenLanguageMatches('Это проверка оснастки.', 'ru'), true);
assert.equal(spokenLanguageMatches('This is English.', 'ru'), false);
assert.equal(spokenLanguageMatches('안전하게 확인하세요.', 'ko'), true);
assert.equal(spokenLanguageMatches('مرحبا، تحقق من الأداة.', 'ar'), true);
assert.equal(spokenLanguageMatches('Hello', 'unsupported'), false);
assert.equal(contentAccepted({ ...approved, disclaimer: 'Changed disclosure' }), false);

const sentence = 'Avant d’utiliser des images industrielles comme preuve produit, vérifiez les informations.';
assert.equal(splitSubtitleUnits(sentence).join(' '), sentence, 'space-delimited words stay whole in subtitles');
assert.equal(freezeStoryboardNarration('台词：错误翻译\n字幕：错误翻译', ['Approved exact text.']), '台词：Approved exact text.\n字幕：Approved exact text.');
assert.throws(() => freezeStoryboardNarration('台词：missing subtitle', ['Approved exact text.']));

const { buildPresenterMixTimeline } = await import('./presenterMix.js');
const mix = buildPresenterMixTimeline('avatar', [3, 6, 4], [{ name: 'product', type: 'video', url: 'owned-product', targetDuration: 6, trimStart: 1, trimEnd: 7 }]);
assert.equal(mix[2].trimStart, 9, 'returning presenter stays in sync instead of restarting at zero');
assert.equal(mix[1].url, 'owned-product');
assert.equal(mix.reduce((sum, clip) => sum + clip.targetDuration, 0), 13);
assert.throws(() => buildPresenterMixTimeline('avatar', [3, 6, 4], []));
assert.throws(() => buildPresenterMixTimeline('avatar', [3, 6, 4], [{ name: 'fake mix', type: 'video', url: 'avatar', targetDuration: 6 }]));

// Output mode is independent of the route used to write the script.
const { presentationScenes, videoPlanErrors } = await import('../../src/lib/videoCreationPlan.js');
const { buildPresentationTimeline } = await import('./presenterMix.js');
for (const route of ['clone', 'material', 'product'] as const) {
  for (const presenter of ['material', 'avatar', 'heygen'] as const) {
    const choice = normalizeVideoPlan({ ...video, route, presenter, referenceId: 'reference', materialIds: ['footage'], heygenAvatarId: 'avatar', avatarConsent: true });
    assert.deepEqual(videoPlanErrors(choice), []);
    assert.equal(normalizeVideoPlan(JSON.parse(JSON.stringify(choice))).presenter, presenter);
  }
}
const avatarPlan = normalizeVideoPlan({ ...video, presenter: 'avatar', heygenAvatarId: 'avatar', avatarConsent: true });
assert.deepEqual(videoPlanErrors(avatarPlan), []);
assert.ok(videoPlanErrors({ ...avatarPlan, route: 'material' }).length);
assert.ok(videoPlanErrors({ ...avatarPlan, avatarConsent: false }).length);
const customMix = normalizeVideoPlan({ ...avatarPlan, presenter: 'heygen', materialIds: ['footage'], scenePlan: [
  { source: 'material', materialId: 'footage' }, { source: 'avatar', materialId: '' }, { source: 'material', materialId: 'footage' },
] });
assert.deepEqual(presentationScenes(normalizeVideoPlan(JSON.parse(JSON.stringify(customMix))), 3), customMix.scenePlan);
assert.throws(() => presentationScenes({ ...customMix, materialIds: [] }, 3));
assert.throws(() => presentationScenes(customMix, 4));
assert.throws(() => presentationScenes({ ...customMix, scenePlan: customMix.scenePlan!.map(() => ({ source: 'avatar', materialId: '' })) }, 3));
const footage = { name: 'Footage', type: 'video', url: '/footage.mp4', targetDuration: 4 };
const customTimeline = buildPresentationTimeline('heygen', '/avatar.mp4', [4, 5, 6], [{ source: 'material', clip: footage }, { source: 'avatar' }, { source: 'material', clip: footage }]);
assert.equal(customTimeline[1].trimStart, 4);
assert.equal(customTimeline[1].trimEnd, 9);
assert.equal(customTimeline[0].url, '/footage.mp4');
assert.throws(() => buildPresentationTimeline('heygen', '/avatar.mp4', [4, 5], [{ source: 'avatar' }, { source: 'material' }]));
assert.throws(() => buildPresentationTimeline('material', '/avatar.mp4', [4], [{ source: 'avatar' }]));
assert.throws(() => buildPresentationTimeline('avatar', '/avatar.mp4', [4], [{ source: 'material', clip: footage }]));
assert.deepEqual(buildPresentationTimeline('avatar', '/avatar.mp4', [4, 5], [{ source: 'avatar' }, { source: 'avatar' }]).map(row => row.trimStart), [0, 4]);
assert.notEqual(contentAcceptanceHash({ ...spec, presentationMode: 'avatar' }), contentAcceptanceHash({ ...spec, presentationMode: 'heygen' }));
console.log('Presentation modes and arbitrary scene selection regressions passed');

const { chooseMusic } = await import('./automaticMusic.js');
const musicCatalog = [{ id: 'a', name: 'A', mood: '克制' }, { id: 'b', name: 'B', mood: '积极' }];
assert.equal(chooseMusic('{"ids":["a","b"]}', musicCatalog, ['a'], () => 0).track.id, 'b');
assert.equal(chooseMusic('{"ids":["a","b"]}', musicCatalog, [], () => 1).track.id, 'b');
assert.equal(chooseMusic('{"ids":["a","a","foreign"]}', musicCatalog, [], () => 0).candidates.length, 1);
assert.throws(() => chooseMusic('{"ids":["foreign"]}', musicCatalog));
assert.throws(() => chooseMusic('not json', musicCatalog));
assert.notEqual(contentAcceptanceHash({ ...spec, bgm: 'a', bgmVol: 24 }), contentAcceptanceHash({ ...spec, bgm: 'b', bgmVol: 24 }));
assert.notEqual(contentAcceptanceHash({ ...spec, bgm: 'a', bgmVol: 24 }), contentAcceptanceHash({ ...spec, bgm: 'a', bgmVol: 0 }));
console.log('Automatic music selection and acceptance regressions passed');

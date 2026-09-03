import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIGITAL_HUMAN_PIPELINE_VERSION } from '../src/lib/digitalHumanPipeline.js';
import type { AvatarMotionClip } from '../src/lib/digitalHumanPerformance.js';
import {
  buildDigitalHumanRenderTreatmentAudit,
  buildDigitalHumanRenderTreatmentReceipt,
} from '../server/lib/digitalHumanRenderTreatment.js';
import { buildDigitalHumanSegmentProvenance } from '../server/lib/digitalHumanTimelineIntegrity.js';
import {
  DEFAULT_PROJECT_ID,
  DEFAULT_PERFORMANCE_PROFILE_PATH,
  PERFORMANCE_PROFILE_SCHEMA_VERSION,
  REQUIRED_LANGUAGES,
  assertCompletedJobResult,
  assertProjectInputsUnchanged,
  assertSavedRoundTrip,
  buildPreparedPlan,
  buildRenderRequests,
  loadPerformanceProfile,
  matchDesiredJobs,
  mergeVerifiedProject,
  parseCliOptions,
  parsePerformanceProfile,
  type DigitalHumanJob,
  type Material,
  type PerformanceProfile,
  type StudioProject,
  type VerifiedResult,
} from './orchestrate-digital-human-p1.js';

const paragraphs = {
  zh: ['改善置业，别只看总价。', '把通勤、空间和成本放在一起比较。', '房源条件逐项核实，判断才更稳。', '私信领取户型与预算对比清单。'],
  en: ["Upgrading homes? Don't compare price alone.", 'Put access, living space, and total cost side by side.', 'Verify every property detail before deciding.', 'Message us for the layout and budget checklist.'],
  es: ['¿Buscas una vivienda mejor? No compares solo el precio.', 'Pon acceso, espacio y coste total lado a lado.', 'Verifica cada dato del inmueble antes de decidir.', 'Escríbenos para recibir la lista de planos y presupuestos.'],
} as const;

const ranges = [[0, 3], [3, 6.7], [6.7, 10.6], [10.6, 15]] as const;
const cuesFor = (language: keyof typeof paragraphs) => paragraphs[language].map((text, index) => ({
  text,
  start: ranges[index]![0],
  end: ranges[index]![1],
}));

const storyboard = `[0-3s]
景别：中近景
台词：改善置业，别只看总价。
[3-6.7s]
景别：中景
台词：预算、通勤、空间三项一起比较。
[6.7-10.6s]
景别：全景
台词：房源条件逐项核实，判断才更稳。
[10.6-15s]
景别：中近景
台词：私信领取户型与预算对比清单。`;

const project: StudioProject = {
  id: DEFAULT_PROJECT_ID,
  title: 'P1 fixture',
  status: 'draft',
  thumbSeed: 'fixture',
  spec: {
    ratio: '9:16', duration: 15, platform: 'tiktok', script: storyboard,
    voiceoverMode: 'ai', voiceoverStaleLangs: [], voiceLangs: [...REQUIRED_LANGUAGES], activeVoiceLang: 'zh',
    voiceDrafts: Object.fromEntries(REQUIRED_LANGUAGES.map(language => [language, paragraphs[language].join('\n')])),
    voiceoverAudios: Object.fromEntries(REQUIRED_LANGUAGES.map(language => [language, {
      url: `/tts/tenants/test/${language}.wav`, duration: 15, cues: cuesFor(language),
    }])),
    alignedCuesByLang: Object.fromEntries(REQUIRED_LANGUAGES.map(language => [language, cuesFor(language)])),
    shotMediaModes: { 'slot-1': 'digital', 'slot-2': 'digital', 'slot-4': 'digital' },
    shotPreferredAvatarIds: {}, shotDigitalHumanBindings: {},
    storyboardAssignments: { 'slot-3': 'broll-1' },
    storyboardAssemblies: [{ id: 'video-1', name: '视频1', assignments: { 'slot-3': 'broll-1' }, selected: ['broll-1'], sourcePlans: {} }],
    activeAssemblyId: 'video-1', selected: ['broll-1'],
    subtitlesOn: true, bgm: '', bgmVol: 25, voiceVol: 100, voice: 'fixture-voice', cover: '', coverTitle: '', coverStyle: {},
  },
};

const avatar: Material = {
  id: 'avatar-1', avatarId: 'avatar-1', name: 'Avatar', folder: 'presenter', type: 'video', duration: 10,
  width: 1080, height: 1920, url: '/media/avatar.mp4', assetRole: 'avatar_master', scope: 'own',
  rightsStatus: 'commercial_cleared', rightsUsageScope: ['internal_preview'], productionReady: true,
  avatarVersion: 1,
};

function motionMaterial(gesture: AvatarMotionClip['gesture'], index: number): Material {
  const clip: AvatarMotionClip = {
    id: `motion-clip-${index}`, avatarId: avatar.id, materialId: `motion-material-${index}`,
    gesture, emotion: gesture === 'cta' ? 'friendly' : 'confident', intensity: 0.6,
    shotSize: 'medium', gaze: 'camera', safeStartMs: 0, safeEndMs: 3000,
    rightsStatus: 'commercial_cleared', version: 1, sourceHash: `hash-${index}`,
  };
  return {
    id: clip.materialId, name: String(gesture), folder: 'presenter', type: 'video', duration: 3,
    url: `/media/${clip.materialId}.mp4`, assetRole: 'avatar_motion_clip', avatarId: avatar.id,
    rightsStatus: 'commercial_cleared', rightsUsageScope: ['internal_preview'], productionReady: true, motionClip: clip,
  };
}

const broll: Material = {
  id: 'broll-1', name: 'B-roll', folder: 'scene', type: 'video', duration: 8,
  width: 1080, height: 1350, url: '/media/broll.mp4', scope: 'own', sourceType: 'licensed-stock',
};
const materials = [avatar, broll, motionMaterial('open_palm', 1), motionMaterial('emphasis', 2), motionMaterial('point_right', 3), motionMaterial('cta', 4)];

function rawProfile(profileId = 'fixture-profile-v1') {
  const languageProfile = () => ({
    'slot-1': { motionProfileId: 'cta-hook-v1', gesture: 'cta', beatStrategy: 'single_continuous_clip', motionClipIds: ['motion-clip-4'] },
    'slot-2': { motionProfileId: 'emphasis-framework-v1', gesture: 'emphasis', beatStrategy: 'single_continuous_clip', motionClipIds: ['motion-clip-2'] },
    'slot-4': { motionProfileId: 'cta-close-v1', gesture: 'cta', beatStrategy: 'single_continuous_clip', motionClipIds: ['motion-clip-4'] },
  });
  return {
    schemaVersion: PERFORMANCE_PROFILE_SCHEMA_VERSION,
    profileId,
    avatarMaterialId: avatar.id,
    languages: { zh: languageProfile(), en: languageProfile(), es: languageProfile() },
  };
}

const performanceProfile = parsePerformanceProfile(rawProfile());
const checkedInProfile = loadPerformanceProfile(DEFAULT_PERFORMANCE_PROFILE_PATH);
assert.equal(checkedInProfile.avatarMaterialId, 'avatar-pexels-8048481-v1');
for (const language of REQUIRED_LANGUAGES) {
  assert.equal(checkedInProfile.languages[language]['slot-1'].gesture, 'cta');
  assert.equal(checkedInProfile.languages[language]['slot-2'].gesture, 'emphasis');
  assert.equal(checkedInProfile.languages[language]['slot-4'].gesture, 'cta');
  assert.ok((['slot-1', 'slot-2', 'slot-4'] as const).every(slot => checkedInProfile.languages[language][slot].beatStrategy === 'single_continuous_clip'));
  assert.ok((['slot-1', 'slot-2', 'slot-4'] as const).every(slot => checkedInProfile.languages[language][slot].motionClipIds.length === 1));
}

assert.deepEqual(parseCliOptions([], { LINGSHU_TOKEN: 'fixture' }).stages, ['plan']);
assert.throws(() => parseCliOptions(['--stages', 'submit'], {}), /--apply/);
assert.throws(() => parseCliOptions(['--stages', 'submit', '--apply'], {}), /--confirm-rights/);
assert.throws(() => parseCliOptions(['--stages', 'save', '--apply'], {}), /--confirm-editor-closed/);
assert.throws(() => parseCliOptions(['--stages', 'render-plan,authorize-render', '--apply', '--confirm-render-quota'], {}), /authorization-output/);
assert.throws(() => parseCliOptions(['--base-url', 'https://example.com'], {}), /--allow-remote/);
assert.equal(parseCliOptions([], {}).performanceProfilePath, DEFAULT_PERFORMANCE_PROFILE_PATH);
assert.throws(() => parsePerformanceProfile({ ...rawProfile(), languages: { zh: rawProfile().languages.zh, en: rawProfile().languages.en } }), /exactly/);
const repeatedGesture = structuredClone(rawProfile());
repeatedGesture.languages.zh['slot-2'] = { motionProfileId: 'bad-repeat-v1', gesture: 'cta', beatStrategy: 'single_continuous_clip', motionClipIds: ['motion-clip-4'] };
assert.throws(() => parsePerformanceProfile(repeatedGesture), /adjacent digital slots cannot repeat/);
const resettingMultiClip = structuredClone(rawProfile());
resettingMultiClip.languages.en['slot-1'].motionClipIds = ['motion-clip-4', 'motion-clip-4'];
assert.throws(() => parsePerformanceProfile(resettingMultiClip), /exactly one motionClipId/);
const missingStrategy = structuredClone(rawProfile()) as any;
delete missingStrategy.languages.es['slot-4'].beatStrategy;
assert.throws(() => parsePerformanceProfile(missingStrategy), /must contain exactly/);

const plan = buildPreparedPlan({ project, materials, performanceProfile, avatarId: avatar.id, performanceRevision: 0 });
assert.equal(plan.variants.length, 9);
assert.equal(plan.batches.length, 3);
assert.ok(plan.batches.every(batch => batch.variants.length === 3));
assert.ok(plan.variants.every(variant => variant.request.pipelineVersion === DIGITAL_HUMAN_PIPELINE_VERSION));
assert.ok(plan.variants.every(variant => variant.inputSignature.includes(performanceProfile.fingerprint)), 'profile fingerprint must enter every client signature');
assert.ok(plan.variants.every(variant => variant.performanceSignature === variant.inputSignature));
assert.equal(new Set(plan.variants.map(variant => variant.sourceFingerprint)).size, 9, 'slot/language source identities must never cross-bind');
assert.ok(plan.variants.every(variant => variant.motionClipIds.length === 1));
assert.ok(plan.variants.every(variant => variant.request.performancePlan.beats.length === 1));
assert.deepEqual([...new Set(plan.batches.flatMap(batch => batch.variants.map(variant => variant.language)))].sort(), ['en', 'es', 'zh']);
assert.deepEqual([...new Set(plan.variants.filter(item => item.slotId === 'slot-1').map(item => item.request.performancePlan.scene.camera))], ['locked']);
assert.deepEqual([...new Set(plan.variants.filter(item => item.slotId === 'slot-2').map(item => item.request.performancePlan.scene.camera))], ['push_in']);
assert.ok(plan.variants.every(variant => variant.avatarMaterialId === avatar.id), 'all nine tasks must use one identity');
for (const language of REQUIRED_LANGUAGES) {
  const gestures = ['slot-1', 'slot-2', 'slot-4'].map(slotId => plan.variants.find(item => item.language === language && item.slotId === slotId)!.request.performancePlan.orchestrationProfile.gesture);
  assert.deepEqual(gestures, ['cta', 'emphasis', 'cta']);
  assert.notEqual(gestures[0], gestures[1]);
  assert.notEqual(gestures[1], gestures[2]);
}
const enHook = plan.variants.find(item => item.language === 'en' && item.slotId === 'slot-1')!;
const enHookAudit = enHook.request.performancePlan.orchestrationProfile;
assert.equal(enHookAudit.beatStrategy, 'single_continuous_clip');
assert.equal(enHookAudit.originalBeatCount, 2, 'the two English hook semantics must be explicitly recorded');
assert.equal(enHookAudit.sourceBeatDecisions.length, 2);
assert.equal(enHookAudit.sourceBeatDecisions.map(item => item.text).join(' '), enHook.speech.text);
const enExecutable = enHook.request.performancePlan.beats[0]!;
const dominantSourceDecision = enHookAudit.sourceBeatDecisions.find(item => item.id === enHookAudit.dominantSourceBeatId)!;
assert.equal(enExecutable.startMs, 0);
assert.equal(enExecutable.endMs, enHook.request.performancePlan.durationMs);
assert.equal(enExecutable.expression, enHookAudit.mergedDecision.expression);
assert.equal(enExecutable.head, enHookAudit.mergedDecision.head);
assert.equal(enExecutable.gaze, enHookAudit.mergedDecision.gaze);
assert.equal(enExecutable.expression, dominantSourceDecision.expression);
assert.equal(enExecutable.head, dominantSourceDecision.head);
assert.equal(enExecutable.gaze, dominantSourceDecision.gaze);
assert.equal(enExecutable.actionPeakMs, enHookAudit.mergedDecision.actionPeakMs);
assert.ok(enExecutable.actionPeakMs > 0 && enExecutable.actionPeakMs < enExecutable.endMs);
const repeatedPlan = buildPreparedPlan({ project, materials, performanceProfile, performanceRevision: 0 });
assert.deepEqual(
  repeatedPlan.variants.find(item => item.key === enHook.key)!.request.performancePlan.orchestrationProfile,
  enHookAudit,
  'semantic merge and action peak must be deterministic',
);
const alternateProfile: PerformanceProfile = parsePerformanceProfile(rawProfile('fixture-profile-v2'));
const alternatePlan = buildPreparedPlan({ project, materials, performanceProfile: alternateProfile, performanceRevision: 0 });
assert.notEqual(alternatePlan.variants[0]!.inputSignature, plan.variants[0]!.inputSignature, 'profile fingerprint must distinguish client signatures');
assert.equal(alternatePlan.variants[0]!.sourceFingerprint, plan.variants[0]!.sourceFingerprint, 'performance profile changes must not make an unchanged business source stale');
const wrongMotionProfile = structuredClone(rawProfile());
wrongMotionProfile.languages.zh['slot-1'] = { motionProfileId: 'wrong-motion-v1', gesture: 'cta', beatStrategy: 'single_continuous_clip', motionClipIds: ['motion-clip-2'] };
assert.throws(() => buildPreparedPlan({ project, materials, performanceProfile: parsePerformanceProfile(wrongMotionProfile) }), /expects cta/);
assert.throws(() => buildPreparedPlan({ project, materials, performanceProfile, avatarId: 'another-avatar' }), /conflicts with profile avatar/);

const jobs: DigitalHumanJob[] = plan.variants.map((variant, index) => {
  const outputSha256 = (index % 10).toString().repeat(64);
  const treatmentReceipt = buildDigitalHumanRenderTreatmentReceipt({
    attempt: 1,
    treatmentId: 'baseline_unsharp',
    renderContext: 'performance',
    baseRenderFingerprint: 'b'.repeat(64),
    inputSha256: 'c'.repeat(64),
    outputSha256,
    qualityPassed: true,
    appliedAt: `2026-09-03T00:00:${String(index).padStart(2, '0')}.000Z`,
  });
  return {
    id: `job-${index}`, projectId: project.id, storyboardSlotId: variant.slotId,
    audioStartSeconds: variant.speech.start, audioEndSeconds: variant.speech.end,
    inputSignature: `digital-human-input-v2:${String(index).padStart(64, '0')}`,
    sourceFingerprint: variant.sourceFingerprint,
    performanceSignature: `digital-human-input-v2:${String(index).padStart(64, '0')}`,
    avatarMaterialId: avatar.id, language: variant.language,
    status: 'completed', outputMaterialId: `output-${index}`, resultSha256: outputSha256,
    qualityReport: {
      passed: true,
      validationStatus: 'passed',
      reviewRequired: false,
      outputSha256,
      gateVersion: 'commercial-v1+server-media-v1',
      validatorVersion: 'final-quality-v2.4.0',
      serverValidation: { passed: true },
      renderTreatmentAudit: buildDigitalHumanRenderTreatmentAudit([treatmentReceipt], 1),
    },
    motionClipIds: variant.motionClipIds, performancePlan: variant.request.performancePlan,
    pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
    createdAt: `2026-09-03T00:00:${String(index).padStart(2, '0')}Z`,
  };
});
const matching = matchDesiredJobs(plan, [
  ...jobs,
  { ...jobs[0]!, id: 'wrong-project', projectId: 'other-project', createdAt: '2099-01-01T00:00:00Z' },
  { ...jobs[1]!, id: 'wrong-signature', performanceSignature: 'client-lookalike', createdAt: '2099-01-01T00:00:00Z' },
  { ...jobs[2]!, id: 'old-profile', pipelineVersion: 'digital-human-v2-p0', performancePlan: undefined, createdAt: '2099-01-01T00:00:00Z' },
]);
assert.equal(matching.size, 9);
assert.notEqual(matching.get(plan.variants[0]!.key)?.id, 'wrong-project');
assert.notEqual(matching.get(plan.variants[2]!.key)?.id, 'old-profile');

const verified = new Map<string, VerifiedResult>();
plan.variants.forEach((variant, index) => {
  const job = jobs[index]!;
  const material: Material = {
    id: job.outputMaterialId!, name: `${variant.key} output`, folder: 'digital-human', type: 'video', duration: variant.speech.end - variant.speech.start,
    width: 1080, height: 1920, url: `/media/${job.outputMaterialId}.mp4`, sourceType: 'digital-human', assetRole: 'generated_clip',
  };
  assertCompletedJobResult(plan, variant, job, material);
  verified.set(variant.key, { variant, job, material, provenance: buildDigitalHumanSegmentProvenance(job) });
});
assert.throws(() => assertCompletedJobResult(plan, plan.variants[0]!, { ...jobs[0]!, qualityReport: { passed: false } }, verified.get(plan.variants[0]!.key)?.material), /failed closed/);

const merged = mergeVerifiedProject(project, plan, verified);
assertSavedRoundTrip(merged, plan, verified);
assert.throws(() => assertProjectInputsUnchanged({
  ...project,
  spec: {
    ...project.spec,
    voiceDrafts: { ...(project.spec.voiceDrafts as Record<string, string>), zh: '输入已经发生变化。\n第二段。\n第三段。\n第四段。' },
  },
}, plan), /changed while jobs were running/);
const mergedAssignments = merged.spec.storyboardAssignments as Record<string, string>;
assert.equal(Object.keys(mergedAssignments).length, 10);
assert.equal(mergedAssignments['slot-3'], broll.id);

const requests = buildRenderRequests({ project: merged, plan, verified, targetDuration: 15 });
for (const language of REQUIRED_LANGUAGES) {
  const request = requests[language];
  assert.equal(request.duration, 15);
  assert.equal(request.ratio, '9:16');
  assert.equal(request.timeline.length, 4);
  assert.equal(request.timeline.filter(item => item.digitalHumanGenerated).length, 3);
  assert.equal(request.orchestrationProfile.fingerprint, performanceProfile.fingerprint);
  assert.equal(request.orchestrationProfile.avatarMaterialId, avatar.id);
  assert.ok(request.timeline.filter(item => item.digitalHumanGenerated).every(item => item.performanceProfileFingerprint === performanceProfile.fingerprint));
  assert.ok(request.timeline.filter(item => item.digitalHumanGenerated).every(item => item.beatStrategy === 'single_continuous_clip'));
  assert.ok(request.timeline.filter(item => item.digitalHumanGenerated).every(item => Number(item.originalBeatCount) >= 1 && Boolean(item.mergedDecision)));
  assert.ok(request.timeline.filter(item => item.digitalHumanGenerated).every(item => item.speed === 1 && item.trimStart === 0));
  assert.ok(request.timeline.filter(item => item.digitalHumanGenerated).every(item => (
    Math.abs(item.targetStart - item.digitalHumanSegment!.audioStartSeconds) <= 0.002
    && Math.abs(item.targetEnd - item.digitalHumanSegment!.audioEndSeconds) <= 0.002
  )));
  assert.equal(request.timeline[2]!.clipId, broll.id);
  assert.equal(request.timeline[2]!.targetStart, 6.7);
  assert.equal(request.timeline[2]!.targetEnd, 10.6);
  assert.equal(request.timeline[3]!.targetEnd, 15);
  assert.ok(Math.abs(request.timeline.reduce((sum, item) => sum + item.targetDuration, 0) - 15) < 0.002);
  assert.ok(request.subtitles.cues.length >= 4);
  assert.ok(request.subtitles.cues.every(cue => cue.start >= 0 && cue.end <= 15 && cue.end > cue.start));
  assert.equal(request.digitalHumanSegments.segments.length, 3);
  assert.match(request.digitalHumanSegments.fingerprint, /^[a-f0-9]{64}$/);
}

const badTtsProject = structuredClone(merged);
(badTtsProject.spec.voiceoverAudios as Record<string, { duration: number }>).zh!.duration = 14.4;
assert.throws(() => buildRenderRequests({ project: badTtsProject, plan, verified, targetDuration: 15 }), /14\.5-15\.5/);
assert.throws(() => buildRenderRequests({ project: merged, plan, verified, targetDuration: 14.9 }), /exactly 15s/);

const allowedPaddedTtsProject = structuredClone(merged);
(allowedPaddedTtsProject.spec.voiceoverAudios as Record<string, { duration: number }>).zh!.duration = 15.5;
assert.deepEqual(
  buildRenderRequests({ project: allowedPaddedTtsProject, plan, verified, targetDuration: 15 }).zh.subtitles.cues,
  cuesFor('zh'),
  'allowed TTS padding must not scale or retime speech cues',
);

const tamperedVerified = new Map(verified);
const tamperedEntry = structuredClone(tamperedVerified.get('zh::slot-1')!);
tamperedEntry.provenance.workerOutputSha256 = 'f'.repeat(64);
tamperedVerified.set('zh::slot-1', tamperedEntry);
assert.throws(() => buildRenderRequests({ project: merged, plan, verified: tamperedVerified, targetDuration: 15 }), /任务记录不一致/);

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'orchestrate-digital-human-p1.ts');
const source = fs.readFileSync(scriptPath, 'utf8');
assert.ok(!source.includes('/render' + '/local'), 'orchestrator must never call the local renderer endpoint');
assert.ok(!/LINGSHU_PASSWORD\s*=\s*['"`]/.test(source), 'password values must never be embedded in source');
assert.match(source, /values\.get\('stages'\) \|\| 'plan'/, 'default stage must remain read-only plan');

console.log('orchestrate-digital-human-p1 tests passed');

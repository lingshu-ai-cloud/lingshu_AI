import assert from 'node:assert/strict';
import {
  buildDigitalHumanRenderTreatmentAudit,
  buildDigitalHumanRenderTreatmentReceipt,
} from './digitalHumanRenderTreatment.js';
import {
  DIGITAL_HUMAN_RENDER_DURATION_SECONDS,
  assertDigitalHumanTtsDuration,
  assertRequestedDigitalHumanProvenance,
  buildDigitalHumanSegmentProvenance,
  freezeDigitalHumanSegments,
  verifyFrozenDigitalHumanSegments,
} from './digitalHumanTimelineIntegrity.js';
import { DIGITAL_HUMAN_PIPELINE_VERSION } from '../../src/lib/digitalHumanPipeline.js';

const outputSha = 'a'.repeat(64);
const baseSha = 'b'.repeat(64);
const inputSha = 'c'.repeat(64);
const receipt = buildDigitalHumanRenderTreatmentReceipt({
  attempt: 1,
  treatmentId: 'baseline_unsharp',
  renderContext: 'performance',
  baseRenderFingerprint: baseSha,
  inputSha256: inputSha,
  outputSha256: outputSha,
  qualityPassed: true,
  appliedAt: '2026-09-03T00:00:00.000Z',
});

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-zh-1', tenantId: 'tenant-1', projectId: 'project-1', storyboardSlotId: 'slot-1',
    status: 'completed', language: 'zh', outputMaterialId: 'clip-1',
    inputSignature: 'input-signature', sourceFingerprint: 'base-source-signature',
    pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
    avatarMaterialId: 'avatar-1', performanceSignature: 'performance-signature',
    motionClipIds: ['motion-1'], resultSha256: outputSha,
    audioStartSeconds: 0, audioEndSeconds: 3,
    performancePlan: { orchestrationProfile: {
      profileId: 'profile-1', fingerprint: 'd'.repeat(64), motionProfileId: 'hook-1',
      gesture: 'cta', beatStrategy: 'single_continuous_clip', originalBeatCount: 2,
    } },
    qualityReport: {
      passed: true, validationStatus: 'passed', reviewRequired: false, outputSha256: outputSha,
      gateVersion: 'commercial-v1+server-media-v1', validatorVersion: 'final-quality-v2.4.0',
      serverValidation: { passed: true },
      renderTreatmentAudit: buildDigitalHumanRenderTreatmentAudit([receipt], 1),
    },
    ...overrides,
  };
}

const provenance = buildDigitalHumanSegmentProvenance(job());
assert.equal(provenance.workerOutputSha256, outputSha);
assert.equal(provenance.treatmentId, 'baseline_unsharp');
assert.equal(provenance.audioEndSeconds, 3);
assert.doesNotThrow(() => assertRequestedDigitalHumanProvenance(structuredClone(provenance), provenance));
assert.throws(() => assertRequestedDigitalHumanProvenance({ ...provenance, workerOutputSha256: 'f'.repeat(64) }, provenance), /tenant|\u79df\u6237|record|\u8bb0\u5f55/i);
assert.equal(buildDigitalHumanSegmentProvenance(job({ language: 'en' })).language, 'en'); // render language is checked when frozen
const missingServerValidation = job();
delete (missingServerValidation.qualityReport as Record<string, unknown>).serverValidation;
assert.throws(() => buildDigitalHumanSegmentProvenance(missingServerValidation), /媒体复验/);

const heygenProvenance = buildDigitalHumanSegmentProvenance(job({
  provider: 'heygen',
  outputDurationSeconds: 4.68,
  performancePlan: undefined,
  motionClipIds: undefined,
  qualityReport: {
    passed: true, validationStatus: 'passed', reviewRequired: false, outputSha256: outputSha,
    gateVersion: 'commercial-v1+server-media-v1', validatorVersion: 'heygen-server-quality-v1',
    serverValidation: { passed: true, durationSeconds: 4.68 },
  },
}));
assert.equal(heygenProvenance.outputDurationSeconds, 4.68);
assert.equal(heygenProvenance.provider, 'heygen');
assert.equal(heygenProvenance.treatmentId, undefined, 'HeyGen output must not invent a local render-treatment receipt');

assert.equal(assertDigitalHumanTtsDuration(14.5), 14.5);
assert.equal(assertDigitalHumanTtsDuration(15.5), 15.5);
assert.throws(() => assertDigitalHumanTtsDuration(14.499), /14\.5-15\.5/);
assert.throws(() => assertDigitalHumanTtsDuration(15.501), /14\.5-15\.5/);

const timeline = [
  {
    clipId: 'clip-1', type: 'video', digitalHumanGenerated: true,
    trimStart: 0, trimEnd: 3, speed: 1, targetStart: 0, targetEnd: 3, targetDuration: 3,
    digitalHumanSegment: provenance,
  },
  {
    clipId: 'broll-1', type: 'video', digitalHumanGenerated: false,
    trimStart: 0, trimEnd: 7.6, speed: 1, targetStart: 3, targetEnd: 10.6, targetDuration: 7.6,
  },
  {
    clipId: 'clip-2', type: 'video', digitalHumanGenerated: true,
    trimStart: 0, trimEnd: 4.4, speed: 1, targetStart: 10.6, targetEnd: 15, targetDuration: 4.4,
    digitalHumanSegment: buildDigitalHumanSegmentProvenance(job({
      id: 'job-zh-2', storyboardSlotId: 'slot-4', outputMaterialId: 'clip-2',
      audioStartSeconds: 10.6, audioEndSeconds: 15, inputSignature: 'input-2',
    })),
  },
];
const frozen = freezeDigitalHumanSegments(timeline, DIGITAL_HUMAN_RENDER_DURATION_SECONDS, 'zh');
assert.equal(frozen.segments.length, 2);
assert.equal(verifyFrozenDigitalHumanSegments({ timeline, frozen, renderDurationSeconds: 15, language: 'zh' }).passed, true);

for (const language of ['zh', 'en', 'es']) {
  const localizedTimeline = structuredClone(timeline);
  for (const item of localizedTimeline) {
    if (item.digitalHumanSegment) item.digitalHumanSegment.language = language;
  }
  const localizedFrozen = freezeDigitalHumanSegments(localizedTimeline, 15, language);
  assert.equal(
    verifyFrozenDigitalHumanSegments({ timeline: localizedTimeline, frozen: localizedFrozen, renderDurationSeconds: 15, language }).passed,
    true,
    `${language} absolute timeline must preserve all worker-gated segments`,
  );
}

const changedSpeed = structuredClone(timeline);
changedSpeed[0]!.speed = 1.01;
assert.throws(() => freezeDigitalHumanSegments(changedSpeed, 15, 'zh'), /变速/);

const changedTrim = structuredClone(timeline);
changedTrim[0]!.trimStart = 0.1;
assert.throws(() => freezeDigitalHumanSegments(changedTrim, 15, 'zh'), /裁切/);

const relocatedHeygenTimeline = [
  {
    clipId: 'broll-before', type: 'video', digitalHumanGenerated: false,
    trimStart: 0, trimEnd: 2, speed: 1, targetStart: 0, targetEnd: 2, targetDuration: 2,
  },
  {
    clipId: 'clip-1', type: 'video', digitalHumanGenerated: true,
    trimStart: 0, trimEnd: 4.68, speed: 1, targetStart: 2, targetEnd: 6.68, targetDuration: 4.68,
    digitalHumanSegment: heygenProvenance,
  },
  {
    clipId: 'broll-after', type: 'video', digitalHumanGenerated: false,
    trimStart: 0, trimEnd: 8.32, speed: 1, targetStart: 6.68, targetEnd: 15, targetDuration: 8.32,
  },
];
assert.doesNotThrow(() => freezeDigitalHumanSegments(relocatedHeygenTimeline, 15, 'zh'));

const wrongLanguage = structuredClone(timeline);
wrongLanguage[0]!.digitalHumanSegment!.language = 'en';
assert.throws(() => freezeDigitalHumanSegments(wrongLanguage, 15, 'zh'), /语言/);

const tamperedSha = structuredClone(timeline);
tamperedSha[0]!.digitalHumanSegment!.workerOutputSha256 = 'f'.repeat(64);
const tamperedReport = verifyFrozenDigitalHumanSegments({ timeline: tamperedSha, frozen, renderDurationSeconds: 15, language: 'zh' });
assert.equal(tamperedReport.passed, false);
assert.match(tamperedReport.failures.join('\n'), /不一致/);

const changedAfterFreeze = structuredClone(timeline);
changedAfterFreeze[1]!.targetEnd = 10.7;
changedAfterFreeze[1]!.targetDuration = 7.7;
assert.equal(verifyFrozenDigitalHumanSegments({ timeline: changedAfterFreeze, frozen, renderDurationSeconds: 15, language: 'zh' }).passed, false);

const compositorWouldClamp = structuredClone(timeline);
compositorWouldClamp[1]!.targetEnd = 3.4;
compositorWouldClamp[1]!.targetDuration = 0.4;
compositorWouldClamp[2]!.targetStart = 3.4;
assert.throws(() => freezeDigitalHumanSegments(compositorWouldClamp, 15, 'zh'), /时长不一致/);

assert.throws(() => freezeDigitalHumanSegments(timeline, 14.9, 'zh'), /精确/);

console.log('digital human timeline integrity tests passed');

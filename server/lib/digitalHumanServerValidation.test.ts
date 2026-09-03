import assert from 'node:assert/strict';
import {
  assessDigitalHumanMediaProbe,
  digitalHumanProviderQualityFailures,
  parseFfmpegProbeText,
  parseFfprobeJson,
} from './digitalHumanServerValidation.js';
import {
  DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
  buildDigitalHumanRenderTreatmentAudit,
  buildDigitalHumanRenderTreatmentReceipt,
} from './digitalHumanRenderTreatment.js';

const parsed = parseFfprobeJson(JSON.stringify({
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920 },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '3.200' },
}));
assert.deepEqual(parsed, {
  durationSeconds: 3.2, width: 1080, height: 1920, formatName: 'mov,mp4,m4a,3gp,3g2,mj2', videoCodec: 'h264', audioCodec: 'aac',
});

const fallback = parseFfmpegProbeText(`
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'sample.mp4':
Duration: 00:00:03.20, start: 0.000000, bitrate: 1234 kb/s
Stream #0:0: Video: h264 (High), yuv420p, 1080x1920, 25 fps
Stream #0:1: Audio: aac (LC), 44100 Hz, mono
`);
assert.equal(fallback.durationSeconds, 3.2);
assert.equal(fallback.width, 1080);
assert.equal(fallback.height, 1920);
assert.match(String(fallback.formatName), /mp4/);
assert.equal(fallback.videoCodec, 'h264');
assert.equal(fallback.audioCodec, 'aac');

assert.deepEqual(assessDigitalHumanMediaProbe({
  decodePassed: true, probeEngine: 'ffprobe', durationSeconds: 3.2,
  width: 1080, height: 1920, formatName: 'mov,mp4,m4a', videoCodec: 'h264', audioCodec: 'aac',
}, { expectedDurationSeconds: 3.2 }), []);
const invalidMedia = assessDigitalHumanMediaProbe({
  decodePassed: false, probeEngine: 'ffprobe', durationSeconds: 8,
  width: 1920, height: 1080, formatName: 'matroska,webm', videoCodec: 'hevc', audioCodec: 'mp3',
}, { expectedDurationSeconds: 3.2 });
assert.match(invalidMedia.join(' '), /无法完整解码/);
assert.match(invalidMedia.join(' '), /9:16/);
assert.match(invalidMedia.join(' '), /H\.264/);
assert.match(invalidMedia.join(' '), /AAC/);
assert.match(invalidMedia.join(' '), /时长偏离/);

const quality = {
  passed: true, validationStatus: 'passed', reviewRequired: false,
  outputSha256: 'a'.repeat(64), width: 1080, height: 1920, videoCodec: 'h264', audioCodec: 'aac',
  lipSyncScore: 5, avOffsetFrames: 0, freezeSegments: 0,
  durationSeconds: 3.2, faceDetectionRate: 0.99, mouthJumpP95: 0.04, validatorVersion: 'final-quality-v2.0.0', failures: [],
};
const measured = {
  sha256: 'a'.repeat(64), durationSeconds: 3.2, width: 1080, height: 1920, videoCodec: 'h264', audioCodec: 'aac',
};
assert.deepEqual(digitalHumanProviderQualityFailures(quality, measured), []);
const renderTreatmentReceipt = buildDigitalHumanRenderTreatmentReceipt({
  attempt: 1,
  treatmentId: 'baseline_unsharp',
  renderContext: 'standard_vertical',
  baseRenderFingerprint: DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
  inputSha256: '9'.repeat(64),
  outputSha256: measured.sha256,
  qualityPassed: true,
  appliedAt: '2026-09-03T00:00:00.000Z',
});
const renderTreatmentAudit = buildDigitalHumanRenderTreatmentAudit([renderTreatmentReceipt], 1);
assert.deepEqual(digitalHumanProviderQualityFailures({ ...quality, renderTreatmentAudit }, measured, {
  requireP1RenderTreatmentAudit: true,
  expectedRenderContext: 'standard_vertical',
  expectedBaseRenderFingerprint: DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_RENDER_FINGERPRINT,
}), [], '服务端必须能验真完整P1渲染回执');
assert.match(digitalHumanProviderQualityFailures(quality, measured, {
  requireP1RenderTreatmentAudit: true,
  expectedRenderContext: 'standard_vertical',
}).join(' '), /回执验真失败/,
  '旧Worker未提交P1回执时必须拒绝');
assert.match(digitalHumanProviderQualityFailures({
  ...quality,
  renderTreatmentAudit: {
    ...renderTreatmentAudit,
    attempts: [{ ...renderTreatmentReceipt, filterSha256: '0'.repeat(64) }],
  },
}, measured, {
  requireP1RenderTreatmentAudit: true,
  expectedRenderContext: 'standard_vertical',
}).join(' '), /指纹/,
  '滤镜回执被篡改后服务端必须拒绝');
assert.match(digitalHumanProviderQualityFailures({ ...quality, faceDetectionRate: undefined }, measured).join(' '), /人脸跟踪率/);
assert.match(digitalHumanProviderQualityFailures({ ...quality, durationSeconds: 4 }, measured).join(' '), /实测不一致/);
assert.match(digitalHumanProviderQualityFailures({ ...quality, outputSha256: 'b'.repeat(64) }, measured).join(' '), /SHA256/);
assert.match(digitalHumanProviderQualityFailures(undefined, measured).join(' '), /未提交/);

console.log('digital human server-validation tests passed');

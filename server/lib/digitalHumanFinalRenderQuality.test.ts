import assert from 'node:assert/strict';
import {
  assessDigitalHumanFinalRenderFrameSample,
  digitalHumanFinalRenderFailures,
} from './digitalHumanFinalRenderQuality.js';
import type { DigitalHumanServerValidationReport } from './digitalHumanServerValidation.js';
import { DIGITAL_HUMAN_FROZEN_TIMELINE_VERSION } from './digitalHumanTimelineIntegrity.js';

const validMedia: DigitalHumanServerValidationReport = {
  validatorVersion: 'server-media-v1',
  passed: true,
  sha256: 'a'.repeat(64),
  sizeBytes: 1024,
  decodePassed: true,
  probeEngine: 'ffprobe',
  durationSeconds: 15,
  expectedDurationSeconds: 15,
  width: 1080,
  height: 1920,
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  videoCodec: 'h264',
  audioCodec: 'aac',
  failures: [],
};

const useful = assessDigitalHumanFinalRenderFrameSample(7.5, [
  'lavfi.signalstats.YMIN=16',
  'lavfi.signalstats.YMAX=235',
  'lavfi.signalstats.YAVG=96.4',
].join('\n'));
assert.equal(useful.measured, true);
assert.equal(useful.nonEmpty, true);
assert.equal(useful.dynamicRange, 219);

const black = assessDigitalHumanFinalRenderFrameSample(7.5, [
  'lavfi.signalstats.YMIN=16',
  'lavfi.signalstats.YMAX=16',
  'lavfi.signalstats.YAVG=16',
].join('\n'));
assert.equal(black.measured, true);
assert.equal(black.nonEmpty, false);

const passingFrames = { passed: true, minimumPassingSamples: 2, passingSamples: 3, samples: [useful, useful, useful] };
const passingTimeline = {
  schemaVersion: DIGITAL_HUMAN_FROZEN_TIMELINE_VERSION,
  passed: true,
  fingerprint: 'a'.repeat(64),
  segmentCount: 3,
  failures: [],
};
assert.deepEqual(digitalHumanFinalRenderFailures({ media: validMedia, nonEmptyFrames: passingFrames, timelineIntegrity: passingTimeline, expectedDurationSeconds: 15 }), []);

const wrongResolution = digitalHumanFinalRenderFailures({
  media: { ...validMedia, width: 720, height: 1280 },
  nonEmptyFrames: passingFrames,
  timelineIntegrity: passingTimeline,
  expectedDurationSeconds: 15,
});
assert.match(wrongResolution.join('\n'), /1080x1920/);

const missingTracks = digitalHumanFinalRenderFailures({
  media: { ...validMedia, passed: false, videoCodec: undefined, audioCodec: undefined, failures: ['成片缺少有效视频画面'] },
  nonEmptyFrames: { passed: false, minimumPassingSamples: 2, passingSamples: 0, samples: [black, black, black] },
  timelineIntegrity: passingTimeline,
  expectedDurationSeconds: 15,
});
assert.match(missingTracks.join('\n'), /缺少视频轨/);
assert.match(missingTracks.join('\n'), /缺少音频轨/);
assert.match(missingTracks.join('\n'), /无有效像素变化/);

const changedTimeline = digitalHumanFinalRenderFailures({
  media: validMedia,
  nonEmptyFrames: passingFrames,
  timelineIntegrity: {
    ...passingTimeline,
    passed: false,
    failures: ['数字人冻结片段证明与实际合成时间轴不一致'],
  },
  expectedDurationSeconds: 15,
});
assert.match(changedTimeline.join('\n'), /Worker 口型片段/);

console.log('digital human final render quality tests passed');

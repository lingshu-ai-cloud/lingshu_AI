import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import sharp from 'sharp';
import { evaluateStoryboardAcceptance, resolveEvidenceFile, type AcceptanceEvidence, type AcceptanceMatrix, type AcceptanceAttempt } from './storyboard-aigc-acceptance.js';

const matrixPath = path.resolve('fixtures/storyboard-aigc-acceptance/matrix.json');
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8')) as AcceptanceMatrix;
const empty = evaluateStoryboardAcceptance(matrix, { schemaVersion: 1, cases: [] }, path.dirname(matrixPath), process.cwd());
assert.equal(empty.status, 'incomplete');
assert.equal(empty.summary.definedCases, 10);
assert.equal(empty.summary.measuredCases, 0);
assert.equal(empty.summary.firstFrameFirstPassRate, null);
assert.ok(empty.cases.every(c => c.inputAssetsPresent));
assert.ok(empty.cases.every(c => c.gaps.length > 0));
assert.throws(() => resolveEvidenceFile('/tmp/evidence', '../outside.png'));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-acceptance-'));
const hash = (name: string, content: string | Buffer) => {
  fs.writeFileSync(path.join(root, name), content);
  return createHash('sha256').update(content).digest('hex');
};
const png = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#6792c0' } }).png().toBuffer();
assert.ok(ffmpegStatic, 'acceptance test requires the bundled FFmpeg');
const madeVideo = spawnSync(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'color=c=blue:s=512x512:r=5:d=1', '-c:v', 'mpeg4', '-y', path.join(root, 'video.mp4')], { timeout: 30_000 });
assert.equal(madeVideo.status, 0, String(madeVideo.stderr));
const mp4 = fs.readFileSync(path.join(root, 'video.mp4'));
const frameHash = hash('frame.png', png);
const videoHash = hash('video.mp4', mp4);
const sourceHash = hash('source.png', png);
const qa = (phase: 'first_frame' | 'video', checks: string[]) => ({
  reportId: `report-${phase}`, version: 'storyboard-aigc-qa-v1', phase, status: 'passed', passed: true,
  reviewDecision: 'accept', reviewedBy: 'fixture-reviewer', reviewedAt: '2026-10-03T10:00:00Z',
  reasonCodes: [], evidenceFrameLabels: phase === 'video' ? ['t=0', 't=2', 't=4'] : ['first'],
  checks: Object.fromEntries(checks.map(key => [key, { verdict: 'pass', evidenceFrames: phase === 'video' ? ['t=0', 't=2', 't=4'] : ['first'] }])),
});
hash('frame-qa.json', JSON.stringify(qa('first_frame', ['product_identity', 'layout', 'contact', 'visual_integrity'])));
hash('video-qa.json', JSON.stringify(qa('video', ['product_identity', 'layout_continuity', 'contact_continuity', 'visual_integrity'])));
const review = { reviewer: 'fixture-reviewer', reviewedAt: '2026-10-03T10:00:00Z', decision: 'accept' as const,
  scores: { product_identity: 5, contact: 5, visual_quality: 4 }, failureReasons: [] as string[] };
const attempt = (artifactPath: string, sha256: string, qaReportPath: string): AcceptanceAttempt => ({
  artifactPath, sha256, qaReportPath, createdAt: '2026-10-03T09:59:00Z', latencyMs: 12_000,
  estimatedCostCny: 0.5, actualCostCny: 0.4, humanReview: review,
});
const evidence: AcceptanceEvidence = { schemaVersion: 1, cases: [{
  caseId: 'product-clone-tabletop', shotId: 'shot-1',
  sourceShot: { id: 'source-shot-1', startSeconds: 0, endSeconds: 4, firstFramePath: 'source.png', sha256: sourceHash },
  firstFrames: [attempt('frame.png', frameHash, 'frame-qa.json')],
  videos: [{ ...attempt('video.mp4', videoHash, 'video-qa.json'), adopted: true }],
}] };
const partial = evaluateStoryboardAcceptance(matrix, evidence, path.dirname(matrixPath), root);
assert.equal(partial.status, 'incomplete');
assert.equal(partial.summary.measuredCases, 1);
assert.equal(partial.summary.firstFrameFirstPassRate, 1);
assert.equal(partial.summary.videoAdoptionRate, 1);
assert.equal(partial.summary.averageEstimatedCostCny, 1);
assert.equal(partial.summary.averageActualCostCny, 0.8);
assert.equal(partial.cases[0]?.complete, true);
const badFrame = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(16)]);
evidence.cases[0]!.firstFrames[0]!.sha256 = hash('frame.png', badFrame);
const undecodableImage = evaluateStoryboardAcceptance(matrix, evidence, path.dirname(matrixPath), root);
assert.equal(undecodableImage.summary.measuredCases, 0);
assert.ok(undecodableImage.cases[0]?.firstFrameErrors.some(error => error.includes('Image cannot be decoded')));
hash('frame.png', png);
evidence.cases[0]!.firstFrames[0]!.sha256 = frameHash;
evidence.cases[0]!.firstFrames[0]!.sha256 = hash('frame.png', await sharp({ create: { width: 64, height: 64, channels: 3, background: '#6792c0' } }).png().toBuffer());
const tinyImage = evaluateStoryboardAcceptance(matrix, evidence, path.dirname(matrixPath), root);
assert.equal(tinyImage.summary.measuredCases, 0);
assert.ok(tinyImage.cases[0]?.firstFrameErrors.some(error => error.includes('Media dimensions below 256px')));
hash('frame.png', png);
evidence.cases[0]!.firstFrames[0]!.sha256 = frameHash;
evidence.cases[0]!.videos[0]!.sha256 = hash('video.mp4', Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(12)]));
const undecodable = evaluateStoryboardAcceptance(matrix, evidence, path.dirname(matrixPath), root);
assert.equal(undecodable.summary.measuredCases, 0);
assert.ok(undecodable.cases[0]?.videoErrors.some(error => error.includes('Video cannot be fully decoded')));
hash('video.mp4', mp4);
evidence.cases[0]!.videos[0]!.sha256 = videoHash;
evidence.cases[0]!.videos[0]!.adopted = false;
const notAdopted = evaluateStoryboardAcceptance(matrix, evidence, path.dirname(matrixPath), root);
assert.equal(notAdopted.cases[0]?.complete, true, 'valid failed attempts remain measurable');
assert.ok(notAdopted.cases[0]?.qualityGaps.includes('No human-accepted video adopted for this case'));
evidence.cases[0]!.videos[0]!.adopted = true;
hash('video-qa.json', JSON.stringify({ ...qa('video', ['product_identity', 'layout_continuity', 'contact_continuity', 'visual_integrity']),
  checks: { ...qa('video', ['product_identity', 'layout_continuity', 'contact_continuity', 'visual_integrity']).checks,
    product_identity: { verdict: 'pass', evidenceFrames: ['t=2'] } } }));
const insufficientTemporalEvidence = evaluateStoryboardAcceptance(matrix, evidence, path.dirname(matrixPath), root);
assert.equal(insufficientTemporalEvidence.summary.measuredCases, 0);
assert.ok(insufficientTemporalEvidence.cases[0]?.videoErrors.some(error => error.includes('QA temporal evidence insufficient: product_identity')));
hash('video-qa.json', JSON.stringify(qa('video', ['product_identity', 'layout_continuity', 'contact_continuity', 'visual_integrity'])));
evidence.cases[0]!.videos[0]!.humanReview.decision = 'reject';
const rejectedAdoption = evaluateStoryboardAcceptance(matrix, evidence, path.dirname(matrixPath), root);
assert.equal(rejectedAdoption.summary.measuredCases, 0);
assert.ok(rejectedAdoption.cases[0]?.videoErrors.some(error => error.includes('Only a human-accepted video may be adopted')));
evidence.cases[0]!.videos[0]!.humanReview.decision = 'accept';
evidence.cases[0]!.videos[0]!.sha256 = '0'.repeat(64);
const tampered = evaluateStoryboardAcceptance(matrix, evidence, path.dirname(matrixPath), root);
assert.equal(tampered.summary.measuredCases, 0);
assert.equal(tampered.cases[0]?.complete, false);
assert.ok(tampered.cases[0]?.videoErrors.some(error => error.includes('SHA-256 mismatch')));
fs.rmSync(root, { recursive: true, force: true });
console.log('storyboard AIGC acceptance harness tests passed');

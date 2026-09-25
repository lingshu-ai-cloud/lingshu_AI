import assert from 'node:assert/strict';
import test from 'node:test';
import type { DigitalHumanExecutionRecord } from '../../src/lib/digitalHumanPlan.js';
import { importRunwayReferenceOutput } from './runwayReferenceOutput.js';
import { materialAssetObjectKey, tenantPrivateObjectKey } from '../storage/materialAssets.js';

const clipObjectKey = tenantPrivateObjectKey('runway-reference', 'tenant-a', 'source.mp4');
const execution = { id: 'exec-1', shotId: 'shot-2', inputSnapshot: { referenceInput: { materialId: 'source-1', clipObjectKey, clipObjectEtag: 'source-v1', start: 1, duration: 4 } } } as DigitalHumanExecutionRecord;

test('Runway output import enforces host, imports tenant material and reuses verified evidence', async () => {
  const records: any[] = []; const objects = new Map<string, Buffer>([[clipObjectKey, Buffer.from('source')]]); const etags = new Map<string, string>([[clipObjectKey, 'source-v1']]); let fetched = 0; let inspected = 0;
  const deps: any = {
    allowedHost: (host: string) => host === 'verified.example', materials: () => records,
    saveMaterials: (next: any[]) => { records.splice(0, records.length, ...next); },
    download: async (key: string) => objects.has(key) ? { buf: objects.get(key), contentType: 'video/mp4' } : null,
    head: async (key: string) => objects.has(key) ? { size: objects.get(key)!.length, contentType: 'video/mp4', etag: etags.get(key) } : null,
    upload: async ({ key, body }: any) => { objects.set(key, body); etags.set(key, 'candidate-v1'); return ''; },
    transport: async () => { fetched += 1; return new Response(Buffer.from('candidate'), { status: 200, headers: { 'content-type': 'video/mp4' } }); },
    inspect: async () => { inspected += 1; return { source: { width: 320, height: 240, duration: 4, fps: 24, hasAudio: true }, candidate: { width: 720, height: 1280, duration: 4, fps: 24, hasAudio: true }, durationDeltaFrames: 0, audioCorrelation: 1, wholeFrameSimilarity: .8, meanFrameDifference: 2, temporalMotionDifference: 1, freezeMismatchRatio: 0, comparedFrames: 20, limitations: [] }; },
    inspectVisual: async () => ({ normalizedPoseError: .03, posePairCount: 20, handPckAt008: null, handPairCount: 0,
      wristSeparationMae: .1, wristMotionCorrelation: .8, wristPosePairCount: 18, backgroundSsim: .92, landmarkArtifactCount: 0,
      faceAppearanceCorrelationProxy: .6, facePairCount: 12 }),
  };
  await assert.rejects(importRunwayReferenceOutput('https://evil.example/out.mp4', execution, 'tenant-a', deps), /已阻止/);
  const first = await importRunwayReferenceOutput('https://verified.example/out.mp4', execution, 'tenant-a', deps);
  assert.equal(first.materialId, 'runway-exec-1'); assert.match(first.contentSha256, /^[a-f0-9]{64}$/); assert.equal(first.objectEtag, 'candidate-v1'); assert.equal(first.technicalMetrics.comparedFrames, 20);
  assert.equal(first.visualMetrics?.posePairCount, 20);
  assert.equal(records[0].tenantId, 'tenant-a'); assert.equal(records[0].sourceReferenceClipObjectKey, clipObjectKey); assert.equal(records[0].width, 720);
  const second = await importRunwayReferenceOutput('https://verified.example/expired.mp4', execution, 'tenant-a', deps);
  assert.equal(second.materialId, first.materialId); assert.equal(second.visualMetrics?.backgroundSsim, .92); assert.equal(fetched, 1); assert.equal(inspected, 1);
  etags.set(String(records[0].objectKey), 'candidate-v2');
  await assert.rejects(importRunwayReferenceOutput('https://verified.example/expired.mp4', execution, 'tenant-a', deps), /对象版本已变化/);
  records[0].objectKey = `forged/${records[0].objectKey}`;
  await assert.rejects(importRunwayReferenceOutput('https://verified.example/expired.mp4', execution, 'tenant-a', deps), /候选对象不属于当前租户/);
});

test('Runway output import requires exact reference evidence', async () => {
  await assert.rejects(importRunwayReferenceOutput('https://verified.example/out.mp4', { ...execution, inputSnapshot: undefined }, 'tenant-a', { allowedHost: () => true }), /缺少精确参考片段证据/);
  await assert.rejects(importRunwayReferenceOutput('https://verified.example/out.mp4', execution, 'tenant-a', { allowedHost: () => true,
    head: async () => ({ size: 10, contentType: 'video/mp4', etag: 'source-v2' }) }), /参考片段对象版本已变化/);
  let reads = 0;
  await assert.rejects(importRunwayReferenceOutput('https://verified.example/out.mp4', { ...execution, inputSnapshot: { ...execution.inputSnapshot!, referenceInput: { ...execution.inputSnapshot!.referenceInput!, clipObjectKey: `forged/${clipObjectKey}` } } }, 'tenant-a', {
    allowedHost: () => true, head: async () => { reads++; return null; }, download: async () => { reads++; return null; },
  }), /不属于当前租户/);
  assert.equal(reads, 0);
});

test('Runway output never invents missing historical object evidence', async () => {
  const objectKey = materialAssetObjectKey('tenant-a', 'historic.mp4'); let fetched = 0; let inspected = 0;
  const historic: any = { id: 'runway-exec-1', tenantId: 'tenant-a', objectKey, contentSha256: 'a'.repeat(64),
    referenceTechnicalMetrics: { durationDeltaFrames: 0, audioCorrelation: 1, temporalMotionDifference: 0, freezeMismatchRatio: 0, comparedFrames: 10 } };
  const objects = new Map([[clipObjectKey, Buffer.from('source')], [objectKey, Buffer.from('historic')]]);
  const deps: any = { allowedHost: () => true, materials: () => [historic], saveMaterials: () => undefined,
    head: async (key: string) => ({ size: objects.get(key)?.length || 1, contentType: 'video/mp4', etag: key === clipObjectKey ? 'source-v1' : 'current-v1' }),
    download: async (key: string) => ({ buf: objects.get(key), contentType: 'video/mp4' }), upload: async () => '',
    transport: async () => { fetched++; return new Response(Buffer.from('candidate'), { status: 200, headers: { 'content-type': 'video/mp4' } }); },
    inspect: async () => { inspected++; return { source: { width: 320, height: 240, duration: 4, fps: 24, hasAudio: true }, candidate: { width: 720, height: 1280, duration: 4, fps: 24, hasAudio: true }, durationDeltaFrames: 0, audioCorrelation: 1, temporalMotionDifference: 0, freezeMismatchRatio: 0, comparedFrames: 10 }; },
  };
  await importRunwayReferenceOutput('https://verified.example/out.mp4', execution, 'tenant-a', deps);
  assert.equal(fetched, 1); assert.equal(inspected, 1, 'missing original ETag must re-run import checks instead of reusing historic metrics');
  historic.objectEtag = 'current-v1'; historic.contentSha256 = 'not-a-hash'; fetched = 0; inspected = 0;
  await importRunwayReferenceOutput('https://verified.example/out.mp4', execution, 'tenant-a', deps);
  assert.equal(fetched, 1); assert.equal(inspected, 1, 'invalid historic hash must not be normalized into reusable evidence');
});

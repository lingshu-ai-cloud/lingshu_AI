import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createFastHeadLocalProcessor, recoverFastHeadOutput } from './fastHeadLocalProcessor.js';
import { tenantPrivateObjectKey } from '../storage/materialAssets.js';

test('fast head processor stores one tenant-scoped auditable output and reuses it', async () => {
  const tenantId = 'tenant-a';
  const sourceObjectKey = tenantPrivateObjectKey('runway-reference', tenantId, 'source.mp4');
  const outputBytes = Buffer.from('verified-fast-head-video');
  const objects = new Map<string, { buf: Buffer; etag: string }>([[sourceObjectKey, { buf: Buffer.from('source'), etag: 'source-v1' }]]);
  let pipelineRuns = 0; let saved: any[] = [];
  const processor = createFastHeadLocalProcessor({
    allowedHost: host => host === 'output.cloudfront.net',
    transport: async () => new Response(Buffer.from('candidate'), { status: 200, headers: { 'content-type': 'video/mp4' } }),
    downloadObject: async key => objects.has(key) ? { buf: objects.get(key)!.buf, contentType: 'video/mp4' } : null,
    headObject: async key => objects.has(key) ? { size: objects.get(key)!.buf.length, contentType: 'video/mp4', etag: objects.get(key)!.etag } : null,
    uploadObject: async ({ key, body }) => { objects.set(key, { buf: body, etag: 'output-v1' }); return ''; },
    materials: () => saved,
    saveMaterials: next => { saved = next as any[]; },
    runPipeline: async (_source, _candidate, output, workDir) => {
      pipelineRuns += 1; fs.writeFileSync(output, outputBytes);
      fs.writeFileSync(path.join(workDir, 'fast-pipeline-report.json'), JSON.stringify({ status: 'manual_identity_review', technicalQuality: { durationDeltaFrames: 0 }, visualQuality: { backgroundSsim: 0.99 } }));
    },
  });
  const input = { id: 'fast-one', tenantId, sourceObjectKey, sourceObjectEtag: 'source-v1', candidateUrl: 'https://output.cloudfront.net/candidate.mp4' };
  const first = await processor(input); const second = await processor(input);
  assert.equal(first.outputObjectKey, second.outputObjectKey); assert.equal(pipelineRuns, 1);
  assert.equal(saved[0].contentSha256, createHash('sha256').update(outputBytes).digest('hex'));
  assert.deepEqual(await recoverFastHeadOutput(first.outputObjectKey, tenantId, input.id, { head: async key => ({ size: objects.get(key)!.buf.length, contentType: 'video/mp4', etag: objects.get(key)!.etag }), materials: () => saved }), {
    materialId: 'fast-one', objectKey: first.outputObjectKey, contentSha256: saved[0].contentSha256, objectEtag: 'output-v1', technicalMetrics: { durationDeltaFrames: 0 }, visualMetrics: { backgroundSsim: 0.99 },
  });
});

test('fast head processor refuses failed local quality gates', async () => {
  const tenantId = 'tenant-a'; const sourceObjectKey = tenantPrivateObjectKey('runway-reference', tenantId, 'source.mp4');
  const processor = createFastHeadLocalProcessor({ allowedHost: () => true,
    transport: async () => new Response(Buffer.from('candidate'), { status: 200 }), downloadObject: async () => ({ buf: Buffer.from('source'), contentType: 'video/mp4' }),
    headObject: async key => key === sourceObjectKey ? { size: 6, contentType: 'video/mp4', etag: 'source-v1' } : null,
    uploadObject: async () => { throw new Error('must not upload'); }, materials: () => [], saveMaterials: () => {},
    runPipeline: async (_source, _candidate, _output, workDir) => fs.writeFileSync(path.join(workDir, 'fast-pipeline-report.json'), JSON.stringify({ status: 'failed', failures: ['背景漂移'] })),
  });
  await assert.rejects(processor({ id: 'fast-failed', tenantId, sourceObjectKey, sourceObjectEtag: 'source-v1', candidateUrl: 'https://example.test/candidate.mp4' }), /背景漂移/);
});

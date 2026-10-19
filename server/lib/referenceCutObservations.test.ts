import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { readReferenceDenseFrameLedger } from './referenceDenseFrameLedger.js';
import { observeReferenceCutBoundaries } from './referenceCutObservations.js';

const exec = promisify(execFile);

test('real decoded hard edit yields only a visual candidate, never semantic or cross-tenant rights', async () => {
  assert.ok(ffmpeg);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'reference-cut-observation-'));
  const sourcePath = path.join(dir, 'cut.mp4');
  try {
    await exec(ffmpeg!, ['-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:size=64x64:rate=10:duration=1',
      '-f', 'lavfi', '-i', 'color=c=white:size=64x64:rate=10:duration=1',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]',
      '-c:v', 'libx264', '-y', sourcePath]);
    const sourceSha256 = createHash('sha256').update(await readFile(sourcePath)).digest('hex');
    const ledger = await readReferenceDenseFrameLedger({ sourcePath, expectedSourceSha256: sourceSha256,
      sourceTenantId: 'other-tenant', sourceVideoId: 'reference-only', windows: [
        { shotId: 'one', startSeconds: 0, endSeconds: 1 },
        { shotId: 'two', startSeconds: 1, endSeconds: 2 },
      ] });
    const first = await observeReferenceCutBoundaries({ sourcePath, ledger });
    assert.deepEqual(first, await observeReferenceCutBoundaries({ sourcePath, ledger }));
    assert.equal(first.boundaries[0]?.observation, 'visual_discontinuity_candidate');
    assert.equal(first.boundaries[0]?.audioStatus, 'unexamined');
    assert.equal(first.boundaries[0]?.subtitleStatus, 'unexamined');
    assert.equal(first.boundaries[0]?.semanticStatus, 'unobserved');
    assert.equal(first.sourceTenantId, 'other-tenant');
    await assert.rejects(() => observeReferenceCutBoundaries({ sourcePath,
      ledger: { ...ledger, sourceSha256: '0'.repeat(64) } }), /source_hash_mismatch/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('historical 17 windows are neither duration-valid nor tied to the TikTok source record', async () => {
  const root = process.cwd();
  const account = JSON.parse(await readFile(path.join(root, 'fixtures/beauty-showcase/account-data.json'), 'utf8'));
  const records = account.collections.trend_videos as Array<Record<string, unknown>>;
  const old = records.find(row => row.id === 'trend_videos_abb247c15cd74f14af94817c6b52b357')!;
  const tikTok = records.find(row => row.id === 'trend_videos_904321e9f8874ba9b3520622e0787ab2')!;
  const oldAnalysis = JSON.parse(old.aiAnalysis as string);
  const sourcePath = path.join(root,
    'fixtures/beauty-showcase/media/tenants/local_tenant_customer_aurelia_beauty/reference-videos',
    `${old.id}.mp4`);
  const sourceSha256 = createHash('sha256').update(await readFile(sourcePath)).digest('hex');
  assert.equal(sourceSha256, '501ec2c4d39ce67630448eff7001e2f911561e962533ca1bdb6aa10e6d2388e9');
  assert.equal(old.sourceUrl, '');
  assert.equal(tikTok.sourceUrl, 'https://www.tiktok.com/@yuchengcosmeticsfactory/video/7449962848203181354');
  assert.notEqual(old.id, tikTok.id);
  const times = oldAnalysis.gemini.scriptDetails15s.map((shot: { time: string }) =>
    shot.time.match(/^(\d+(?:\.\d+)?)s–(\d+(?:\.\d+)?)s$/));
  assert.equal(times.length, 17);
  assert.ok(times.every((match: RegExpMatchArray | null) => match));
  const windows = times.map((match: RegExpMatchArray, index: number) => ({
    shotId: `historical-${index + 1}`, startSeconds: Number(match[1]), endSeconds: Number(match[2]),
  }));
  assert.equal(windows.at(-1)?.endSeconds, 35.58);
  await assert.rejects(() => readReferenceDenseFrameLedger({ sourcePath,
    expectedSourceSha256: sourceSha256, sourceTenantId: String(old.tenantId),
    sourceVideoId: String(old.id), windows }), /windows_incomplete/);
  // The image observations can study the 16 internal proposals only after capping the final
  // historical range to the real file duration; this is not an acceptance of that source plan.
  windows[16]!.endSeconds = 33.58;
  const ledger = await readReferenceDenseFrameLedger({ sourcePath,
    expectedSourceSha256: sourceSha256, sourceTenantId: String(old.tenantId),
    sourceVideoId: String(old.id), windows });
  assert.equal(ledger.frames.length, 1007);
  const report = await observeReferenceCutBoundaries({ sourcePath, ledger });
  assert.equal(report.boundaries.length, 16);
  assert.equal(report.sourceVideoId, old.id);
  assert.ok(report.boundaries.every(boundary => boundary.semanticStatus === 'unobserved'
    && boundary.audioStatus === 'unexamined' && boundary.subtitleStatus === 'unexamined'));
});

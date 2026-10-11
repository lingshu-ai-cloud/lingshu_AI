import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { shotFingerprint } from '../../src/lib/shotProduction.js';
import { finishReplicationWorkbench, type ReplicationFinishDependencies } from './replicationWorkbenchFinish.js';

const bytes = Buffer.from('real-video-fixture-loaded-by-injected-reader');
const hash = createHash('sha256').update(bytes).digest('hex');
function fixture(kind: 'person' | 'nonperson' = 'person') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'replication-finish-test-'));
  const material: any = { id: 'video', type: 'video', scope: 'own', tenantId: 'tenant', duration: 2, sourceType: kind === 'person' ? 'viral-sentence-replication' : 'storyboard-aigc-video', providerTaskIds: ['task'], contentSha256: hash };
  const spec: any = { lang: 'en', activeAssemblyId: 'a', automatedReplicationShots: [{ shotId: 's', slotId: 'slot', kind, start: 0, end: 2 }], storyboardAssignments: { slot: 'video' }, shotProductions: { 'a:s': { source: 'avatar', sound: 'source', narration: 'Our product.', adoptedId: 'c', candidates: [{ id: 'c', materialId: 'video' }] } }, digitalHumanAssemblyAdoptions: { 'a:s': { executionId: 'execution', materialId: 'video', candidateContentSha256: hash } } };
  spec.digitalHumanAssemblyAdoptions['a:s'].fingerprint = shotFingerprint(spec.shotProductions['a:s'], '', 's');
  let manifest: any;
  let paidCalls = 0;
  const output = path.join(root, 'output.mp4');
  fs.writeFileSync(output, bytes);
  const deps: ReplicationFinishDependencies = { workRoot: root, materials: () => [material], readMaterial: async () => ({ bytes, mimeType: 'video/mp4' }), probe: async () => ({ duration: 2, hasAudio: true }), reserveAsr: async () => { paidCalls++; }, verifyPersonAdoption: async () => {}, captions: async () => ({ transcript: 'Our product.', cues: [{ start: .1, end: 1.8, text: 'Our product.' }], provenance: 'qwen_filetrans:source_material', sourceHash: hash }), render: async input => { manifest = input; return { ok: true, outputPath: output }; }, visuals: async () => ({ passed: true, failures: [], metrics: {} as any, evidenceFrames: [] }), scenes: async () => ({ passed: true, issues: [], checkedScenes: 1 }), finish: async () => ({ audioQuality: { passed: true } } as any) };
  return { root, material, spec, deps, manifest: () => manifest, paidCalls: () => paidCalls };
}

test('person preserves generated speech and uses measured source captions; retries reuse captions', async () => {
  const f = fixture();
  try {
    const result = await finishReplicationWorkbench({ tenantId: 'tenant', projectId: 'p', spec: f.spec }, f.deps);
    assert.equal(f.manifest().timeline[0].production.sound, 'source');
    assert.equal(f.manifest().voiceover, undefined);
    assert.equal(result.automation.quality.passed, true);
    assert.equal(result.alignedCuesByLang.en[0].start, .1);
    await finishReplicationWorkbench({ tenantId: 'tenant', projectId: 'p', spec: f.spec }, f.deps);
    assert.equal(f.paidCalls(), 1);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('blocks wrong tenant, changed hash and missing digital human adoption before paid ASR', async () => {
  for (const invalid of ['tenant', 'hash', 'adoption']) {
    const f = fixture();
    if (invalid === 'tenant') f.material.tenantId = 'other';
    if (invalid === 'hash') f.material.contentSha256 = '0'.repeat(64);
    if (invalid === 'adoption') f.spec.digitalHumanAssemblyAdoptions = {};
    try { await assert.rejects(finishReplicationWorkbench({ tenantId: 'tenant', projectId: 'p', spec: f.spec }, f.deps)); assert.equal(f.paidCalls(), 0); }
    finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('a required blocked shot fails before reading materials or invoking paid finish work', async () => {
  const f = fixture('nonperson'); let materialReads = 0;
  f.spec.automatedReplicationShots.unshift({ shotId: 'blocked', slotId: 'blocked-slot', kind: 'blocked', productionState: 'blocked', start: 0, end: 1, blocker: '镜头类型待确认' });
  f.deps.materials = async () => { materialReads++; return [f.material]; };
  try {
    await assert.rejects(finishReplicationWorkbench({ tenantId: 'tenant', projectId: 'p', spec: f.spec }, f.deps), /镜头类型待确认/);
    assert.equal(materialReads, 0); assert.equal(f.paidCalls(), 0);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('hard visual failure does not emit a successful completion', async () => {
  const f = fixture(); f.deps.visuals = async () => ({ passed: false, failures: ['decode failed'], metrics: {} as any, evidenceFrames: [] });
  try { await assert.rejects(finishReplicationWorkbench({ tenantId: 'tenant', projectId: 'p', spec: f.spec }, f.deps), /decode failed/); }
  finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('nonperson TTS overrun is blocked rather than sped up or truncated; completed TTS is reused', async () => {
  const f = fixture('nonperson'); let calls = 0;
  const audio = path.join(f.root, 'voice.wav'); fs.writeFileSync(audio, 'audio');
  f.deps.synthesize = async () => { calls++; return { ok: true, text: 'Our product.', duration: 3, localPath: audio, cues: [{ start: 0, end: 2.8, text: 'Our product.' }], alignmentSource: 'synthesized_sentence_audio', qualityReport: { passed: true } as any }; };
  try {
    for (let i = 0; i < 2; i++) await assert.rejects(finishReplicationWorkbench({ tenantId: 'tenant', projectId: 'p', spec: f.spec }, f.deps), /超过镜头/);
    assert.equal(calls, 1);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('actual ffmpeg renderer keeps mixed source and new voice tracks while replacing broll sound', async () => {
  const { execFileSync } = await import('node:child_process');
  const ffmpeg = (await import('ffmpeg-static')).default!;
  const f = fixture();
  try {
    const video = path.join(f.root, 'source.mp4');
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=360x640:r=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', video]);
    const actualBytes = fs.readFileSync(video);
    const actualHash = createHash('sha256').update(actualBytes).digest('hex');
    const audio = path.join(f.root, 'tts.wav');
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100', '-t', '1.6', '-c:a', 'pcm_s16le', '-y', audio]);
    Object.assign(f.material, { contentSha256: actualHash });
    f.spec.digitalHumanAssemblyAdoptions['a:s'].candidateContentSha256 = actualHash;
    f.spec.exportSpec = { resolution: '720p' };
    f.spec.automatedReplicationShots.push({ shotId: 'b', slotId: 'bslot', kind: 'nonperson', start: 2, end: 4 });
    f.spec.storyboardAssignments.bslot = 'bvideo';
    f.spec.shotProductions['a:b'] = { narration: 'Our product.', adoptedId: 'bc', candidates: [{ id: 'bc', materialId: 'bvideo' }] };
    f.deps.materials = () => [f.material, { ...f.material, id: 'bvideo', sourceType: 'tenant_upload' }];
    f.deps.readMaterial = async () => ({ bytes: actualBytes, mimeType: 'video/mp4' });
    f.deps.captions = async () => ({ transcript: 'Our product.', cues: [{ start: .1, end: 1.8, text: 'Our product.' }], sourceHash: actualHash, provenance: 'injected_test_alignment' });
    f.deps.synthesize = async () => ({ ok: true, text: 'Our product.', duration: 1.6, localPath: audio, cues: [{ start: 0, end: 1.45, text: 'Our product.' }], alignmentSource: 'synthesized_sentence_audio', source: 'injected_test_tts', qualityReport: { passed: true } as any });
    delete f.deps.render; delete f.deps.probe; delete f.deps.visuals; delete f.deps.scenes; delete f.deps.finish;
    const result = await finishReplicationWorkbench({ tenantId: 'tenant', projectId: 'mixed-fixture', spec: f.spec }, f.deps);
    assert.equal(result.automation.quality.passed, true);
    assert.equal(result.duration, 4);
    assert.equal(result.automatedReplicationFinish.receipts[0].audioSource, 'generated_video');
    assert.equal(result.automatedReplicationFinish.receipts[1].audioSource, 'injected_test_tts');
    assert.match(result.renderOutputPath, /publishing-uploads\/tenant\/studio-replication-/);
    const power = (start: number, hz: number) => {
      const pcm = execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(start), '-i', result.renderOutputPath, '-t', '0.5', '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1']);
      let a = 0, b = 0;
      for (let i = 0; i < pcm.length / 4; i++) { const x = pcm.readFloatLE(i * 4); a += x * Math.cos(2 * Math.PI * hz * i / 8000); b += x * Math.sin(2 * Math.PI * hz * i / 8000); }
      return a * a + b * b;
    };
    assert.ok(power(.5, 440) > power(.5, 880) * 50, 'person source audio was retained');
    assert.ok(power(2.5, 880) > power(2.5, 440) * 50, 'broll original audio was suppressed and new TTS used');
    fs.rmSync(result.renderOutputPath, { force: true });
    if (result.coverImagePath) fs.rmSync(result.coverImagePath, { force: true });
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('rejects supplier speech that differs from the frozen target script', async () => {
  const f = fixture();
  f.deps.captions = async () => ({ transcript: 'Different product claims.', cues: [{ start: .1, end: 1.8, text: 'Different product claims.' }], sourceHash: hash, provenance: 'qwen_filetrans:source_material' });
  try { await assert.rejects(finishReplicationWorkbench({ tenantId: 'tenant', projectId: 'p', spec: f.spec }, f.deps), /冻结脚本不一致/); }
  finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('silent broll uses the matched video interval without requesting voice generation', async () => {
  const f = fixture();
  f.spec.automatedReplicationShots.push({ shotId: 'silent', slotId: 'silent-slot', kind: 'nonperson', start: 2, end: 3 });
  f.spec.storyboardAssignments['silent-slot'] = 'bvideo';
  f.spec.shotProductions['a:silent'] = { narration: '', adoptedId: 'bc', candidates: [{ id: 'bc', materialId: 'bvideo' }] };
  f.spec.clipEdits = { 'silent-slot': { trimStart: .6, trimEnd: 1.6 } };
  f.deps.materials = () => [f.material, { ...f.material, id: 'bvideo', sourceType: 'tenant_upload' }];
  f.deps.synthesize = async () => { throw new Error('silent slot must not synthesize voice'); };
  try {
    await finishReplicationWorkbench({ tenantId: 'tenant', projectId: 'p', spec: f.spec }, f.deps);
    assert.equal(f.manifest().timeline[1].production.sound, 'silent');
    assert.equal(f.manifest().timeline[1].trimStart, .6);
    f.spec.clipEdits['silent-slot'].trimStart = 1.6;
    await assert.rejects(finishReplicationWorkbench({ tenantId: 'tenant', projectId: 'p', spec: f.spec }, f.deps), /短于装配时长/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

 test('adopted person candidate cannot survive changes to current shot parameters', async () => {
  const f = fixture();
  f.spec.shotProductions['a:s'].narration = 'Changed target speech.';
  try { await assert.rejects(finishReplicationWorkbench({ tenantId: 'tenant', projectId: 'p', spec: f.spec }, f.deps), /采用后参数已变化/); assert.equal(f.paidCalls(), 0); }
  finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { prepareRunwayReferenceInputs, selectRunwayCharacterMaterial } from './runwayReferenceInputs.js';
import { newShotProduction } from '../../src/lib/shotProduction.js';

test('Runway inputs resolve tenant-owned assets and persist an exact reference clip', async () => {
  const uploaded: Array<{ key: string; bytes: number }> = []; const objects = new Map<string, Buffer>();
  const ffmpeg = String((await import('ffmpeg-static')).default || ''); assert.ok(ffmpeg);
  const dir = fs.mkdtempSync('/tmp/runway-input-test-'); const source = `${dir}/source.mp4`;
  try {
    const { execFile } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => execFile(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libx264', '-c:a', 'aac', source], error => error ? reject(error) : resolve()));
    objects.set('source-key', fs.readFileSync(source)); objects.set('person-key', Buffer.from('person'));
    const shot = { ...newShotProduction('target', 'person-1'), source: 'avatar' as const, digitalHuman: { workflow: 'viral_replication' as const, method: 'reenact' as const, contentConfirmed: true, action: 'wave', scene: 'room', preserve: 'identity', reference: { materialId: 'source-1', videoUrl: '/media/source.mp4', start: 1, end: 5, originalText: 'source', derivativeAuthorized: true } } };
    const deps = { ffmpegPath: ffmpeg, materials: () => [
      { id: 'person-image', tenantId: 'tenant-a', scope: 'own', type: 'image', objectKey: 'person-key' },
      { id: 'source-1', tenantId: 'tenant-a', scope: 'own', type: 'video', objectKey: 'source-key' },
    ], download: async (key: string) => objects.has(key) ? { buf: objects.get(key)!, contentType: 'video/mp4' } : null,
    head: async (key: string) => key === 'person-key' ? { size: 6, contentType: 'image/jpeg', etag: 'person-v1' } : key === 'source-key' ? { size: objects.get(key)!.length, contentType: 'video/mp4', etag: 'source-v1' } : uploaded.some(item => item.key === key) ? { size: 1, contentType: 'video/mp4', etag: 'clip-v1' } : null,
    uploadFile: async (value: { key: string; filePath: string }) => { uploaded.push({ key: value.key, bytes: fs.statSync(value.filePath).size }); },
    sign: async (key: string) => `https://signed.example/${key}` };
    const first = await prepareRunwayReferenceInputs({ shot, presenter: { id: 'person-1', name: 'Person', avatarId: '', voiceId: '', authorized: true, supportsAlpha: false, referenceMaterialIds: ['person-image'] }, tenantId: 'tenant-a' }, deps as any);
    assert.equal(first.characterUrl, 'https://signed.example/person-key'); assert.equal(first.characterType, 'image'); assert.equal(first.characterMaterialId, 'person-image'); assert.equal(first.characterObjectKey, 'person-key'); assert.equal(first.characterObjectEtag, 'person-v1');
    assert.equal(first.referenceSourceObjectEtag, 'source-v1'); assert.equal(first.referenceClipObjectEtag, 'clip-v1');
    assert.equal(first.referenceDuration, 4); assert.equal(uploaded.length, 1); assert.ok(uploaded[0]!.bytes > 1024);
    const second = await prepareRunwayReferenceInputs({ shot, presenter: { id: 'person-1', name: 'Person', avatarId: '', voiceId: '', authorized: true, supportsAlpha: false, referenceMaterialIds: ['person-image'] }, tenantId: 'tenant-a' }, deps as any);
    assert.equal(second.referenceClipKey, first.referenceClipKey); assert.equal(uploaded.length, 1, 'existing exact clip is reused');
    await assert.rejects(prepareRunwayReferenceInputs({ shot, presenter: { id: 'person-1', name: 'Person', avatarId: '', voiceId: '', authorized: true, supportsAlpha: false, referenceMaterialIds: ['person-image'] }, tenantId: 'tenant-a' }, { ...deps, head: async () => null } as any), /人物对象不存在/);
    const changedSource = await prepareRunwayReferenceInputs({ shot, presenter: { id: 'person-1', name: 'Person', avatarId: '', voiceId: '', authorized: true, supportsAlpha: false, referenceMaterialIds: ['person-image'] }, tenantId: 'tenant-a' }, { ...deps, head: async (key: string) => key === 'source-key' ? { size: objects.get(key)!.length, contentType: 'video/mp4', etag: 'source-v2' } : deps.head(key) } as any);
    assert.notEqual(changedSource.referenceClipKey, first.referenceClipKey); assert.equal(uploaded.length, 2, 'a replaced source object cannot reuse the prior clip');
    await assert.rejects(prepareRunwayReferenceInputs({ shot, presenter: { id: 'person-1', name: 'Person', avatarId: '', voiceId: '', authorized: true, supportsAlpha: false, referenceMaterialIds: ['person-image'] }, tenantId: 'tenant-a' }, { ...deps, head: async (key: string) => key === 'person-key' ? { size: 17 * 1024 * 1024, contentType: 'image/jpeg' } : deps.head(key) } as any), /图片超过输入大小上限/);
    await assert.rejects(prepareRunwayReferenceInputs({ shot, presenter: { id: 'person-1', name: 'Person', avatarId: '', voiceId: '', authorized: true, supportsAlpha: false, referenceMaterialIds: ['person-image'] }, tenantId: 'tenant-a' }, { ...deps, head: async (key: string) => key === 'person-key' ? { size: 6, contentType: 'video/mp4' } : deps.head(key) } as any), /类型与素材记录不一致/);
    await assert.rejects(prepareRunwayReferenceInputs({ shot, presenter: { id: 'person-1', name: 'Person', avatarId: '', voiceId: '', authorized: true, supportsAlpha: false, referenceMaterialIds: ['person-image'] }, tenantId: 'tenant-a' }, { ...deps, sign: async () => 'http://127.0.0.1/private' } as any), /HTTPS 域名/);
    await assert.rejects(prepareRunwayReferenceInputs({ shot, presenter: { id: 'person-1', name: 'Person', avatarId: '', voiceId: '', authorized: true, supportsAlpha: false, referenceMaterialIds: ['person-image'] }, tenantId: 'tenant-b' }, deps as any), /无权使用/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Runway character selection is compatible, tenant-safe and independent of mapping order', () => {
  const records = [
    { id: 'wide-video', tenantId: 'tenant-a', scope: 'own', type: 'video', objectKey: 'wide-key', width: 3000, height: 1000, sizeBytes: 1024 },
    { id: 'oversize-image', tenantId: 'tenant-a', scope: 'own', type: 'image', objectKey: 'large-key', width: 720, height: 1280, sizeBytes: 17 * 1024 * 1024 },
    { id: 'z-video', tenantId: 'tenant-a', scope: 'own', type: 'video', objectKey: 'video-key', width: 720, height: 1280, sizeBytes: 1024 },
    { id: 'b-image', tenantId: 'tenant-a', scope: 'own', type: 'image', objectKey: 'b-key', width: 720, height: 1280, sizeBytes: 1024 },
    { id: 'a-image', tenantId: 'tenant-a', scope: 'own', type: 'image', objectKey: 'a-key', width: 720, height: 1280, sizeBytes: 1024 },
    { id: 'other-tenant', tenantId: 'tenant-b', scope: 'own', type: 'image', objectKey: 'other-key', width: 720, height: 1280, sizeBytes: 1024 },
  ];
  const forward = selectRunwayCharacterMaterial(records, ['wide-video', 'b-image', 'z-video', 'a-image'], 'tenant-a');
  const reversed = selectRunwayCharacterMaterial(records, ['a-image', 'z-video', 'b-image', 'wide-video'], 'tenant-a');
  assert.equal(forward.id, 'a-image'); assert.equal(reversed.id, 'a-image');
  assert.throws(() => selectRunwayCharacterMaterial(records, ['wide-video'], 'tenant-a'), /均不符合/);
  assert.throws(() => selectRunwayCharacterMaterial(records, ['oversize-image'], 'tenant-a'), /均不符合/);
  assert.throws(() => selectRunwayCharacterMaterial(records, ['a-image', 'other-tenant'], 'tenant-a'), /无权使用/);
});

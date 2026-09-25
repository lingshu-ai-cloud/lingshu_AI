import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { tenantAssetDir, tenantAssetRelativePath } from './assetAccess.js';
import { isTenantPrivateObjectKey, materialAssetObjectKey, tenantPrivateObjectKey } from '../storage/materialAssets.js';
import { recoverStoredCandidateOutput, runwayActTwoReadiness, seedanceReferenceReadiness, verifyStoredCandidateOutput, verifyStoredReferenceInputs, visualQaReadiness } from './studioAvatarProduction.js';

test('Runway readiness reports every missing execution prerequisite without exposing values', () => {
  const result = runwayActTwoReadiness({ enabled: 'false', apiSecret: '', objectStorageEnabled: false,
    cnyPerCredit: '0', estimatedCnyPerSecond: '', maxCnyPerShot: '-1', monthlyBudgetCny: 'NaN' });
  assert.equal(result.ready, false);
  for (const label of ['RUNWAY_ACT_TWO_ENABLED=true', 'RUNWAYML_API_SECRET', '对象存储', 'RUNWAY_ACT_TWO_CNY_PER_CREDIT',
    'RUNWAY_ACT_TWO_ESTIMATED_CNY_PER_SECOND', 'DIGITAL_HUMAN_REFERENCE_MAX_CNY_PER_SHOT', 'DIGITAL_HUMAN_REFERENCE_MONTHLY_BUDGET_CNY']) {
    assert.match(result.reason, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Runway readiness opens only when every paid execution prerequisite is valid', () => {
  assert.deepEqual(runwayActTwoReadiness({ enabled: 'true', apiSecret: 'secret', objectStorageEnabled: true,
    cnyPerCredit: '0.5', estimatedCnyPerSecond: '1.2', maxCnyPerShot: '20', monthlyBudgetCny: '500' }), { ready: true, reason: '' });
});

test('Runway readiness rejects non-finite billing and budget values', () => {
  const result = runwayActTwoReadiness({ enabled: 'true', apiSecret: 'secret', objectStorageEnabled: true,
    cnyPerCredit: 'Infinity', estimatedCnyPerSecond: '1', maxCnyPerShot: '20', monthlyBudgetCny: '500' });
  assert.equal(result.ready, false);
  assert.match(result.reason, /RUNWAY_ACT_TWO_CNY_PER_CREDIT/);
});

test('Seedance reference readiness requires an explicit paid gate and every durable execution prerequisite', () => {
  const blocked = seedanceReferenceReadiness({ enabled: 'false', apiKey: '', model: '', objectStorageEnabled: false, estimatedCnyPerSecond: '', maxCnyPerShot: '', monthlyBudgetCny: '' });
  assert.equal(blocked.ready, false); for (const item of ['SEEDANCE_REFERENCE_ENABLED=true', 'SEEDANCE_API_KEY', 'SEEDANCE_MODEL', '对象存储', 'SEEDANCE_REFERENCE_ESTIMATED_CNY_PER_SECOND']) assert.match(blocked.reason, new RegExp(item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(seedanceReferenceReadiness({ enabled: 'true', apiKey: 'secret', model: 'endpoint', objectStorageEnabled: true, estimatedCnyPerSecond: '1', maxCnyPerShot: '10', monthlyBudgetCny: '100' }).ready, true);
});

test('visual QA is advertised only for a verified executable Python runtime', () => {
  assert.equal(visualQaReadiness(undefined, () => undefined).ready, false);
  assert.equal(visualQaReadiness('/missing/python', () => { throw new Error('ENOENT'); }).ready, false);
  let checkedMode = 0;
  assert.match(visualQaReadiness('/qa/python', (_path, mode) => { checkedMode = mode; }, () => ({ status: 1 })).reason, /缺少 OpenCV、MediaPipe 或 scikit-image/);
  let probedPath = '';
  assert.deepEqual(visualQaReadiness('/qa/python', (_path, mode) => { checkedMode = mode; }, path => { probedPath = path; return { status: 0 }; }), { ready: true, reason: '' });
  assert.equal(checkedMode, fs.constants.X_OK);
  assert.equal(probedPath, '/qa/python');
});

test('local candidate evidence is tenant-scoped and invalidated when bytes change', async () => {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-evidence-'));
  try {
    const tenantId = 'tenant-a'; const bytes = Buffer.from('verified candidate');
    const localFile = tenantAssetRelativePath(tenantId, 'candidate.mp4');
    const file = path.join(mediaRoot, localFile);
    fs.mkdirSync(tenantAssetDir(mediaRoot, tenantId), { recursive: true }); fs.writeFileSync(file, bytes);
    const evidence = { localFile, contentSha256: createHash('sha256').update(bytes).digest('hex') };
    assert.equal(await verifyStoredCandidateOutput(evidence, tenantId, { mediaRoot }), true);
    assert.equal(await verifyStoredCandidateOutput(evidence, 'tenant-b', { mediaRoot }), false);
    fs.writeFileSync(file, 'changed candidate');
    assert.equal(await verifyStoredCandidateOutput(evidence, tenantId, { mediaRoot }), false);
    assert.equal(await verifyStoredCandidateOutput({ localFile: '../outside.mp4', contentSha256: evidence.contentSha256 }, tenantId, { mediaRoot }), false);
  } finally { fs.rmSync(mediaRoot, { recursive: true, force: true }); }
});

test('stored local candidates recover complete evidence only while their bytes still match', async () => {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-recovery-'));
  try {
    const tenantId = 'tenant-a'; const bytes = Buffer.from('persisted candidate');
    const file = tenantAssetRelativePath(tenantId, 'persisted.mp4');
    fs.mkdirSync(tenantAssetDir(mediaRoot, tenantId), { recursive: true }); fs.writeFileSync(path.join(mediaRoot, file), bytes);
    const material = { id: 'avatar-1', file, contentSha256: createHash('sha256').update(bytes).digest('hex') };
    assert.deepEqual(await recoverStoredCandidateOutput(material, tenantId, { mediaRoot }),
      { materialId: 'avatar-1', localFile: file, contentSha256: material.contentSha256 });
    assert.equal(await recoverStoredCandidateOutput(material, 'tenant-b', { mediaRoot }), undefined);
    fs.writeFileSync(path.join(mediaRoot, file), 'overwritten');
    assert.equal(await recoverStoredCandidateOutput(material, tenantId, { mediaRoot }), undefined);
    assert.equal(await recoverStoredCandidateOutput({ ...material, contentSha256: 'invalid' }, tenantId, { mediaRoot }), undefined);
  } finally { fs.rmSync(mediaRoot, { recursive: true, force: true }); }
});

test('stored object candidates recover only with their persisted object version', async () => {
  const material = { id: 'avatar-object', objectKey: materialAssetObjectKey('tenant-a', 'video.mp4'), contentSha256: 'a'.repeat(64), objectEtag: 'v1' };
  const head = async () => ({ size: 42, etag: 'v1', contentType: 'video/mp4' });
  assert.deepEqual(await recoverStoredCandidateOutput(material, 'tenant-a', { head }), { materialId: material.id, objectKey: material.objectKey,
    contentSha256: material.contentSha256, objectEtag: material.objectEtag });
  assert.equal(await recoverStoredCandidateOutput(material, 'tenant-a', { head: async () => ({ size: 42, etag: 'v2', contentType: 'video/mp4' }) }), undefined);
  assert.equal(await recoverStoredCandidateOutput({ ...material, objectEtag: undefined }, 'tenant-a', { head }), undefined);
  assert.equal(await recoverStoredCandidateOutput({ ...material, objectKey: `forged/prefix/${material.objectKey}` }, 'tenant-a', { head }), undefined);
});

test('tenant object keys require the exact generated namespace structure', () => {
  const material = materialAssetObjectKey('tenant-a', 'video.mp4'); const clip = tenantPrivateObjectKey('runway-reference', 'tenant-a', 'clip.mp4');
  assert.equal(isTenantPrivateObjectKey(material, 'tenant-a'), true); assert.equal(isTenantPrivateObjectKey(clip, 'tenant-a'), true);
  assert.equal(isTenantPrivateObjectKey(material, 'tenant-b'), false);
  assert.equal(isTenantPrivateObjectKey(`forged/${material}`, 'tenant-a'), false);
  assert.equal(isTenantPrivateObjectKey(`${material}/extra`, 'tenant-a'), false);
  assert.equal(isTenantPrivateObjectKey(`../${material}`, 'tenant-a'), false);
});

test('reference input verification rejects forged prefixes before reading objects', async () => {
  const presenter = materialAssetObjectKey('tenant-a', 'person.png'); const clip = tenantPrivateObjectKey('runway-reference', 'tenant-a', 'clip.mp4');
  let reads = 0; const head = async (key: string) => { reads++; return { size: 42, etag: key === presenter ? 'person-v1' : 'clip-v1', contentType: 'video/mp4' }; };
  const snapshot = { presenterInput: { objectKey: presenter, objectEtag: 'person-v1' }, referenceInput: { clipObjectKey: clip, clipObjectEtag: 'clip-v1' } };
  assert.equal(await verifyStoredReferenceInputs(snapshot, 'tenant-a', head), true); assert.equal(reads, 2);
  reads = 0;
  assert.equal(await verifyStoredReferenceInputs({ ...snapshot, referenceInput: { ...snapshot.referenceInput, clipObjectKey: `forged/${clip}` } }, 'tenant-a', head), false);
  assert.equal(reads, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSocialImageTask } from './socialImageTask.js';
import sharp from 'sharp';
import { socialImageCandidateOcrCheck, socialImageCandidatePixelChecks, socialImageDeterministicChecks } from './socialImageQuality.js';

test('deterministic preflight passes only evidence it can prove', () => {
  const task = defaultSocialImageTask({
    title: '产品图', coreClaim: '已确认主张', productRefs: ['product-1'], productNames: ['产品一'],
    enterpriseAssets: [{ assetId: 'product-1', role: 'product', name: '产品一', source: 'enterprise_knowledge_base' }],
  });
  task.imageTextContract.headline = '产品标题';
  task.imageTextContract.requiredFacts = ['已确认主张'];
  const checks = socialImageDeterministicChecks(task);
  assert.equal(checks.find(item => item.key === 'product_identity')?.verdict, 'uncertain');
  assert.equal(checks.find(item => item.key === 'fact_consistency')?.verdict, 'uncertain');
  assert.equal(checks.find(item => item.key === 'packaging_visibility')?.verdict, 'uncertain');
  assert.equal(checks.find(item => item.key === 'subject_visibility')?.verdict, 'uncertain');
});

test('candidate pixel and OCR gates inspect actual bytes and exact target dimensions', async () => {
  const correct = await sharp({ create: { width: 1200, height: 1500, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const pixels = await socialImageCandidatePixelChecks({ bytes: correct, aspectRatio: '4:5' });
  assert.equal(pixels.find(check => check.key === 'file_decode')?.verdict, 'pass');
  assert.equal(pixels.find(check => check.key === 'pixel_dimensions')?.verdict, 'pass');
  const wrong = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: '#ffffff' } }).png().toBuffer();
  assert.equal((await socialImageCandidatePixelChecks({ bytes: wrong, aspectRatio: '4:5' }))
    .find(check => check.key === 'pixel_dimensions')?.verdict, 'fail');
  assert.equal((await socialImageCandidatePixelChecks({ bytes: Buffer.from('broken'), aspectRatio: '4:5' }))
    .find(check => check.key === 'file_decode')?.verdict, 'fail');
  const oriented = await sharp({ create: { width: 1500, height: 1200, channels: 3, background: '#ffffff' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  assert.equal((await socialImageCandidatePixelChecks({ bytes: oriented, aspectRatio: '4:5' }))
    .find(check => check.key === 'pixel_dimensions')?.verdict, 'pass', 'EXIF orientation must be applied before dimension checks');
  const ocr = await socialImageCandidateOcrCheck({ bytes: correct, mimeType: 'image/png', expectedTexts: ['Product A'],
    recognize: async () => 'PRODUCT A' });
  assert.equal(ocr.verdict, 'pass');
  assert.ok(ocr.evidence?.some(item => item.startsWith('candidate-sha256:')));
});

test('viral replication without a benchmark image cannot pass reference preflight', () => {
  const task = defaultSocialImageTask({ creationPath: 'viral_replication', productRefs: ['product-1'] });
  const checks = socialImageDeterministicChecks(task);
  assert.equal(checks.find(item => item.key === 'reference_structure_similarity')?.verdict, 'fail');
});

import assert from 'node:assert/strict';
import { isSyntheticMaterial, syntheticMaterialMarker } from './materialTruthfulness.js';

for (const record of [
  { name: 'mock-0627.mp4', sourceType: 'user-upload' },
  { name: '真实素材', sourceType: 'e2e-quality-test' },
  { name: '真实素材', sourceUrl: '/fixtures/material.mp4' },
  { name: '真实素材', url: '/public/demo/mock-0627.mp4' },
  { name: '真实素材', url: '/public/demo/product.mp4' },
  { name: '真实素材', file: 'samples/material.mp4' },
  { name: '真实素材', isMock: true },
]) {
  assert.equal(isSyntheticMaterial(record), true, `explicit synthetic provenance must be rejected: ${JSON.stringify(record)}`);
}

for (const record of [
  { name: 'Product demo video', sourceType: 'user-upload', url: '/media/product-demo.mp4' },
  { name: 'Demonstration product', sourceType: 'ai-generated', url: '/media/generated/product.mp4' },
  { name: '真实工厂素材', sourceType: 'digital-human', file: 'tenant-a/factory.mp4' },
]) {
  assert.equal(isSyntheticMaterial(record), false, `legitimate display wording must remain eligible: ${JSON.stringify(record)}`);
}

assert.equal(syntheticMaterialMarker('e2e-quality-test'), true);
assert.equal(syntheticMaterialMarker('/uploads/product-demo.mp4'), false);

console.log('material truthfulness tests passed');

import assert from 'node:assert/strict';
import fs from 'node:fs';

const videos = fs.readFileSync(new URL('../routes/videos.ts', import.meta.url), 'utf8');
const studio = fs.readFileSync(new URL('../routes/studio.ts', import.meta.url), 'utf8');
const qwen = fs.readFileSync(new URL('../agents/qwen.ts', import.meta.url), 'utf8');
const gemini = fs.readFileSync(new URL('../agents/gemini.ts', import.meta.url), 'utf8');

assert.match(videos, /handleAnalyzeSource[\s\S]*?resolvedPublicVideoSource\(record, input\)/,
  'video analysis route must resolve only an owned, allowlisted platform source');
assert.match(videos, /handleDownloadMaterial[\s\S]*?resolvedPublicVideoSource\(record, input\)/,
  'material download route must resolve only an owned, allowlisted platform source');
assert.match(videos, /downloadMaterialJob[\s\S]*?validatePublicVideoSourceUrl\(input\.sourceUrl, input\.platform\)/,
  'internal material downloads must retain a defensive URL validation boundary');
assert.match(videos, /tenantAssetDir\(MEDIA_DIR, input\.tenantId\)[\s\S]*?buildDownloadedReferenceMaterial/,
  'downloaded competitor bytes and records must be tenant-scoped and reference-only');
assert.match(studio, /untrustedPromptData\('reference_analysis', reference\)/,
  'reference analysis must be serialized as untrusted prompt data');
assert.match(studio, /untrustedPromptData\('reference_forbidden_terms'/,
  'terms extracted from reference content must not be reinserted as prompt instructions');
assert.match(studio, /untrustedPromptData\(\s*'material_observations'/,
  'material names and observations must be serialized as untrusted prompt data');
assert.match(qwen, /untrustedPromptData\('video_metadata_and_asr'/,
  'Qwen video titles, engagement metadata, and ASR must be serialized as untrusted prompt data');
assert.match(qwen, /untrustedPromptData\('video_title'/,
  'Qwen timeline detection must treat the source title as untrusted evidence');
assert.match(qwen, /untrustedPromptData\('image_post_metadata'/,
  'Qwen image metadata must be serialized as untrusted prompt data');
assert.match(gemini, /untrustedPromptData\('image_post_metadata'/,
  'Gemini image metadata must be serialized as untrusted prompt data');

console.log('Social crawler URL, tenant, rights, and prompt-injection boundaries passed');

import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('server/routes/studio.ts', 'utf8');
const route = source.split("studioRouter.post('/fb-poster/render'")[1]?.split("// POST /studio/caption")[0] || '';

assert.match(route, /imageTask\.imageType === 'gif_poster'\) throw new SocialImagePaidJobError\('social_image_gif_delivery_not_ready'\)/,
  'GIF plates must remain closed until fixed-layer composition and delivery are wired');
assert.match(route, /socialImagePlannedRenderInput\(imageTask, imageJobId\)/,
  'carousel paid rendering must read the frozen server unit before processing references');
assert.match(route, /\} = plannedInput \? \{\s*poster: plannedInput\.poster/,
  'a planned unit must not spread browser fields into the provider request');
for (const [field, sourceField] of Object.entries({ imagePrompt: 'imagePrompt', imageQuality: 'quality',
  ratio: 'ratio', materialIds: 'materialIds', productIds: 'productIds', referenceImageUrls: 'referenceImageUrls',
  referencePlan: 'referencePlan', deliverableType: 'deliverableType',
  productionStrategy: 'productionStrategy', idempotencyKey: 'idempotencyKey' })) {
  assert.match(route, new RegExp(`${field}: plannedInput\\.${sourceField}`), `${field} must come from the frozen server plan`);
}
assert.match(route, /claimSocialImagePlannedUnit\(\{/,
  'a carousel page must use the planned-unit atomic claim, not the single-image claim');
assert.match(route, /plannedInputHash: plannedInput\.unit\.plannedInputHash/,
  'the paid request hash must remain linked to the frozen unit hash');
assert.match(route, /role: plannedInput\?\.unit\.role \|\| 'single', label: plannedInput\?\.unit\.label \|\| '主视觉'/,
  'persisted output must use the planned carousel page identity');

console.log('social image multi-output route admission contract passed');

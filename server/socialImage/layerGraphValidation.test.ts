import assert from 'node:assert/strict';
import { defaultSocialImageTask } from './socialImageTask.js';
import { compileLuxuryProductHero } from './templates/luxuryProductHero.js';
import { socialImageLayerGraphIssues } from './layerGraphValidation.js';

const task = defaultSocialImageTask({
  title: 'GUIANFA 黑金海报', creationPath: 'viral_replication', imageType: 'product_poster',
  coreClaim: '鎏金焕亮，滋养干枯受损发丝', productRefs: ['product-27'], productNames: ['GUIANFA Illamyth Sky Gold'],
  audience: ['海外采购'], referenceUrls: ['https://example.com/reference.jpg'],
});
task.imageTextContract = { ...task.imageTextContract, headline: 'Illamyth Sky Gold', supportingText: 'Golden care for visibly polished hair', cta: 'Contact us' };
const graph = compileLuxuryProductHero({ task, productId: 'product-27', productName: 'GUIANFA Illamyth Sky Gold', now: '2026-10-20T00:00:00.000Z' });
assert.deepEqual(socialImageLayerGraphIssues(graph), []);
assert.equal(graph.templateId, 'luxury-product-hero-v1');
assert.equal(graph.layers.find(layer => layer.kind === 'product')?.sourceAssetId, 'product-27');

const invalid = structuredClone(graph);
invalid.layers.push({ id: 'blocking-card', kind: 'overlay', zIndex: 99, rect: { x: .38, y: .18, width: .56, height: .7 }, opacity: .8 });
assert.match(socialImageLayerGraphIssues(invalid).join('；'), /超过 12%/);

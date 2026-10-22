import assert from 'node:assert/strict';
import sharp from 'sharp';
import { defaultSocialImageTask } from './socialImageTask.js';
import { compileLuxuryProductHero } from './templates/luxuryProductHero.js';
import { renderSocialImageLayerGraph } from './layerRenderer.js';

const task = defaultSocialImageTask({
  title: 'GUIANFA 黑金海报', imageType: 'product_poster', coreClaim: '鎏金焕亮',
  productRefs: ['product-27'], productNames: ['GUIANFA Illamyth Sky Gold'], audience: ['采购'],
});
task.imageTextContract = { ...task.imageTextContract, headline: 'ILLAMYTH SKY GOLD', supportingText: 'Golden care for polished hair', cta: 'CONTACT US' };
const graph = compileLuxuryProductHero({ task, productId: 'product-27', productName: 'GUIANFA Illamyth Sky Gold' });
const product = await sharp(Buffer.from(`<svg width="420" height="720" xmlns="http://www.w3.org/2000/svg">
  <rect width="420" height="720" fill="#fff"/><rect x="105" y="90" width="210" height="560" rx="48" fill="#bd842f"/>
  <rect x="150" y="25" width="120" height="120" rx="18" fill="#302011"/><text x="210" y="400" text-anchor="middle" fill="#111" font-size="31">GUIANFA</text>
</svg>`)).png().toBuffer();
const result = await renderSocialImageLayerGraph({ graph, assets: new Map([['product-27', product]]) });
const metadata = await sharp(result.bytes).metadata();
assert.equal(result.mimeType, 'image/png');
assert.equal(metadata.width, 1200);
assert.equal(metadata.height, 1500);
assert.ok(result.bytes.length > 20_000);

const blueprintTask = defaultSocialImageTask({
  title: '遮罩复刻', imageType: 'product_poster', creationPath: 'viral_replication', coreClaim: '结构复刻', productRefs: ['product-27'],
  referenceLayerBlueprints: [{ imageIndex: 1, layers: [
    { id: 'background', role: 'background', zIndex: 0, bounds: { x: 0, y: 0, width: 1, height: 1 }, confidence: 1 },
    { id: 'mask', role: 'mask', zIndex: 4, bounds: { x: .04, y: .08, width: .5, height: .5 }, confidence: .9 },
    { id: 'product', role: 'product', zIndex: 2, bounds: { x: .38, y: .18, width: .56, height: .7 }, confidence: .9 },
    { id: 'text', role: 'text', zIndex: 5, bounds: { x: .08, y: .1, width: .36, height: .3 }, confidence: .9 },
  ], masks: [{ id: 'glass', shape: 'ellipse', bounds: { x: .04, y: .08, width: .5, height: .5 }, opacity: .55, color: '#123456', zIndex: 4, confidence: .9 }] }],
});
blueprintTask.imageTextContract = { ...blueprintTask.imageTextContract, headline: 'LAYERED' };
const blueprintGraph = compileLuxuryProductHero({ task: blueprintTask, productId: 'product-27', productName: 'Product' });
assert.equal(blueprintGraph.layers.find(layer => layer.id === 'reference-glass')?.mask?.shape, 'ellipse');
assert.ok((blueprintGraph.layers.find(layer => layer.id === 'reference-glass')?.zIndex || 0) > (blueprintGraph.layers.find(layer => layer.id === 'product-hero')?.zIndex || 0));
await renderSocialImageLayerGraph({ graph: blueprintGraph, assets: new Map([['product-27', product]]) });

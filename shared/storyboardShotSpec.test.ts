import assert from 'node:assert/strict';
import { compileStoryboardShotSpec } from './storyboardShotSpec.js';

const product = { role: 'product' as const, id: 'kb-product-1', version: 'image-hash-1', source: 'knowledge_base' as const };
const sourceFrame = { role: 'composition' as const, id: 'source-shot-1', version: 'frame-hash-1', source: 'reference_video' as const };
const base = {
  shotId: 'shot-1', mode: 'replication' as const, scene: 'usage' as const,
  description: '安装吊灯，先对准安装位，然后固定', ratio: '9:16' as const,
  startSeconds: 3, endSeconds: 9, assets: [sourceFrame, product],
  action: { startState: '灯具在安装位下方', beats: ['对准安装位', '固定'], endState: '灯具已经固定', evidence: 'confirmed_reference_analysis' as const },
};
const spec = compileStoryboardShotSpec(base);
assert.equal(spec.targetDurationSeconds, 6);
assert.equal(spec.layout.preserveSourceComposition, true);
assert.deepEqual(spec.action.beats, ['对准安装位', '固定']);
assert.deepEqual(spec.constraints, ['product_identity', 'physical_contact', 'action_completion']);
assert.equal(spec.assets.find(item => item.role === 'product')?.source, 'knowledge_base');
assert.throws(() => compileStoryboardShotSpec({ ...base, assets: [product] }), /missing_source_frame/);
assert.throws(() => compileStoryboardShotSpec({ ...base, assets: [sourceFrame] }), /missing_product/);
assert.equal(compileStoryboardShotSpec({ ...base, action: { ...base.action, endState: '' } }).action.endState, '');
assert.throws(() => compileStoryboardShotSpec({ ...base, startSeconds: 9, endSeconds: 3 }), /invalid_time_range/);
const freeFactory = compileStoryboardShotSpec({ shotId: 'factory', mode: 'free_creation', scene: 'factory', description: '工厂设备运转', ratio: '16:9', assets: [] });
assert.equal(freeFactory.targetDurationSeconds, 4);
assert.equal(freeFactory.layout.preserveSourceComposition, false);
assert.deepEqual(freeFactory.constraints, ['factory_space']);
const general = compileStoryboardShotSpec({ shotId: 'ambient', mode: 'free_creation', scene: 'general', description: '人物走过走廊', ratio: '9:16', assets: [] });
assert.equal(general.layout.subject, 'subject described by the storyboard');
assert.ok(!general.constraints.includes('product_identity'));
const twoProducts = compileStoryboardShotSpec({ ...base, assets: [sourceFrame, product, { ...product, id: 'kb-product-2', version: 'image-hash-2' }] });
assert.equal(twoProducts.assets.filter(item => item.role === 'product').length, 2);
assert.throws(() => compileStoryboardShotSpec({ ...base, assets: [sourceFrame, product, product] }), /duplicate_asset/);
const geometric = compileStoryboardShotSpec({ ...base, layout: { productBox: { x: .4, y: .3, width: .2, height: .2 }, contactSurfaceY: .5, contactScene: 'tabletop', productView: 'front' } });
assert.equal(geometric.version, 'storyboard-shot-spec-v2');
assert.deepEqual(geometric.layout.productBox, { x: .4, y: .3, width: .2, height: .2 });
assert.throws(() => compileStoryboardShotSpec({ ...base, layout: { productBox: { x: .9, y: .3, width: .2, height: .2 } } }), /invalid_product_box/);
assert.throws(() => compileStoryboardShotSpec({ ...base, layout: { contactSurfaceY: 1.2 } }), /invalid_contact_surface_y/);
console.log('storyboardShotSpec tests passed');

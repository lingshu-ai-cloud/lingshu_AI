import assert from 'node:assert/strict';
import { planStoryboardExactProductGeometry, storyboardGeometryObservationPrompt,
  type StoryboardGeometryInput, type StoryboardGeometryObservation } from './storyboardGeometryPlanner.js';

const base: StoryboardGeometryInput = {
  shotId: 'shot-1', mode: 'replication', scene: 'tabletop', confirmedVisual: '产品在桌面中央的近景，正面朝镜头',
  product: { assetId: 'lamp-photo', version: 'sha256:one', view: 'front', cutoutAspectRatio: .5 },
  sourceFrame: { assetId: 'video-a:shot-1:first', version: 'sha256:frame', mimeType: 'image/jpeg', base64: 'source-image' },
};
const observed: StoryboardGeometryObservation = {
  shotId: 'shot-1', sourceFrameAssetId: 'video-a:shot-1:first', sourceFrameVersion: 'sha256:frame',
  scene: 'tabletop', productBox: { x: .4, y: .38, width: .2, height: .4 }, contactSurfaceY: .78,
  productView: 'front', foregroundOcclusion: 'none', confidence: .93, evidence: '当前首帧中产品立于桌面中央，底边与桌面接触',
};
const inference = async () => observed;
const ready = await planStoryboardExactProductGeometry(base, inference);
assert.equal(ready.status, 'ready');
if (ready.status === 'ready') {
  assert.equal(ready.source, 'observed_source_frame');
  assert.deepEqual(ready.layout.productBox, observed.productBox);
  assert.equal(ready.layout.contactSurfaceY, .78);
  assert.equal(ready.sourceFrameVersion, base.sourceFrame!.version);
}
assert.match(storyboardGeometryObservationPrompt(base), /current storyboard shot first frame/);
assert.equal((await planStoryboardExactProductGeometry({ ...base, sourceFrame: undefined }, inference)).status, 'blocked');
assert.equal((await planStoryboardExactProductGeometry(base)).status, 'blocked');
assert.equal((await planStoryboardExactProductGeometry(base, async () => ({ ...observed,
  sourceFrameAssetId: 'video-a:shot-2:first' }))).status, 'blocked', 'adjacent shot geometry is not evidence for this shot');
assert.equal((await planStoryboardExactProductGeometry(base, async () => ({ ...observed,
  confidence: .7 }))).status, 'blocked');
assert.equal((await planStoryboardExactProductGeometry(base, async () => ({ ...observed,
  contactSurfaceY: .96 }))).status, 'blocked', 'floating placement cannot pass');
assert.equal((await planStoryboardExactProductGeometry(base, async () => ({ ...observed,
  productView: 'back' }))).status, 'blocked', 'missing back-view product image must not be invented');
assert.equal((await planStoryboardExactProductGeometry(base, async () => ({ ...observed,
  foregroundOcclusion: 'required' }))).status, 'blocked', 'occluded product needs foreground layer');
assert.equal((await planStoryboardExactProductGeometry({ ...base, foregroundOccluderAssetId: 'occluder-1' },
  async () => ({ ...observed, foregroundOcclusion: 'required' }))).status, 'ready');
const conveyor = await planStoryboardExactProductGeometry({ ...base, scene: 'conveyor' },
  async () => ({ ...observed, scene: 'conveyor' }));
assert.equal(conveyor.status, 'ready');
const free = await planStoryboardExactProductGeometry({ ...base, mode: 'free_creation', sourceFrame: undefined,
  confirmedVisual: '产品摆在画面右侧桌面上，正面朝镜头' });
assert.equal(free.status, 'ready', 'free creation may author a deterministic layout from the confirmed shot');
if (free.status === 'ready') {
  assert.equal(free.source, 'authored_template');
  assert.ok(free.layout.productBox!.x > .5);
}
const freeConveyor = await planStoryboardExactProductGeometry({ ...base, mode: 'free_creation', sourceFrame: undefined,
  scene: 'conveyor', confirmedVisual: '产品在流水线传送带中央' });
assert.equal(freeConveyor.status, 'ready');
if (freeConveyor.status === 'ready') assert.equal(freeConveyor.layout.contactScene, 'conveyor');
assert.equal((await planStoryboardExactProductGeometry({ ...base, mode: 'free_creation', sourceFrame: undefined,
  confirmedVisual: '产品同时在画面左侧和右侧' })).status, 'blocked');
assert.equal((await planStoryboardExactProductGeometry({ ...base, mode: 'free_creation', sourceFrame: undefined,
  confirmedVisual: '产品背面在桌上' })).status, 'blocked', 'unsupported product view requires another knowledge-base image');
const explicit = await planStoryboardExactProductGeometry({ ...base, mode: 'free_creation', sourceFrame: undefined,
  confirmedLayout: { shotId: 'shot-1', scene: 'tabletop', productBox: { x: .2, y: .3, width: .2, height: .4 },
    contactSurfaceY: .7, productView: 'front' } });
assert.equal(explicit.status, 'ready');
if (explicit.status === 'ready') assert.equal(explicit.source, 'confirmed_layout');
console.log('storyboardGeometryPlanner tests passed');

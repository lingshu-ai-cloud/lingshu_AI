import assert from 'node:assert/strict';
import { adjustProductPlacement, productPlacementPreset, validProductPlacement } from './storyboardPlacement.js';

for (const scene of ['tabletop', 'conveyor'] as const) {
  for (const preset of ['left', 'center', 'right'] as const) {
    const placement = productPlacementPreset(scene, preset);
    assert.equal(placement.contactScene, scene);
    assert.ok(validProductPlacement(placement));
    assert.ok(Math.abs(placement.productBox.y + placement.productBox.height - placement.contactSurfaceY) < .001);
  }
}
assert.ok(!validProductPlacement({ ...productPlacementPreset('tabletop', 'center'), productBox: { x: .9, y: .4, width: .3, height: .4 } }));
assert.ok(!validProductPlacement({ ...productPlacementPreset('conveyor', 'center'), contactSurfaceY: .2 }));
const adjusted = adjustProductPlacement(productPlacementPreset('tabletop', 'center'), 'contactSurfaceY', .62);
assert.ok(validProductPlacement(adjusted));
assert.equal(adjusted.productBox.y + adjusted.productBox.height, .62);
assert.ok(validProductPlacement(adjustProductPlacement(adjusted, 'x', 1)));
console.log('storyboard placement controls passed');

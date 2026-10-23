import assert from 'node:assert/strict';
import test from 'node:test';
import { presenterProductionRoute } from './presenterProductionRoute.js';

test('product routes keep real footage and verified silent motion distinct from generated speech', () => {
  assert.equal(presenterProductionRoute({sourceStrategy:'customer_real_asset'}).executable,true);
  assert.equal(presenterProductionRoute({sourceStrategy:'authorized_digital_presenter',method:'reenact',silentMotion:true}).kind,'silent_motion');
  for (const method of [undefined,'talking_head','reenact']) {
    const route=presenterProductionRoute({sourceStrategy:'authorized_digital_presenter',method});
    assert.equal(route.executable,false);
    assert.equal(route.code,'presenter_speech_route_unavailable');
    assert.equal(route.nextActions.length,3);
    assert.ok(route.nextActions.some(action=>action.includes('重新确认')));
  }
});

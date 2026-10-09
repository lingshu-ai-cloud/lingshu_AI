import assert from 'node:assert/strict';
import test from 'node:test';
import { openMaterialPanelRequest, materialRequestPanelId } from './weeklyMaterialNavigation';
test('material production entry scrolls only a concrete request in the current surface and exact week version',()=>{
 let scrolls=0;const current={id:materialRequestPanelId('program/a','week',2,'request/a'),scrollIntoView:()=>{scrolls++;}};
 const old={id:materialRequestPanelId('program/a','week',1,'request/a'),scrollIntoView:()=>{throw Error('must not open older version');}};
 const container={querySelectorAll:()=>[old,current]} as unknown as Pick<HTMLElement,'querySelectorAll'>;
 assert.equal(openMaterialPanelRequest(container,'program/a','week',2,'request/a'),true);assert.equal(scrolls,1);
 assert.equal(openMaterialPanelRequest(container,'other-program','week',2,'request/a'),false);
 assert.equal(openMaterialPanelRequest(container,'program/a','week',3,'request/a'),false);
 assert.equal(openMaterialPanelRequest(null,'program/a','week',2,'request/a'),false);
});

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
test('upload and verification focus only their exact live control and reject ambiguous or mismatched metadata',()=>{
 let scrolled=0,focused=0;const details={tagName:'DETAILS',open:false,parentElement:null};
 const target=(action:'upload'|'verification')=>({id:`${materialRequestPanelId('p','w',2,'r')}:${action}`,dataset:{materialProgram:'p',materialPackage:'w',materialVersion:'2',materialRequest:'r',materialAction:action},parentElement:details,scrollIntoView:()=>{scrolled++;},querySelector:()=>({focus:()=>{focused++;}})});
 const upload=target('upload'),verification=target('verification');
 const container={querySelectorAll:()=>[upload,verification]} as unknown as Pick<HTMLElement,'querySelectorAll'>;
 assert.equal(openMaterialPanelRequest(container,'p','w',2,'r','verification'),true);assert.equal(scrolled,1);assert.equal(focused,1);assert.equal(details.open,true);
 assert.equal(openMaterialPanelRequest({querySelectorAll:()=>[upload]} as unknown as Pick<HTMLElement,'querySelectorAll'>,'p','w',2,'r','verification'),false);
 assert.equal(openMaterialPanelRequest({querySelectorAll:()=>[upload,upload]} as unknown as Pick<HTMLElement,'querySelectorAll'>,'p','w',2,'r','upload'),false);
 verification.dataset.materialVersion='1';assert.equal(openMaterialPanelRequest(container,'p','w',2,'r','verification'),false);assert.equal(scrolled,1);
});

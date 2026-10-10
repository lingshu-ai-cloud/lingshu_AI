import test from 'node:test';
import assert from 'node:assert/strict';
import {materialActionPanelId,openMaterialPanelRequest} from './weeklyMaterialNavigation';
function surface(action:'upload'|'verification'){
 let scrolls=0,focuses=0;const details={tagName:'DETAILS',open:false,parentElement:null};
 const control={focus:()=>{focuses++;}};
 const node={id:materialActionPanelId('program','week',2,'request',action),dataset:{materialProgram:'program',materialPackage:'week',materialVersion:'2',materialRequest:'request',materialAction:action as string},parentElement:details,querySelector:()=>control,scrollIntoView:()=>{scrolls++;}};
 return {node,details,effects:()=>[scrolls,focuses]};
}
const root=(nodes:unknown[])=>({querySelectorAll:()=>nodes}) as unknown as Pick<HTMLElement,'querySelectorAll'>;
test('material clicks select upload or verification controls and expand only their existing section',()=>{const upload=surface('upload'),review=surface('verification');const container=root([upload.node,review.node]);assert.equal(openMaterialPanelRequest(container,'program','week',2,'request','verification'),true);assert.deepEqual(upload.effects(),[0,0]);assert.equal(upload.details.open,false);assert.deepEqual(review.effects(),[1,1]);assert.equal(review.details.open,true);});
test('material clicks never fall back to another action or stale and duplicate controls',()=>{
 for(const nodes of [[],[surface('upload').node],[surface('verification').node,surface('verification').node]])assert.equal(openMaterialPanelRequest(root(nodes),'program','week',2,'request','verification'),false);
 for(const field of ['materialProgram','materialPackage','materialVersion','materialRequest','materialAction']){const ui=surface('verification');ui.node.dataset[field as keyof typeof ui.node.dataset]='foreign';assert.equal(openMaterialPanelRequest(root([ui.node]),'program','week',2,'request','verification'),false);assert.deepEqual(ui.effects(),[0,0]);assert.equal(ui.details.open,false);}
 const ui=surface('verification');for(const version of [1,3,0,NaN])assert.equal(openMaterialPanelRequest(root([ui.node]),'program','week',version,'request','verification'),false);
 assert.equal(openMaterialPanelRequest(root([ui.node]),'program','week',2,'request','invented' as 'verification'),false);assert.deepEqual(ui.effects(),[0,0]);
});

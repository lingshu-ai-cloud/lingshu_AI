import assert from 'node:assert/strict';
import test from 'node:test';
import React,{type ReactElement,type ReactNode} from 'react';
import TrafficPage from './TrafficPage';
import type {WeeklyContentNavigation} from '../../shared/contracts/weeklyContentNavigation';

type Element=ReactElement<Record<string,unknown>>;
function elements(node:ReactNode):Element[]{
  if(Array.isArray(node))return node.flatMap(elements);
  if(!React.isValidElement(node))return [];
  const element=node as Element;
  return [element,...elements(element.props.children as ReactNode)];
}
const target:WeeklyContentNavigation={scope:{tenantId:'tenant',programId:'program',packageId:'week',packageVersion:2,executionTaskId:'execution'},publicationTaskId:'publication',contentTaskId:'content',runId:'original-run',artifactRef:null,bindingKey:'binding',source:'production_binding',gaps:[]};
function render(historyState:unknown,taskId='content'){
  const globals=globalThis as unknown as Record<string,unknown>;
  const originalWindow=globals.window;
  globals.window={history:{state:historyState}};
  const internals=(React as unknown as {__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE:{H:unknown}}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previous=internals.H;
  internals.H={useState:(initial:unknown)=>[typeof initial==='function'?initial():initial,()=>{}],useRef:(current:unknown)=>({current}),useEffect:()=>{},useCallback:(callback:unknown)=>callback};
  try{return elements(TrafficPage({initialView:'create',showModeTabs:false,socialContentTaskId:taskId,onEnterConversation:()=>{},onLeaveConversation:()=>{},isInConversation:false}));}
  finally{internals.H=previous;if(originalWindow===undefined)delete globals.window;else globals.window=originalWindow;}
}
const studio=(nodes:Element[])=>nodes.filter(node=>typeof node.props.onGoPublish==='function'&&node.props.socialContentTaskId==='content');
test('actual Traffic create component chooses the original weekly view for a valid matching target',()=>{
  const nodes=render({productionDetail:{weeklyContentTarget:target,socialContentTaskId:'content',socialContentPage:'smartAssets'}});
  assert.equal(nodes.filter(node=>node.props.target===target).length,1);
  assert.equal(studio(nodes).length,0);
});
test('malformed or mismatching weekly targets show an identity alert and cannot fall into generic creation',()=>{
  for(const historyState of [{productionDetail:{weeklyContentTarget:{broken:true}}},{productionDetail:{weeklyContentTarget:{...target,contentTaskId:'other-content'},socialContentTaskId:'other-content',socialContentPage:'smartAssets'}}]){
    const nodes=render(historyState);
    assert.equal(nodes.filter(node=>node.props.role==='alert'&&String(node.props.children).includes('周任务生产目标')).length,1);
    assert.equal(studio(nodes).length,0);
  }
});
test('clearing the weekly target restores the generic studio with the same content task',()=>{
  const nodes=render({productionDetail:{socialContentTaskId:'content',socialContentPage:'smartAssets'}});
  assert.equal(studio(nodes).length,1);
  assert.equal(nodes.filter(node=>node.props.target).length,0);
  assert.equal(nodes.filter(node=>node.props.role==='alert').length,0);
});

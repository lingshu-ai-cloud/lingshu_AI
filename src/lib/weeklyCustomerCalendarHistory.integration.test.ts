import test from 'node:test';
import assert from 'node:assert/strict';
import {captureAgentCalendarReturnContext,readAgentCalendarReturnContext,registerAgentCalendarReturnState,restoreAgentCalendarReturnContext,persistAgentCalendarReturnContext} from './agentCalendarReturnContext';
import {pushProductionLocation,restorableProductionDetail,canRestoreProductionHistoryState} from './productionNavigation';
import {customerItemProductionLink} from './weeklyCustomerProductionLink';
import {dispatchDigitalEmployeeDeepLink,consumeDigitalEmployeeReturnContext} from './digitalEmployees';

for(const channel of ['whatsapp','messenger','instagram'] as const){
 test(`${channel} history and refresh restore date/filter/scroll/card while identity changes reject replay`,t=>{
  const names=['window','document','localStorage','sessionStorage','HTMLElement'] as const;
  const old=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const globals=globalThis as unknown as Record<string,unknown>;
  const session=new Map<string,string>();let token='original';
  const storage={setItem:(key:string,value:string)=>session.set(key,value),getItem:(key:string)=>session.get(key)??null,removeItem:(key:string)=>session.delete(key)};
  let historyState:Record<string,unknown>={page:'digitalEmployees'};
  class Node{children:Node[]=[];parentElement:Node|null=null;scrollLeft=0;scrollTop=0;dataset={agentCalendarPositionKey:'program:week:2'};closest(){return null;}getClientRects(){return [{}];}}
  const body=new Node(),panel=new Node();body.children=[panel];panel.parentElement=body;panel.scrollLeft=170;panel.scrollTop=600;
  const frames:Array<()=>void>=[];let restoredScroll=[0,0];
  globals.HTMLElement=Node;globals.document={body,querySelectorAll:()=>[panel]};globals.localStorage={getItem:()=>token};globals.sessionStorage=storage;
  globals.window={sessionStorage:storage,location:{href:'http://localhost/?page=digitalEmployees'},history:{get state(){return historyState;},replaceState(next:Record<string,unknown>){historyState=next;},pushState(next:Record<string,unknown>){historyState=next;}},scrollX:0,scrollY:900,scrollTo:(left:number,top:number)=>{restoredScroll=[left,top];},requestAnimationFrame:(callback:()=>void)=>{frames.push(callback);},dispatchEvent:()=>true};
  let dispose=()=>{};
  t.after(()=>{dispose();for(const name of names){const descriptor=old[name];if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}});
  let workspace={packageId:'week',packageVersion:2,date:'2026-10-10',agentFilter:'customer',statusFilter:'blocked',workspaceView:'today'};
  const provider={read:()=>({...workspace}),restore:(value:unknown)=>{workspace=value as typeof workspace;}};
  dispose=registerAgentCalendarReturnState('digitalEmployee.workspace',provider);
  const calendar={positionKey:'program:week:2',offset:-2,cardId:`customer-${channel}`};
  captureAgentCalendarReturnContext(calendar);const source=historyState;
  const expected={tenantId:'tenant',programId:'program',packageId:'week',packageVersion:2,channel,accountId:'account',customerId:'customer',conversationId:`${channel}:conversation`,runId:'run',taskId:'task',itemId:'item'};
  const link=customerItemProductionLink({runId:'run',taskId:'task',itemId:'item',expected});
  dispatchDigitalEmployeeDeepLink(link);pushProductionLocation('conversion',{productionDetail:link});
  assert.equal(restorableProductionDetail(historyState),null,'history must not replay prior customer detail');
  assert.deepEqual(consumeDigitalEmployeeReturnContext()?.customerNavigation,expected);
  dispose();historyState=source;workspace={...workspace,packageId:'different',date:'2026-10-24',agentFilter:'all'};panel.scrollLeft=0;panel.scrollTop=0;
  dispose=registerAgentCalendarReturnState('digitalEmployee.workspace',provider);restoreAgentCalendarReturnContext();
  while(frames.length)frames.shift()!();
  assert.equal(workspace.date,'2026-10-10');assert.equal(workspace.agentFilter,'customer');assert.equal(workspace.packageId,'week');
  assert.deepEqual([panel.scrollLeft,panel.scrollTop],[170,600]);assert.deepEqual(restoredScroll,[0,900]);assert.deepEqual(readAgentCalendarReturnContext()?.calendar,calendar);
  persistAgentCalendarReturnContext();dispose();historyState={page:'digitalEmployees'};
  workspace={...workspace,date:'wrong'};dispose=registerAgentCalendarReturnState('digitalEmployee.workspace',provider);
  assert.equal(workspace.date,'2026-10-10','refresh without history state restores saved date');assert.deepEqual(readAgentCalendarReturnContext()?.calendar,calendar);
  dispatchDigitalEmployeeDeepLink(link);pushProductionLocation('conversion',{productionDetail:link});token='foreign-tenant';
  assert.equal(consumeDigitalEmployeeReturnContext(),null);assert.equal(readAgentCalendarReturnContext(),null);assert.equal(canRestoreProductionHistoryState(historyState),false);assert.equal(restorableProductionDetail(historyState),null);
 });
}

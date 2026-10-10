import test from 'node:test';
import assert from 'node:assert/strict';
import type {AgentCalendarTask} from '../smartBusiness/AgentWeeklyCalendar';
import {revealWeeklySalesAction,salesActionPanelId,type WeeklySalesNavigationTarget} from './weeklySalesNavigation';
const scope={tenantId:'tenant',programId:'program',packageId:'week',packageVersion:1};
const target:WeeklySalesNavigationTarget={...scope,handoffId:'handoff',handoffVersion:3,runId:'run',memberId:'member',customerId:'customer',action:'feedback'};
const card:AgentCalendarTask={id:'sales:handoff:feedback',agent:'human',date:'2026-10-06',time:'12:00',title:'反馈',context:'客户交接',output:'真实证据',minutes:null,status:'planned',salesTarget:target,salesHandoffId:'handoff',salesPackageId:'week',salesPackageVersion:1,salesAction:'feedback'};
function surface(value=target){let scrolls=0,focuses=0;const details={open:false};const node={id:salesActionPanelId(value),dataset:{salesTarget:JSON.stringify(value)},closest:()=>details,scrollIntoView:()=>{scrolls++;},focus:()=>{focuses++;}};const root={querySelectorAll:()=>[node]} as unknown as HTMLElement;return {root,node,details,effects:()=>[scrolls,focuses]};}
test('sales click reveals the exact feedback control and expands its existing details',()=>{const ui=surface();revealWeeklySalesAction(card,scope,ui.root);assert.deepEqual(ui.effects(),[1,1]);assert.equal(ui.details.open,true);});
test('sales clicks reject malformed bindings and stale or foreign identities without opening controls',()=>{
 const variants=[{...card,id:'sales:handoff:claim'},{...card,salesAction:'claim'},{...card,salesTarget:undefined},{...card,salesTarget:{...target,action:'invented'}},{...card,salesTarget:{...target,handoffVersion:0}},...['tenantId','programId','packageId','runId','memberId','customerId','handoffId'].map(k=>({...card,salesTarget:{...target,[k]:'foreign'}})),{...card,salesTarget:{...target,packageVersion:2}},{...card,salesTarget:{...target,handoffVersion:4}}] as AgentCalendarTask[];
 for(const altered of variants){const ui=surface();assert.throws(()=>revealWeeklySalesAction(altered,scope,ui.root));assert.deepEqual(ui.effects(),[0,0]);assert.equal(ui.details.open,false);}
});
test('sales click rejects duplicate or mismatched current controls and never selects an old article',()=>{
 const ui=surface();for(const nodes of [[ui.node,ui.node],[{...ui.node,dataset:{salesTarget:JSON.stringify({...target,memberId:'foreign'})}}],[]]){const root={querySelectorAll:()=>nodes} as unknown as HTMLElement;assert.throws(()=>revealWeeklySalesAction(card,scope,root));assert.deepEqual(ui.effects(),[0,0]);assert.equal(ui.details.open,false);}
 assert.throws(()=>revealWeeklySalesAction(card,scope,null));
});

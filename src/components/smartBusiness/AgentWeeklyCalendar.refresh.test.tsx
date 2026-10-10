import assert from 'node:assert/strict';
import test from 'node:test';
import React,{type ReactElement,type ReactNode} from 'react';
import Calendar,{type AgentCalendarTask} from './AgentWeeklyCalendar';
import {agentCalendarAuthIdentity,captureAgentCalendarReturnContext,readAgentCalendarReturnContext} from '../../lib/agentCalendarReturnContext';

type Element=ReactElement<Record<string,unknown>>;
function nodes(node:ReactNode):Element[]{if(Array.isArray(node))return node.flatMap(nodes);if(!React.isValidElement(node))return [];const e=node as Element;return [e,...nodes(e.props.children as ReactNode)];}
function mount(props:Parameters<typeof Calendar>[0],visible:(key:string)=>void){
 const internals=(React as unknown as {__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE:{H:unknown}}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
 const values:unknown[]=[],dependencies:Array<unknown[]|undefined>=[],pending:Array<()=>void|(()=>void)>=[],cleanups:Array<()=>void>=[];
 let tree:ReactNode,cursor=0,effect=0,dirty=false;
 const render=()=>{const previous=internals.H;cursor=0;effect=0;dirty=false;internals.H={
  useState(initial:unknown){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return [values[i],(next:unknown)=>{const v=typeof next==='function'?next(values[i]):next;if(v!==values[i]){values[i]=v;dirty=true;}}];},
  useEffect(fn:()=>void|(()=>void),deps:unknown[]){const i=effect++;if(!dependencies[i]||deps?.some((v,j)=>v!==dependencies[i]?.[j])){dependencies[i]=deps;pending.push(fn);}},
 };try{tree=Calendar(props);}finally{internals.H=previous;}const key=nodes(tree).find(n=>n.props['data-agent-calendar-position-key'])?.props['data-agent-calendar-position-key'];visible(String(key));};
 render();let passes=0;while(pending.length||dirty){assert(++passes<15,'effects converge');const callbacks=pending.splice(0);for(const fn of callbacks){const cleanup=fn();if(cleanup)cleanups.push(cleanup);}if(dirty)render();}
 return {nodes:()=>nodes(tree),dispose:()=>cleanups.forEach(fn=>fn())};
}
test('temporary loading calendar cannot overwrite original refreshed week offset or focused card',()=>{
 const globals=globalThis as unknown as Record<string,unknown>;const keys=['window','document'];const original=Object.fromEntries(keys.map(k=>[k,globals[k]]));
 let state:Record<string,unknown>={},visibleKey='';const root={dataset:{get agentCalendarPositionKey(){return visibleKey;}},getClientRects:()=>[{}]};
 globals.document={body:{children:[]},querySelectorAll:(selector:string)=>selector==='[data-agent-calendar-position-key]'?[root]:[]};
 globals.window={history:{get state(){return state;},replaceState(next:Record<string,unknown>){state=next;}},scrollX:0,scrollY:0,requestAnimationFrame:()=>0};
 const props={scopeKey:'tenant/program/package/2',startsAt:'2026-10-05',tasks:[{id:'original-card',date:'2026-10-13',time:'12:00',agent:'customer',title:'Original',output:'Read actual receipt',context:'Original package',minutes:10,status:'blocked'} as AgentCalendarTask]};
 const positionKey=JSON.stringify([agentCalendarAuthIdentity(),props.scopeKey,props.startsAt,false]);const mounted:Array<ReturnType<typeof mount>>=[];
 try{
  captureAgentCalendarReturnContext({positionKey,offset:1,cardId:'original-card'});
  mounted.push(mount({scopeKey:'loading/program/package/2',startsAt:'2026-10-05',tasks:[]},key=>{visibleKey=key;}));
  assert.equal(readAgentCalendarReturnContext()?.calendar.positionKey,positionKey,'loading must preserve the source snapshot');
  const restored=mount(props,key=>{visibleKey=key;});mounted.push(restored);
  assert.equal(readAgentCalendarReturnContext()?.calendar.offset,1);
  assert(restored.nodes().some(n=>String(n.props.children).includes('10/12')&&String(n.props.children).includes('10/18')),'restored calendar displays offset 1');
  assert.equal(restored.nodes().find(n=>n.props['data-agent-calendar-card-id']==='original-card')?.props['aria-current'],'true');
  assert.equal(restored.nodes().filter(n=>n.props.role==='dialog').length,0,'card identity restores focus only');
 }finally{mounted.forEach(m=>m.dispose());for(const key of keys){if(original[key]===undefined)delete globals[key];else globals[key]=original[key];}}
});

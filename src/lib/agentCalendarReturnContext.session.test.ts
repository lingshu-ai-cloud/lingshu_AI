import assert from 'node:assert/strict';
import test from 'node:test';
import {captureAgentCalendarReturnContext,persistAgentCalendarReturnContext,readAgentCalendarReturnContext,registerAgentCalendarReturnState} from './agentCalendarReturnContext';

test('refresh persists latest filters and selected card without credentials and refuses changed login',()=>{
 const globals=globalThis as unknown as Record<string,unknown>;
 const keys=['window','document','localStorage','sessionStorage'];const originals=Object.fromEntries(keys.map(k=>[k,globals[k]]));
 let token='original-login',state:Record<string,unknown>={page:'digital-employee'};const session=new Map<string,string>();
 globals.localStorage={getItem:()=>token};globals.sessionStorage={getItem:(k:string)=>session.get(k)??null,setItem:(k:string,v:string)=>session.set(k,v)};
 globals.document={querySelectorAll:()=>[]};globals.window={history:{get state(){return state;},replaceState(s:Record<string,unknown>){state=s;}},scrollX:12,scrollY:44};
 let filters={agent:'all',status:'all'};let dispose=()=>{};
 try{
  dispose=registerAgentCalendarReturnState('tenant/program/package/2/filters',{read:()=>filters,restore:value=>{filters=value as typeof filters;}});
  captureAgentCalendarReturnContext({positionKey:'tenant/program/package/2',offset:-3,cardId:'customer-original'});
  filters={agent:'customer',status:'blocked'};persistAgentCalendarReturnContext();dispose();
  const originalState=state;state={page:'digital-employee'};filters={agent:'all',status:'all'};
  dispose=registerAgentCalendarReturnState('tenant/program/package/2/filters',{read:()=>filters,restore:value=>{filters=value as typeof filters;}});
  assert.deepEqual(filters,{agent:'customer',status:'blocked'});
  assert.deepEqual(readAgentCalendarReturnContext()?.calendar,{positionKey:'tenant/program/package/2',offset:-3,cardId:'customer-original'});
  assert(!JSON.stringify([...session]).includes(token),'session snapshot must not persist login credentials');
  token='replacement-login';assert.equal(readAgentCalendarReturnContext(),null);
  state=originalState;assert.equal(readAgentCalendarReturnContext(),null,'foreign history must not fallback to an older cache');
 }finally{dispose();for(const key of keys){if(originals[key]===undefined)delete globals[key];else globals[key]=originals[key];}}
});

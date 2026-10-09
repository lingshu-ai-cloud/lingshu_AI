import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyCustomerRunApi } from './weeklyCustomerRunApi';
test('candidate/binding API keeps exact encoded project/week/version/run and never starts or approves',async()=>{
  const previousFetch=globalThis.fetch;const previousStorage=globalThis.localStorage;Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=> 'fixture-token'}});
  const calls:Array<{url:string;method:string;body:unknown}>=[];
  globalThis.fetch=async(input,init)=>{calls.push({url:String(input),method:init?.method??'GET',body:init?.body?JSON.parse(String(init.body)):null});return Response.json(init?.method==='POST'?{item:{run_id:'run/a'}}:{items:[],boundRunId:null});};
  try {await weeklyCustomerRunApi.candidates('program/a','week/b',3);await weeklyCustomerRunApi.bind('program/a','week/b',3,'run/a');assert.deepEqual(calls,[{url:'/api/overseas/social-programs/program%2Fa/operating-packages/week%2Fb/customer-run-candidates?version=3',method:'GET',body:null},{url:'/api/overseas/social-programs/program%2Fa/operating-packages/week%2Fb/customer-run-binding',method:'POST',body:{packageVersion:3,runId:'run/a'}}]);}
  finally{globalThis.fetch=previousFetch;Object.defineProperty(globalThis,'localStorage',{configurable:true,value:previousStorage});}
});
test('HTML fallback, missing list and mismatched binding receipt fail instead of inventing running objects',async()=>{
 const previousFetch=globalThis.fetch;const previousStorage=globalThis.localStorage;Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=> 'fixture-token'}});
 try{for(const response of [new Response('<html>fallback</html>'),Response.json({}),Response.json({items:[{runId:''}],boundRunId:null})]){globalThis.fetch=async()=>response;await assert.rejects(weeklyCustomerRunApi.candidates('p','w',1));}globalThis.fetch=async()=>Response.json({item:{run_id:'other'}});await assert.rejects(weeklyCustomerRunApi.bind('p','w',1,'selected'));}
 finally{globalThis.fetch=previousFetch;Object.defineProperty(globalThis,'localStorage',{configurable:true,value:previousStorage});}
});

// Defect reproduction against baseline 43892e74. These assertions document defects, not desired behavior.
// Uses fake fetch and an in-memory store; does not call providers or write business data.
import assert from 'node:assert/strict';
import {requestDraft} from '../../../src/components/customers/customerReplyPreparation.ts';
import {createCustomerSegmentSnapshot} from '../../../server/digitalEmployees/customerWorkflow.ts';
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>null}});
const c:any={id:'audit-buyer',name:'Buyer',language:'英语',product:'Widget',outboundProduct:'Widget',stage:'lead',timeline:[{actor:'buyer',type:'messenger',body:'What is the unit price?',timestamp:1}]};
globalThis.fetch=async()=>new Response(JSON.stringify({error:'upstream_unavailable'}),{status:503});
const degraded=await requestDraft(c);assert.ok(degraded.draft);assert.equal((degraded as any).error,undefined);
console.log('PROBE 1: HTTP 503 returns a nonempty fallback draft with no error or degraded flag');
globalThis.fetch=async()=>new Response(JSON.stringify({draft:'Please confirm quantity.',translatedDraft:'请确认数量。',decision:{schemaVersion:1,execution:'human_required'},verification:{status:'safe_fallback'},enterpriseFactVersion:'facts-v1'}),{status:200});
const projected=await requestDraft(c);for(const key of ['decision','verification','enterpriseFactVersion'])assert.equal((projected as any)[key],undefined);
console.log('PROBE 2: requestDraft drops decision, verification and enterpriseFactVersion');
const data:Record<string,any[]>={};let failed=false;const ds:any={async list(collection:string,query:any){const items=(data[collection]||[]).filter(v=>Object.entries(query.where||{}).every(([k,value])=>v[k]===value));return{items,totalItems:items.length,totalPages:1,page:1,perPage:1000};},async create(collection:string,payload:any){if(collection==='customer_segment_members'&&payload.customer_id==='buyer-b'&&!failed){failed=true;throw Error('injected_storage_failure');}const row={...payload,id:collection+'-'+(data[collection]?.length||0)};(data[collection]??=[]).push(row);return row;}};
const input={tenantId:'audit',goalId:'goal',runId:'run',taskId:'task',userId:'owner',criteria:{}};
const buyers=async()=>[{id:'buyer-a',name:'A'},{id:'buyer-b',name:'B'}];
await assert.rejects(createCustomerSegmentSnapshot(input,buyers,ds),/injected_storage_failure/);
const replay=await createCustomerSegmentSnapshot(input,buyers,ds);assert.equal(replay.created,false);assert.equal(replay.segment.member_count,2);assert.equal(replay.members.length,1);
console.log('PROBE 3: interrupted segment creation replays as created=false, generated, member_count=2 but only 1 member; missing member is not repaired');

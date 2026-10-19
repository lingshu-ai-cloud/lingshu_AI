import {runWithDataAuthority} from '../server/storage/dataAuthority.js';
import {store} from '../server/storage/index.js';
import {runWeeklyPreproductionProducerScan,WEEKLY_PREPRODUCTION_JOBS} from '../server/runtime/weeklyPreproductionProducer.js';
import type {DataStore} from '../server/storage/datastore.js';
// Scope the existing producer to the explicitly selected local week. No general worker or external-send flag is enabled.
const scope={program_id:'7f9242c2-bdeb-40ea-ae59-6c2adbc96fad',package_id:'39eedb9f-30c3-46bb-b5f3-3922a006644d',package_version:2,kind:'outline'};
const scoped:DataStore={...store,list:(collection,query)=>store.list(collection,collection===WEEKLY_PREPRODUCTION_JOBS?{...query,where:{...query?.where,...scope}}:query)};
console.log(JSON.stringify(await runWithDataAuthority('local',()=>runWeeklyPreproductionProducerScan({store:scoped}))));
await runWithDataAuthority('local',async()=>{
 for(const collection of ['social_business_content_goals','social_operating_decisions']){
  const rows=await store.list(collection,{where:{program_id:scope.program_id},perPage:1000});
  console.log(JSON.stringify({collection,items:rows.items.map(row=>{const p=typeof row.payload==='string'?JSON.parse(row.payload):row.payload as Record<string,unknown>;return{id:row.id,status:p?.status,blockers:p?.blockers,output:p?.output?{status:(p.output as any).status,blockers:(p.output as any).blockers}:undefined};})}));
 }
});

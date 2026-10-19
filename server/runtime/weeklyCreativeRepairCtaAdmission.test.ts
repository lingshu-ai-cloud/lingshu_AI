import test from 'node:test';
import assert from 'node:assert/strict';
import type {DataStore,ListQuery,Record_} from '../storage/datastore.js';
import {adoptWeeklyAutomationTemplate} from '../socialPrograms/weeklyAutomationTemplate.js';
import {assertWeeklyCreativeRepairCtaAdmission} from './weeklyCreativeRepairCtaAdmission.js';

function memory():DataStore{
 const rows=new Map<string,Record_[]>();
 return {
  getById:async<T>(collection:string,id:string)=>structuredClone(rows.get(collection)?.find(row=>row.id===id)??null) as T|null,
  list:async<T>(collection:string,query:ListQuery={})=>{const values=(rows.get(collection)??[]).filter(row=>Object.entries(query.where??{}).every(([key,value])=>row[key]===value));return{items:structuredClone(values) as T[],totalItems:values.length,totalPages:1,page:1,perPage:query.perPage??30};},
  create:async<T>(collection:string,value:Record<string,unknown>)=>{const saved={id:String(value.id??`${collection}-${rows.get(collection)?.length??0}`),...structuredClone(value)};rows.set(collection,[...(rows.get(collection)??[]),saved]);return saved as T;},
  update:async()=>false,delete:async()=>false,
 };
}
const scope={tenantId:'tenant',programId:'program',packageId:'package',packageVersion:7};
test('creative repair cannot inherit an unverified free-sample CTA; unrelated CTA remains eligible',async()=>{
 const store=memory();
 await assert.rejects(assertWeeklyCreativeRepairCtaAdmission({store,...scope,inheritedCallToAction:'Contact us on WhatsApp to get your free sample.'}),{code:'weekly_production_cta_evidence_required'});
 await assertWeeklyCreativeRepairCtaAdmission({store,...scope,inheritedCallToAction:'Visit our catalog.'});
});
test('accepted frozen CTA remains blocked even if a child drops its text',async()=>{
 const store=memory();await adoptWeeklyAutomationTemplate(store,scope,'owner');
 await assert.rejects(assertWeeklyCreativeRepairCtaAdmission({store,...scope,inheritedCallToAction:'Visit our catalog.'}),{code:'weekly_production_cta_evidence_required'});
});

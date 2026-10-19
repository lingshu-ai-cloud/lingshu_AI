import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyEnterpriseFactFixture} from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import {readWeeklyCustomerSettings,updateWeeklyCustomerSettings} from './weeklyCustomerSettings.js';
test('task detail customer settings preserve publishing scope and require explicit current configuration',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t);
 store.compareAndSwap=async(collection,id,expected,data)=>{const current=await store.getById<Record<string,unknown>>(collection,id);if(!current||Object.entries(expected).some(([key,value])=>JSON.stringify(current[key])!==JSON.stringify(value)))return false;return store.update(collection,id,data);};
 await store.create('digital_employee_configs',{id:'customer-config',tenant_id:'tenant',status:'active',config_version:1,config:{enabledWorkflows:['viral_clone'],allowRealPublishing:false,allowRealCustomerMessages:false}});
 assert.equal((await readWeeklyCustomerSettings(store,'tenant')).public.enabled,false);
 await assert.rejects(readWeeklyCustomerSettings(store,'foreign'));
 await assert.rejects(updateWeeklyCustomerSettings(store,'tenant','owner',{expectedConfigVersion:2,enabled:true,allowRealCustomerMessages:true},{}),/变化/);
 const updated=await updateWeeklyCustomerSettings(store,'tenant','owner',{expectedConfigVersion:1,enabled:true,allowRealCustomerMessages:false},{});
 assert.equal(updated.configVersion,2);assert.equal(updated.enabled,true);assert.equal(updated.allowRealCustomerMessages,false);
 const row=(await readWeeklyCustomerSettings(store,'tenant')).row,config=row.config as Record<string,unknown>;
 assert.equal(config.allowRealPublishing,false);assert((config.enabledWorkflows as string[]).includes('viral_clone'));
 const history=await store.list('digital_employee_config_versions');assert.equal(history.totalItems,1);assert.equal(history.items[0]!.created_by,'owner');assert.equal(history.items[0]!.source,'weekly_task_details');
 const granted=await updateWeeklyCustomerSettings(store,'tenant','owner',{expectedConfigVersion:2,enabled:true,allowRealCustomerMessages:true},{});assert.equal(granted.allowRealCustomerMessages,true);
 await assert.rejects(updateWeeklyCustomerSettings(store,'tenant','owner',{expectedConfigVersion:3,enabled:false,allowRealCustomerMessages:true},{}),/不能/);
});

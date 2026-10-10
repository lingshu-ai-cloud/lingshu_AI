import assert from 'node:assert/strict';
import test from 'node:test';
import {auditWeeklyMaterialInventory} from './weeklyMaterialInventory.js';
test('inventory reports actual versions and missing metadata instead of clearing them from filenames',()=>{
 const rows=auditWeeklyMaterialInventory('t',[{id:'one',tenantId:'t',name:'authorized product full quality',type:'image'},{id:'foreign',tenantId:'other',type:'image'},{id:'ready',tenantId:'t',type:'image',contentSha256:'a'.repeat(64),licenseEvidence:'rights-1',commercialUseApproved:true,width:720,height:1280,productRef:'product-1'}]);
 assert.equal(rows.records.length,2);assert.equal(rows.records[0]!.productionEligible,false);assert.equal(rows.records[0]!.sha256,null);assert.equal(rows.records[1]!.productionEligible,true);assert.equal(rows.records[1]!.productRef,'product-1');
});

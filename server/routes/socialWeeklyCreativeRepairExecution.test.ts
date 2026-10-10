import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCreativeRepairCapacityConfirmation,parseCreativeRepairReconcile,parseCreativeRepairStart} from './socialWeeklyCreativeRepairExecution.js';

const h='a'.repeat(64);
test('creative execution route inputs preserve only explicit frozen authority',()=>{
 const confirmation={packageVersion:4,expectedCaseRecordHash:h,expectedConfigurationHash:h,expectedPreviewHash:h,expectedAuthorityHash:h,expectedQuoteHash:h,authorizedMaximumCostCny:8};
 assert.deepEqual(parseCreativeRepairCapacityConfirmation(confirmation),confirmation);
 assert.deepEqual(parseCreativeRepairStart({packageVersion:4,expectedCaseRecordHash:h}),{packageVersion:4,expectedCaseRecordHash:h});
 assert.deepEqual(parseCreativeRepairReconcile({packageVersion:4}),{packageVersion:4});
 for(const invalid of [{...confirmation,actorUserId:'foreign'},{...confirmation,caseId:'foreign'},{...confirmation,expectedAuthorityHash:'bad'},{...confirmation,authorizedMaximumCostCny:Infinity},{...confirmation,packageVersion:0}])assert.throws(()=>parseCreativeRepairCapacityConfirmation(invalid),{code:'weekly_creative_repair_capacity_input_invalid'});
 for(const invalid of [{packageVersion:4,expectedCaseRecordHash:h,jobId:'forged'},{packageVersion:4,expectedCaseRecordHash:'bad'}])assert.throws(()=>parseCreativeRepairStart(invalid),{code:'weekly_creative_repair_start_input_invalid'});
 for(const invalid of [{packageVersion:4,state:'resolved'},null])assert.throws(()=>parseCreativeRepairReconcile(invalid),{code:'weekly_creative_repair_reconcile_input_invalid'});
});

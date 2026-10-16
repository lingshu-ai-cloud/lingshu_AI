import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeCustomerTaskDependencies} from './customerTaskDependencies.js';
test('partial historical non-customer records do not crash supplement recovery; unknown customer evidence cannot clear dependencies',()=>{
 const other:any={schedule:{stepKind:'material_readiness'},dependsOnTaskIds:['real-upstream']};
 assert.equal(normalizeCustomerTaskDependencies(other),other);
 const customer:any={schedule:{stepKind:'customer_channel_readiness'},dependsOnTaskIds:['unknown-upstream']};
 assert.equal(normalizeCustomerTaskDependencies(customer),customer);
 assert.deepEqual(customer.dependsOnTaskIds,['unknown-upstream']);
});

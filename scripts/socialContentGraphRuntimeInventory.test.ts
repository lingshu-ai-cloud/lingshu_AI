import test from 'node:test';import assert from 'node:assert/strict';import {graphRuntimeInventoryVisible} from '../server/starter198/socialContentGraphRuntimeInventory.js';
test('canonical runtime inventory excludes only matching same-tenant new supply and preserves admitted or unrelated materials',()=>{
 const input={tenantId:'tenant',taskId:'task',admittedRefs:new Set(['original']),canonical:[{providerTaskId:'actual-provider',sha256:'actual-bytes-sha'}]},material={id:'new',tenantId:'tenant',sourceExecutionId:'actual-provider',contentSha256:'actual-bytes-sha'};
 assert.equal(graphRuntimeInventoryVisible(material,input),false);
 assert.equal(graphRuntimeInventoryVisible({...material,id:'original'},input),true);
 assert.equal(graphRuntimeInventoryVisible({...material,contentSha256:'changed-bytes'},input),true);
 assert.equal(graphRuntimeInventoryVisible({...material,tenantId:'other-tenant'},input),true);
 assert.equal(graphRuntimeInventoryVisible({...material,sourceExecutionId:'other-provider'},input),true);
 assert.equal(graphRuntimeInventoryVisible({...material,lineage:{sourceTaskId:'other-task'}},input),true);
 assert.equal(graphRuntimeInventoryVisible({...material,sourceExecutionId:'other',lineage:{sourceTaskId:'task'}},input),false);
});

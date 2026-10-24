import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {parentPort} from 'node:worker_threads';
test('launcher descendant has guard before its first channel request',async()=>{
 assert.equal(Reflect.get(globalThis,Symbol.for('lingshu.customerIsolationGuard')),true);
 assert.throws(()=>https.request('https://customer-channel.invalid/messages'),/isolated_test_network_blocked/);
 await assert.rejects(fetch('https://customer-channel.invalid/messages',{method:'POST'}),/isolated_test_network_blocked/);
 assert.deepEqual(Reflect.get(globalThis,Symbol.for('lingshu.customerIsolationCanary'))(),[]);
 if(process.send)process.send({guard:true,canaryHits:0});
 if(parentPort)parentPort.postMessage({guard:true,canaryHits:0});
});

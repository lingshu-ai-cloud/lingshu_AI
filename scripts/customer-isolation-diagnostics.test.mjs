import test from 'node:test';
import assert from 'node:assert/strict';
import {customerIsolationDiagnostic as classify} from './customer-isolation-diagnostics.mjs';
import {customerIsolationStatus} from './customer-isolated-test-guard.mjs';
test('blocked diagnostics classify fixed purposes without retaining private input',()=>{
 const privateTarget='https://private-user:private-token@graph.facebook.com/customer-private-id?access_token=private-secret';
 assert.deepEqual(classify(privateTarget,'at classify (server/agents/contextTags.ts:1:1)'),{targetClass:'customer_channel',purpose:'customer_tag_analysis'});
 assert.deepEqual(classify({hostname:'127.0.0.1',port:1},'at request (server/storage/pbStore.ts:1:1)'),{targetClass:'unowned_loopback',purpose:'data_store'});
 assert.equal(classify('https://api.openai.com/private-path','at f (server/customerService/translation.ts:1:1)').purpose,'translation');
 assert.equal(classify('https://customer-channel.invalid/private-id').targetClass,'reserved_test_target');
 assert.equal(classify('https://graph.facebook.com.attacker.invalid').targetClass,'reserved_test_target');
 assert.deepEqual(classify('/private-file-path','private-secret'),{targetClass:'unknown',purpose:'unattributed'});
 assert.doesNotMatch(JSON.stringify(classify(privateTarget,'private-secret')),/private|facebook|https|access_token/);
});
test('guard retains sanitized classification while network remains denied',async()=>{
 const target='https://private-user:private-token@customer-channel.invalid/private-id?token=private-secret';
 await assert.rejects(fetch(target),{code:'ISOLATED_NETWORK_BLOCKED'});
 const event=customerIsolationStatus().blocked.at(-1);
 assert.equal(event.targetClass,'reserved_test_target');
 assert.equal(event.decision,'blocked');assert.equal(event.transport,'fetch');
 assert.deepEqual(Object.keys(event).sort(),['at','decision','purpose','targetClass','transport']);
 assert.doesNotMatch(JSON.stringify(event),/private|https|token|\.invalid/);
 assert.equal(customerIsolationStatus().installed,true);
});

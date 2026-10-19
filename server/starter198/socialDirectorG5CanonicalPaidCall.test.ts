import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {buildDirectorG5QwenRequest} from '../agents/qwen.js';
import {measureQwenRequestInputUpperBound} from './socialContentPaidRuntimePorts.js';
import {assertDirectorG5FrozenCapacityEnvelope,assertDirectorG5VerifiedCostEnvelope} from './socialDirectorG5CanonicalPaidCall.js';
import type {SocialDirectorG5Context} from '../../shared/contracts/socialDirectorG5Review.js';
import type {SocialPaidOperationIntent,SocialVerifiedAccountTariff} from '../lib/socialContentTaskBudgetAuthority.js';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
test('G5 quotes the same frozen multimodal body used by provider execution',async()=>{
 const jpeg=Buffer.from([0xff,0xd8,0xff,0xd9]);
 const context={requirements:{script:[{sceneId:'scene-1'}]},agent:{authorization:{maximumCostCny:1}}} as unknown as SocialDirectorG5Context;
 const frames=[{sceneId:'scene-1',timeSeconds:0.5,sha256:hash(jpeg.toString('binary')),base64:jpeg.toString('base64'),mimeType:'image/jpeg' as const}];
 const body=buildDirectorG5QwenRequest({context,frames});
 const upper=await measureQwenRequestInputUpperBound(body);
 assert.equal(body.max_tokens,2400);
 assert.equal(upper,260096);
 assert.equal((body.messages[1]!.content as unknown[]).length,3);
 const intent:SocialPaidOperationIntent={operationId:'director-g5-0001',provider:'qwen',model:body.model,accountRef:'qwen:account',stage:'director_review',shotId:null,inputContractHash:hash(JSON.stringify(body)),maximumUnits:{inputTokens:upper,outputTokens:body.max_tokens}};
 const tariff:SocialVerifiedAccountTariff={provider:'qwen',model:body.model,accountRef:intent.accountRef,stage:'director_review',currency:'CNY',verifiedAccountPrice:true,evidenceRef:'test-verified-price',checkedAt:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+60000).toISOString(),meters:{inputTokens:{priceCny:3,unitsPerPrice:1000000,minimumUnits:0,increment:1},outputTokens:{priceCny:30,unitsPerPrice:1000000,minimumUnits:0,increment:1}}};
 const descriptor={configured:true,model:body.model,reservedCostCny:1,inputPricePerMillion:3,outputPricePerMillion:30};
 assert.ok(assertDirectorG5VerifiedCostEnvelope({intent,descriptor,context,tariff}).upperBoundCny<1);
 assert.throws(()=>assertDirectorG5VerifiedCostEnvelope({intent,descriptor:{...descriptor,inputPricePerMillion:2},context,tariff}),/verified_cost_authority_required/);
 assert.throws(()=>assertDirectorG5VerifiedCostEnvelope({intent,descriptor:{...descriptor,reservedCostCny:.2},context,tariff}),/verified_cost_authority_required/);
 assert.throws(()=>assertDirectorG5VerifiedCostEnvelope({intent,descriptor,context,tariff:{...tariff,validUntil:new Date(Date.now()-1000).toISOString()}}),/account_tariff_missing_or_expired/);
});
test('old 262144-token G5 hold cannot authorize a new Plus paid call',()=>{
 const exact={model:'qwen3-vl-plus',maximumUnits:{inputTokens:260096,outputTokens:2400}};
 assert.doesNotThrow(()=>assertDirectorG5FrozenCapacityEnvelope(exact,'qwen3-vl-plus',2400));
 assert.throws(()=>assertDirectorG5FrozenCapacityEnvelope({...exact,maximumUnits:{...exact.maximumUnits,inputTokens:262144}},'qwen3-vl-plus',2400),/original_capacity_envelope_changed/);
 assert.throws(()=>assertDirectorG5FrozenCapacityEnvelope({...exact,maximumUnits:{...exact.maximumUnits,outputTokens:4096}},'qwen3-vl-plus',2400),/original_capacity_envelope_changed/);
});

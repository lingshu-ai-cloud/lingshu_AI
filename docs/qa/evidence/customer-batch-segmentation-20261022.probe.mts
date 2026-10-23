// Baseline defect/limitation reproduction, not desired long-term behavior.
// Fake customers and in-memory authorization; no real provider sends or business writes.
import assert from 'node:assert/strict';
import {eligibleFollowupCustomerIds,normalizeCustomerSegmentCriteria,DEFAULT_FOLLOWUP_SEGMENT_CRITERIA} from '../../../server/digitalEmployees/customerWorkflow.ts';
import {controlledMessengerAccount} from '../../../server/messenger/controlledCapability.fixture.ts';
import {messengerCustomerAccountIdentityHash,readAuthorizedMessengerCustomers} from '../../../server/messenger/authorizedCustomerRead.ts';
const now=Date.now();
const rows=[
 {id:'won-old',stage:'won',intentScore:90,lastActiveAt:now-90*86400000,tags:['补货采购'],handlingMode:'ai_draft'},
 {id:'inquiry-low',stage:'inquiry',intentScore:10,lastActiveAt:now,tags:['询价中'],handlingMode:'ai_draft'},
 {id:'qualified',stage:'quoted',intentScore:90,lastActiveAt:now,tags:['询价中','预算已提供'],handlingMode:'ai_draft'},
];
assert.deepEqual(eligibleFollowupCustomerIds(rows,DEFAULT_FOLLOWUP_SEGMENT_CRITERIA,now),['inquiry-low','qualified']);
console.log('BATCH 1: default criteria excludes won-old and includes inquiry-low despite minIntentScore=60, because match=any');
assert.deepEqual(eligibleFollowupCustomerIds(rows,{tags:['询价中','预算已提供']},now),['inquiry-low','qualified']);
console.log('BATCH 2: tags array uses OR; it cannot require every requested tag');
const unsupported={inactiveDaysMin:30,country:'US',waitingFor:'seller_reply'};
assert.equal('inactiveDaysMin' in normalizeCustomerSegmentCriteria(unsupported),false);
assert.equal(eligibleFollowupCustomerIds(rows,unsupported,now).length,3);
console.log('BATCH 3: unsupported business dimensions are silently dropped; unknown-only criteria matches all fixture customers');
const account:any=controlledMessengerAccount({tenantId:'tenant',accountId:'account',pageId:'page'});
const accountHash=messengerCustomerAccountIdentityHash(account);
const customer:any={id:'buyer',tenantId:'tenant',pageId:'page',messengerUserId:'psid',lastActiveAt:now-1000,tags:['询价中'],contextTagEvidence:[{tag:'询价中',messageId:'mid.in',excerpt:'Please quote'}],intentScore:85,stage:'inquiry',bant:{level:'hot'},timeline:[{id:'mid.in',type:'messenger',actor:'buyer',title:'',body:'Please quote',time:'',timestamp:now-1000,audit:{providerMessageId:'mid.in',providerRecipientId:'psid',inboundSource:'verified_meta_webhook',accountId:'account',pageId:'page',accountHash}}]};
const config={id:'config',tenant_id:'tenant',status:'active',config_version:1,config:{enabledWorkflows:['batch_followup'],allowRealCustomerMessages:true}};
const ds:any={getById:async()=>account,list:async(c:string)=>{const items=c==='social_accounts'?[account]:c==='digital_employee_configs'?[config]:[];return{items,totalItems:items.length};}};
const projected=await readAuthorizedMessengerCustomers('tenant',ds,{customers:()=>[customer]});assert.equal(projected.length,1);
for(const key of ['tags','contextTagEvidence','intentScore','stage','bant'])assert.equal(projected[0]![key],undefined);
assert.deepEqual(eligibleFollowupCustomerIds(projected,{tags:['询价中']},now),[]);
console.log('BATCH 4: authorized Messenger projection intentionally drops unbound tags/profile; a subsequent tag filter cannot use them');

import assert from 'node:assert/strict';
import { markWhatsAppHumanReply, dedupeWhatsAppInteractionRecords, whatsappInteractionProviderId } from './historyImport.js';
const records: any[] = [];
const customer: any = {id:'customer',tenantId:'tenant',waNumber:'15551234567'};
let throwOnce = true;
let now = 1000;
const input = {tenantId:'tenant',customerId:'customer',body:'first\nsecond',messages:['first','second'],providerReceipts:[{messageId:'wamid.1'},{messageId:'wamid.2'}]};
const dependencies = {
  customers:()=>[customer], now:()=>++now,
  addInteraction:(item:any)=>{
    if (item.body==='second' && throwOnce) {throwOnce=false;throw new Error('disk failure after first saved');}
    if (records.some(r=>r.tenantId===item.tenantId && (r.id===item.id || whatsappInteractionProviderId(r)===whatsappInteractionProviderId(item)))) return false;
    records.push(item);return true;
  },
  upsertCustomer:()=>customer,
};
assert.throws(()=>markWhatsAppHumanReply(input,dependencies),/disk failure/);
assert.equal(records.length,1);
markWhatsAppHumanReply(input,dependencies);
assert.equal(records.length,2,'partial local write recovery does not duplicate the first accepted message');
markWhatsAppHumanReply(input,dependencies);
assert.equal(records.length,2,'repeated recovery is idempotent even at a new time');
assert.equal(records[0].metaMessageId,'wamid.1');
const legacy = {...records[0],id:'old-time-id',metaMessageId:undefined,meta:{providerMessageId:'wamid.1'}};
assert.equal(dedupeWhatsAppInteractionRecords([legacy,records[0]]).length,1,'old records are deduplicated using recorded real provider IDs');
assert.equal(dedupeWhatsAppInteractionRecords([records[0],{...records[0],tenantId:'other'}]).length,2,'provider ID deduplication stays tenant-scoped');
assert.throws(()=>markWhatsAppHumanReply({...input,customerId:'missing'},dependencies),/customer_missing/);
console.log('WhatsApp history partial-write recovery, stable provider IDs and tenant isolation passed');

markWhatsAppHumanReply(input,{...dependencies,preserveCustomerState:true,upsertCustomer:()=>{throw new Error('recovery must preserve current customer handling decisions');}});

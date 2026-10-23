import type { Record_ } from '../storage/datastore.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
const object=(v:unknown):Record<string,unknown>=>{if(typeof v==='string'){try{return object(JSON.parse(v));}catch{return {};}}return v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};};
/** Progress is projected from owned business records, never from an inferred conversation label. */
export function applyCustomerBusinessProgress(customer:Record<string,unknown>,tenantId:string,runId:string,quotes:Record_[],exceptions:Record_[]):Record<string,unknown>&{businessFacts:Record<string,unknown>}{
 const facts={...object(customer.businessFacts)};
 const latestQuotes=quotes.filter(q=>q.tenant_id===tenantId&&q.customer_id===customer.id).sort((a,b)=>Date.parse(String(b.updated_at))-Date.parse(String(a.updated_at)));
 const quote=latestQuotes[0],draft=object(quote?.payload),delivery=object(draft.delivery);
 if(quote&&draft.customerId===customer.id&&quote.status===draft.status){
  if(['needs_clarification','ready_for_review'].includes(String(draft.status))){facts.waitingFor='quote_review';facts.progressEvidence={type:'quote_skill_draft',id:quote.id,revision:draft.revision};}
  if(draft.status==='confirmed'&&draft.confirmedBy&&delivery.status==='sent'&&typeof delivery.providerMessageId==='string'&&!/^(mock|simulat)/i.test(delivery.providerMessageId)&&Number.isFinite(Date.parse(String(delivery.sentAt)))){
   if(customer.stage!=='won')customer.stage='quoted';facts.lastSellerAt=Date.parse(String(delivery.sentAt));facts.waitingFor=Number(facts.lastBuyerAt)>Number(facts.lastSellerAt)?'seller':'customer';facts.progressEvidence={type:'sent_confirmed_quote',id:quote.id,providerMessageId:delivery.providerMessageId};
  }
  const product=object(draft.matchedProduct);if(typeof product.id==='string')facts.productIds=[product.id];
 }
 const latest=new Map<string,Record<string,unknown>>();
 for(const row of exceptions){const p=object(row.payload),scope=object(p.scope),{recordHash,...body}=p;
  if(row.tenant_id!==tenantId||row.run_id!==runId||scope.tenantId!==tenantId||scope.runId!==runId||p.customerId!==customer.id||p.requestId!==row.request_id||row.content_hash!==recordHash||socialRequestHash(body)!==recordHash)continue;
  const previous=latest.get(String(p.requestId));if(!previous||Number(p.version)>Number(previous.version))latest.set(String(p.requestId),p);
 }
 for(const p of latest.values())if(['requested','pending_verification','verified','applying'].includes(String(p.status))&&['quote','knowledge'].includes(String(p.kind))){facts.waitingFor=p.kind==='quote'?'quote_review':'knowledge_review';facts.progressEvidence={type:'weekly_customer_exception',id:p.requestId,version:p.version,status:p.status};}
 return {...customer,businessFacts:facts};
}

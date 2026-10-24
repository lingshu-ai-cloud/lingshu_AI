import { createHash } from 'node:crypto';
import { assessBant, selectProgressionGoal } from '../sales/qualification.js';
import { vetoRevokedContextTags, type ContextTagEvidence } from '../messenger/contextTags.js';

type Row = Record<string, unknown>;
export function buyerConversationFingerprint(turns: Row[]): string {
  return createHash('sha256').update(JSON.stringify(turns.filter(t => t.actor === 'buyer').slice(-40).map(t => [t.id, t.body]))).digest('hex');
}
/** Derive only from currently admitted messages. Never restore arbitrary cached CRM or account fields. */
export function projectCustomerBusinessProfile(customer: Row, metadata: Row = {}): Row {
  const turns = (Array.isArray(customer.timeline) ? customer.timeline : []) as Array<{id:string;actor:string;body:string;timestamp?:number}>;
  const fingerprint = buyerConversationFingerprint(turns);
  const current = metadata.contextTagsBuyerFingerprint === fingerprint && metadata.contextTagsAnalysisVersion === 5;
  const evidence = (current && Array.isArray(metadata.contextTagEvidence) ? metadata.contextTagEvidence : []) as ContextTagEvidence[];
  const proved = evidence.filter(e => turns.some(t => t.actor === 'buyer' && t.id === e.messageId && typeof e.excerpt === 'string' && t.body.includes(e.excerpt)));
  const effective = vetoRevokedContextTags(proved, turns);
  const bant = assessBant({ turns: turns.map(t => ({ role: t.actor === 'buyer' ? 'buyer' : 'seller', text: t.body })) });
  const restrictiveTags=[customer,metadata].flatMap(row=>[...(Array.isArray(row.tags)?row.tags.map(String):[]),String(row.blockedAutoReplyReason||'')]);
  const optedOut=customer.optedOut===true||metadata.optedOut===true||restrictiveTags.some(t=>/do not contact|unsubscribe|opt.?out|blacklist|不要联系|退订|拒收|黑名单|勿扰/i.test(t))||turns.some(t=>t.actor==='buyer'&&/^(?:stop[.!\s]*$|unsubscribe\b|do not contact\b|don't contact\b|please (?:stop|remove me)\b|不要(?:再)?联系|别再联系|退订)/i.test(t.body.trim()));
  const lastBuyerAt = Math.max(0, ...turns.filter(t => t.actor === 'buyer').map(t => Number(t.timestamp || 0)));
  const lastSellerAt = Math.max(0, ...turns.filter(t => t.actor === 'seller' || t.actor === 'ai').map(t => Number(t.timestamp || 0)));
  return { ...customer, optedOut, bant, intentScore: bant.total, stage: 'inquiry', handlingMode: [customer.handlingMode,metadata.handlingMode].includes('human_needed')?'human_needed':'ai_draft',
    tags: effective.map(e => e.tag), contextTagEvidence: effective,
    classificationStatus: current ? 'current' : 'pending', classificationFingerprint: fingerprint,
    contextTagsBuyerFingerprint: fingerprint, contextTagsAnalysisVersion: current ? 5 : 0,
    progressionGoal: selectProgressionGoal(bant, String(customer.language || 'English')),
    businessFacts: { lastBuyerAt: lastBuyerAt || null, lastSellerAt: lastSellerAt || null,
      waitingFor: customer.sellerHistoryComplete === true ? lastBuyerAt > lastSellerAt ? 'seller' : 'customer' : 'unknown',
      contactPermission:optedOut?'opted_out':'unknown', relationship: 'unknown', purchase: 'unknown', sourceFingerprint: fingerprint },
  };
}

export function customerClassificationId(tenantId:string,customer:Row):string {
  return createHash('sha256').update(JSON.stringify([tenantId,customer.accountId,customer.id])).digest('hex').slice(0,15);
}
export async function readCustomerBusinessProfile(store:import('../storage/datastore.js').DataStore,tenantId:string,customer:Row,metadata:Row=customer):Promise<Row> {
  const saved=await store.getById<import('../storage/datastore.js').Record_>('customer_classifications',customerClassificationId(tenantId,customer));
  const payload=saved?.tenant_id===tenantId&&saved.customer_id===customer.id?saved.payload as Row|null:null;
  const cache=payload&&payload.accountHash===customer.accountHash?{...metadata,...payload}:metadata;
  const result=projectCustomerBusinessProfile(customer,cache);
  if(payload&&payload.accountHash===customer.accountHash&&typeof payload.reviewedBy==='string'&&payload.reviewedBy){
    const p=payload.reviewedProfile as Row|undefined;
    if(p){for(const key of ['language','timeZone','countryName'])if(typeof p[key]==='string')result[key]=p[key];
      result.profileReview={reviewedBy:payload.reviewedBy,reviewedAt:payload.reviewedAt,accountHash:payload.accountHash};}
  }
  return result;
}

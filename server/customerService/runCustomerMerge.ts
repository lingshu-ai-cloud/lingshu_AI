import { buyerConversationFingerprint } from './businessProfile.js';
/** A selected native conversation replaces, rather than duplicates, its live customer.
 * Derived fields may only survive when the current account proof is identical. */
export function mergeRunCustomerSources(base:Record<string,unknown>[],selected:Record<string,unknown>[]) {
  const rows=new Map(base.map(c=>[String(c.id),c]));
  for(const c of selected){const prior=rows.get(String(c.id));const receipt=c.weeklyChannelSelection as Record<string,unknown>|undefined;
    const derived=prior&&prior.accountHash&&prior.accountHash===receipt?.accountHash&&buyerConversationFingerprint((prior.timeline||[]) as Record<string,unknown>[])===buyerConversationFingerprint((c.timeline||[]) as Record<string,unknown>[])?prior:{};
    rows.set(String(c.id),{...c,...derived,id:c.id,tenantId:c.tenantId,timeline:c.timeline,weeklyChannelSelection:receipt,accountId:receipt?.accountId??c.accountId,accountHash:receipt?.accountHash??c.accountHash,source:receipt?.channel??c.source});
  }
  return [...rows.values()];
}

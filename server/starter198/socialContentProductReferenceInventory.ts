import type { MaterialRecord } from '../lib/materialLibrary.js';
import { isSyntheticMaterial } from '../lib/materialTruthfulness.js';

/** Product-reference inputs need canonical product association, not video action analysis. */
export function ownedProductReferenceImageIds(input: {
  records: MaterialRecord[]; tenantId: string; productId: string | null; productRef: string | null;
}): string[] {
  const normalized = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase();
  return input.records.filter(record => {
    if (record.type !== 'image' || record.scope === 'shared'
      || String(record.tenantId || record.tenant_id || '') !== input.tenantId || isSyntheticMaterial(record)) return false;
    if (/ai.generated|seedream|synthetic|generated/i.test(String(record.sourceType || record.source_type || record.origin || ''))) return false;
    if (!record.id || !/^[a-f0-9]{64}$/i.test(String(record.contentSha256 || record.contentHash || ''))) return false;
    const identityMatches = Boolean(input.productId && String(record.productId || '') === input.productId)
      || Boolean(input.productRef && [record.productRef, ...(Array.isArray(record.productRefs) ? record.productRefs : [])]
        .some(ref => normalized(ref) === normalized(input.productRef)));
    return identityMatches;
  }).map(record => record.id);
}

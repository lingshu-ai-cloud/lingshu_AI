import { readTenantEnterpriseProfileStrict } from '../routes/enterpriseProfileStore.js';
import type { SocialInsightMerchantContext } from '../../shared/socialInsightReport.js';
export const emptyInsightMerchantContext = (): SocialInsightMerchantContext => ({businessModel:'b2b',industry:null,productCategories:[]});
/** Deliberate projection: never send client records, knowledge, contacts, prices or credentials. */
export async function readInsightMerchantContext(tenantId: string, read = readTenantEnterpriseProfileStrict): Promise<SocialInsightMerchantContext> {
  try {
    const profile=await read(tenantId);
    if (!profile || profile.dataGovernance?.aiAccessEnabled === false) return emptyInsightMerchantContext();
    const industry = typeof profile.company?.industry === 'string' ? profile.company.industry.trim().slice(0, 100) : '';
    const categories = typeof profile.products?.categories === 'string' ? profile.products.categories : '';
    return {businessModel:'b2b',industry:industry || null,productCategories:categories.split(/[,，、;；\n]/).map(v=>v.trim().slice(0,80)).filter(Boolean).slice(0,8)};
  } catch { return emptyInsightMerchantContext(); }
}

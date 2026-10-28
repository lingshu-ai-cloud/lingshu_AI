import { createHash } from 'node:crypto';
import { materialAssetV2FromRecord } from '../../shared/contracts/materialAssetV2.js';
import { isVerifiedTransparentProductCutout } from '../lib/productIdentityPreparation.js';
import { readMaterialLibrary, type MaterialRecord } from '../lib/materialLibrary.js';
import { readTenantMaterialBytes } from '../lib/sentenceReplicationProduction.js';

export interface SocialImageProductCutout {
  bytes: Buffer;
  materialId: string;
  contentSha256: string;
}

/** Resolve an exact, tenant-owned transparent product asset; never fall back to the catalog photo. */
export async function resolveSocialImageProductCutout(input: {
  tenantId: string; productId: string; materials?: MaterialRecord[];
  readBytes?: typeof readTenantMaterialBytes;
}): Promise<SocialImageProductCutout> {
  const items = input.materials || (await readMaterialLibrary(input.tenantId)).items;
  const candidates = items.filter(item => item.type === 'image' && item.scope === 'own'
    && String(item.tenantId || item.tenant_id || '') === input.tenantId
    && String(item.productId || item.product_id || '') === input.productId
    && !item.libraryRemovedAt && materialAssetV2FromRecord(item)?.contentRole === 'transparent_cutout'
    && materialAssetV2FromRecord(item)?.assetRole === 'exact_product'
    && materialAssetV2FromRecord(item)?.productIdentityLevel === 'exact');
  const verified: SocialImageProductCutout[] = [];
  for (const item of candidates) {
    const loaded = await (input.readBytes || readTenantMaterialBytes)(item, input.tenantId).catch(() => null);
    if (!loaded || !await isVerifiedTransparentProductCutout(loaded.bytes)) continue;
    const digest = createHash('sha256').update(loaded.bytes).digest('hex');
    if (String(item.contentSha256 || '').toLowerCase() !== digest) continue;
    verified.push({ bytes: loaded.bytes, materialId: item.id, contentSha256: digest });
  }
  if (verified.length !== 1) throw new Error(verified.length ? 'social_image_product_cutout_ambiguous'
    : 'social_image_product_cutout_required');
  return verified[0]!;
}

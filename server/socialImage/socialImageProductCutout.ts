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
  if (!candidates.length) throw new Error('social_image_product_cutout_required');
  const verified: SocialImageProductCutout[] = [];
  let unreadable = false;
  let invalid = false;
  for (const item of candidates) {
    const loaded = await (input.readBytes || readTenantMaterialBytes)(item, input.tenantId).catch(() => null);
    if (!loaded) { unreadable = true; continue; }
    if (!await isVerifiedTransparentProductCutout(loaded.bytes)) { invalid = true; continue; }
    const digest = createHash('sha256').update(loaded.bytes).digest('hex');
    if (String(item.contentSha256 || '').toLowerCase() !== digest) { invalid = true; continue; }
    verified.push({ bytes: loaded.bytes, materialId: item.id, contentSha256: digest });
  }
  if (verified.length > 1) throw new Error('social_image_product_cutout_ambiguous');
  if (!verified.length) throw new Error(unreadable ? 'social_image_product_cutout_unreadable'
    : invalid ? 'social_image_product_cutout_invalid' : 'social_image_product_cutout_required');
  return verified[0]!;
}

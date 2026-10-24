import { getOwnedCloudMaterialRecord } from '../lib/cloudMaterials.js';
import { isReferenceOnlyMaterial, type MaterialPolicyInput } from '../lib/materialPolicy.js';

type ShootingMaterial = MaterialPolicyInput & { id: string; tenantId?: string; type?: string };

/** Upload responses expose pb- IDs; resolve those against the same tenant store. */
export async function ownsShootingVideo(
  id: string,
  tenantId: string,
  loadLegacy: () => ShootingMaterial[],
  getOwned = getOwnedCloudMaterialRecord,
): Promise<boolean> {
  if (id.startsWith('pb-')) {
    const record = await getOwned(id.slice(3), tenantId);
    return Boolean(record && record.type === 'video' && !isReferenceOnlyMaterial(record));
  }
  return loadLegacy().some(item => item.id === id && item.tenantId === tenantId
    && item.scope !== 'shared' && item.type === 'video' && !isReferenceOnlyMaterial(item));
}

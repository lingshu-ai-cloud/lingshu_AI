import type {SocialAssetSupplyPlan} from '../../shared/contracts/socialContentReplication.js';
import {socialRequestHash} from './socialContentValidation.js';

/** Scan timestamps and lifecycle projection versions are not production
 * decisions. Slot order, routes, source versions/windows and rights evidence
 * remain in the identity and are revalidated before recovery. */
export function initialMaterialPlanHash(plan:SocialAssetSupplyPlan){
 const {inventoryAudit:_scan,planVersion:_projection,...business}=plan;
 return socialRequestHash(business);
}

import type { SocialEnterpriseProductBinding } from './socialContentTaskEvidenceProjection.js';
import type { SocialReplicationScriptVersion } from '../../shared/contracts/socialContentWorkflow.js';

/** Apply the explicitly selected, server-verified SKU to a new script, before route planning.
 * This binds identity only: it never approves rights, facts, materials or execution. */
export function bindReplicationProduct(script: SocialReplicationScriptVersion, binding: SocialEnterpriseProductBinding | null | undefined): SocialReplicationScriptVersion {
  if (!binding || script.status === 'confirmed' || script.status === 'superseded') return script;
  const result = structuredClone(script);
  for (const shot of result.shots) {
    const plan = shot.materialPlan, visual = plan.visualContract;
    if (!visual || (!visual.subjects.some(subject => subject.kind === 'product') && !plan.productSceneReplication)) continue;
    if (visual.product.policy === 'locked' && visual.product.requestedProductId && visual.product.requestedProductId !== binding.productId) {
      throw new Error('social_replication_product_binding_conflict');
    }
    visual.product = { policy: 'locked', requestedProductId: binding.productId, requestedProductRef: binding.productName, source: 'user_explicit' };
    visual.productUsage = { ...visual.productUsage, productId: binding.productId, productRef: binding.productName };
    plan.truthBoundary.confirmedFactRefs = [...new Set([...plan.truthBoundary.confirmedFactRefs, binding.enterpriseFactRef])];
  }
  return result;
}

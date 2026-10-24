import type { EnterpriseProfile } from '../routes/enterprise.js';
import { verifiedSocialScriptContext } from '../starter198/socialContentScriptBaseline.js';
/** One video can introduce several KB products; never silently collapse it to the first SKU. */
export function guidedEnterpriseContext(profile: EnterpriseProfile, productIds: string[]) {
  const contexts = productIds.map(id => verifiedSocialScriptContext(profile, id));
  const first = contexts[0] || verifiedSocialScriptContext(profile, null);
  return { ...first, productName: contexts.map(context => context.productName).filter(Boolean).join('、') || first.productName,
    facts: contexts.flatMap((context, index) => context.facts.map(fact => ({ ...fact, key: `${productIds[index]}.${fact.key}` }))) };
}

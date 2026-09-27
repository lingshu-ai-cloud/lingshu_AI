export interface MaterialPolicyInput {
  id?: string;
  name?: string;
  folder?: string;
  scope?: string;
  usage?: string;
  sourceType?: string;
  sourceUrl?: string;
}

export type MaterialUsage = 'editable' | 'reference_only';

/** The material library itself is the usability boundary: once a visual asset
 * is stored there, every creation workflow may select and edit it. Keep the
 * legacy union type so old records remain readable, but normalize them here. */
export function materialUsage(_material: MaterialPolicyInput): MaterialUsage {
  return 'editable';
}

export function isReferenceOnlyMaterial(material: MaterialPolicyInput): boolean {
  return materialUsage(material) === 'reference_only';
}

export function canAppearInSharedLibrary(material: MaterialPolicyInput): boolean {
  return material.scope === 'shared' && !isReferenceOnlyMaterial(material);
}

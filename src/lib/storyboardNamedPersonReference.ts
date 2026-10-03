export interface NamedPersonCandidate {
  name: string;
  authorized: boolean;
  referenceMaterialIds?: string[];
  rightsEvidence?: {
    authorizationRef?: string; consentRef?: string; grantedAt?: string; expiresAt?: string; revokedAt?: string;
    subjectAdultConfirmed?: boolean;
    providerScopes?: Array<{ provider: string; uses: string[] }>;
  };
}
const genericRole = /^(?:销售|员工|工人|模特|人物|主播|工程师|操作员|经理|客服|主持人)$/;

export function storyboardNamedPersonConsentReady(candidate: NamedPersonCandidate, now = Date.now()): boolean {
  const evidence = candidate.rightsEvidence;
  const grantedAt = Date.parse(evidence?.grantedAt || '');
  const expiresAt = evidence?.expiresAt ? Date.parse(evidence.expiresAt) : Infinity;
  const dashscope = evidence?.providerScopes?.find(item => item.provider === 'dashscope');
  return candidate.authorized && Boolean(evidence?.authorizationRef && evidence.consentRef && evidence.subjectAdultConfirmed)
    && Number.isFinite(grantedAt) && grantedAt <= now && expiresAt > now && !evidence?.revokedAt
    && Boolean(dashscope?.uses.includes('person_replacement') && dashscope.uses.includes('quality_inspection'));
}

export function storyboardNamedPersonRequired(shotDescription: string, presenters: NamedPersonCandidate[]): boolean {
  return /企业人物|指定人物|本企业员工|公司员工/.test(shotDescription)
    || presenters.some(item => item.name.trim().length >= 2 && !genericRole.test(item.name.trim())
      && shotDescription.includes(item.name.trim()));
}

/** Generic workers and hands do not imply a specific enterprise identity. */
export function matchStoryboardNamedPersonImage(
  shotDescription: string,
  presenters: NamedPersonCandidate[],
  imageMaterialIds: ReadonlySet<string>,
): string | undefined {
  const candidates = presenters.filter(item => storyboardNamedPersonConsentReady(item)).flatMap(item =>
    (item.referenceMaterialIds || []).filter(id => imageMaterialIds.has(id)).map(id => ({ id, name: item.name.trim() })));
  const named = candidates.filter(item => item.name.length >= 2 && !genericRole.test(item.name)
    && shotDescription.includes(item.name));
  if (named.length === 1) return named[0].id;
  if (named.length > 1) return undefined;
  return /企业人物|指定人物|本企业员工|公司员工/.test(shotDescription) && candidates.length === 1
    ? candidates[0].id : undefined;
}

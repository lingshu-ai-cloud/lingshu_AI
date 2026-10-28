import { replaceIdentityOnly, type ReferenceIdentityPlan } from './socialContentReferenceEvidence.js';
import type { VerifiedSocialScriptContext } from './socialContentScriptBaselineContract.js';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown): string[] => (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(item => item.length >= 2 && item.length <= 80);
const credentialPattern = /\b(?:GMP|ISO(?:[\s-]?\d{3,5})?|FDA(?:-ready|\s+(?:approved|registered|compliant))?|CE|RoHS|UKCA|ETL|BSCI|REACH)\b/gi;
const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
type IdentityKind = 'company' | 'brand' | 'product' | 'credential';

const entityArrays = ['identityEntities', 'namedEntities', 'entities', 'competitorEntities', 'referenceEntities', 'sourceEntities'] as const;
const evidenceObjects = ['identityEvidence', 'referenceIdentity', 'competitorIdentity', 'competitorProfile', 'sourceIdentity', 'detectedIdentity'] as const;
const entityValueKeys = ['text', 'value', 'name', 'label', 'entity', 'mention', 'canonicalName'] as const;
const directKeys: Record<IdentityKind, readonly string[]> = {
  company: ['companyName', 'enterpriseName', 'competitorCompany', 'sourceCompany', 'referenceCompany', 'companies', 'enterprises'],
  brand: ['brandName', 'competitorBrand', 'sourceBrand', 'referenceBrand', 'brands'],
  product: ['productName', 'productRef', 'competitorProduct', 'sourceProduct', 'referenceProduct', 'products', 'skus'],
  credential: ['certification', 'credential', 'qualification', 'competitorCertification', 'certifications', 'credentials', 'qualifications'],
};

function identityKind(value: unknown): IdentityKind | null {
  const type = String(value ?? '').toLocaleLowerCase().replace(/[\s_-]+/g, '');
  if (/certif|credential|qualification|accredit|compliance|资质|认证|证书/.test(type)) return 'credential';
  if (/company|enterprise|corporation|manufacturer|企业|公司|厂商/.test(type)) return 'company';
  if (/brand|品牌/.test(type)) return 'brand';
  if (/product|sku|model|产品|商品|型号/.test(type)) return 'product';
  return null;
}

/** Read only explicit identity evidence fields. We intentionally do not walk
 * arbitrary analysis prose: an ordinary subject or benefit phrase must never
 * become a replacement token merely because it appears in model output. */
function structuredIdentities(containers: Record<string, unknown>[]) {
  const found: Record<IdentityKind, string[]> = { company: [], brand: [], product: [], credential: [] };
  const visit = (container: Record<string, unknown>) => {
    for (const kind of Object.keys(directKeys) as IdentityKind[]) {
      for (const key of directKeys[kind]) found[kind].push(...strings(container[key]));
    }
    for (const key of entityArrays) {
      const rows = Array.isArray(container[key]) ? container[key] as unknown[] : [];
      for (const value of rows) {
        const row = record(value);
        const kind = identityKind(row.type ?? row.kind ?? row.entityType ?? row.category ?? row.role);
        if (!kind) continue;
        for (const valueKey of entityValueKeys) found[kind].push(...strings(row[valueKey]));
      }
    }
    for (const key of evidenceObjects) {
      const nested = record(container[key]);
      if (Object.keys(nested).length) visit(nested);
    }
  };
  containers.forEach(visit);
  for (const kind of Object.keys(found) as IdentityKind[]) found[kind] = [...new Set(found[kind])];
  return found;
}

const contains = (text: string, token: string) => text.toLocaleLowerCase().includes(token.toLocaleLowerCase());
const exclusiveCredentialClaim = (text: string) => /唯一|独家|专有|首家|第一|仅有|exclusive|exclusively|only|sole|first\s+(?:and\s+only|certified)/i.test(text);

/** Use only recognized reference entities and tenant facts; never synthesize a certification.
 * Sentence/slot ownership is deliberately untouched. Unstructured source labels remain
 * an upstream extraction limitation, not an assertion that no competitor names exist. */
export function voiceDrivenIdentityPolicy(input: {
  legacy: ReferenceIdentityPlan; analysis: Record<string, unknown>; referenceRecord: Record<string, unknown>;
  context: VerifiedSocialScriptContext;
}) {
  const gemini = record(input.analysis.gemini);
  const transcript = record(gemini.audioTranscript);
  const recognized = structuredIdentities([input.referenceRecord, input.analysis, gemini, transcript]);
  const plan: ReferenceIdentityPlan = {
    company: { originals: [...new Set([...input.legacy.company.originals, ...recognized.company])], replacement: input.legacy.company.replacement || input.context.enterpriseName || null },
    brand: { originals: [...new Set([...input.legacy.brand.originals, ...recognized.brand])], replacement: input.legacy.brand.replacement || input.context.brandName || null },
    product: { originals: [...new Set([...input.legacy.product.originals, ...recognized.product])], replacement: input.legacy.product.replacement || input.context.productName || null },
  };
  const confirmedValues = input.context.facts.filter(fact => fact.key === 'certifications').map(fact => fact.value.trim()).filter(Boolean);
  const confirmed = confirmedValues.map(normalize);
  const unreplaced = (['company', 'brand', 'product'] as const)
    .flatMap(kind => plan[kind].replacement ? [] : plan[kind].originals);
  return (text: string) => {
    const replaced = replaceIdentityOnly(text, plan);
    const detected = [...recognized.credential, ...Array.from(replaced.text.matchAll(credentialPattern), match => match[0])];
    const unsupported = [...new Set(detected.filter(value => contains(replaced.text, value)
      && !confirmed.some(fact => fact === normalize(value) || fact.includes(normalize(value)))))];
    if (!unsupported.length && !unreplaced.some(value => contains(replaced.text, value))) return replaced;
    const clauses = replaced.text.split(/(?<=[，,。.!！?？;；])/u);
    const safe = clauses.flatMap(clause => {
      if (unreplaced.some(token => contains(clause, token))) return [];
      const clauseCredentials = unsupported.filter(token => contains(clause, token));
      if (!clauseCredentials.length) return [clause];
      // Never transfer a competitor's exclusivity or ranking to the tenant.
      if (exclusiveCredentialClaim(clause) || !confirmedValues.length) return [];
      let next = clause;
      for (const token of clauseCredentials) next = next.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), confirmedValues[0]!);
      return [next];
    }).join('').trim();
    return { ...replaced, text: /[\p{L}\p{N}]/u.test(safe) ? safe : /[\p{Script=Han}]/u.test(text) ? '了解更多产品信息。' : 'Learn more about this product.' };
  };
}

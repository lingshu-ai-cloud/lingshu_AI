/** Product names mentioned in the source narration, in first-spoken order. */
const PRODUCT_TERMS = [
  'repairing mask', 'repairing masks', 'whitening cream', 'liquid foundation', 'anti-wrinkle essence', 'massage oil', 'massaging oil', 'foundation', 'concealer', 'lipstick', 'lip gloss', 'serum', 'face cream', 'cream', 'facial oil', 'oil', 'sunscreen',
  'cleanser', 'shampoo', 'conditioner', 'toner', 'lotion', 'mascara', 'eyeshadow',
  'primer', 'setting spray', 'face mask', 'powder foundation',
  '粉底液', '粉底', '遮瑕', '口红', '唇釉', '精华液', '精华', '面霜', '防晒霜', '防晒',
  '洁面乳', '洗发水', '护发素', '爽肤水', '乳液', '睫毛膏', '眼影', '妆前乳', '定妆喷雾', '面膜',
];

export type ReferenceProductSlot = { shotId: string; sourceLabel: string; time: string; visual: string };

function matchesTerm(text: string, term: string): boolean {
  if (/^[\x00-\x7f]+$/.test(term)) {
    return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\b`, 'i').test(text);
  }
  return text.includes(term);
}

export function referenceProductTerms(lines: Array<{ text: string; time?: string; visual?: string }>, explicitTerms?: string[]): ReferenceProductSlot[] {
  const terms = explicitTerms?.length ? explicitTerms : PRODUCT_TERMS;
  const candidates: Array<ReferenceProductSlot & { position: number }> = [];
  const seen = new Set<string>();
  lines.forEach((line, lineIndex) => {
    const text = String(line.text || '');
    for (const term of [...terms].sort((a, b) => b.length - a.length)) {
      const lower = term.toLocaleLowerCase();
      if (seen.has(lower) || !matchesTerm(text, term)) continue;
      if (terms.some(longer => longer.length > term.length && longer.includes(term)
        && matchesTerm(text, longer))) continue;
      seen.add(lower);
      candidates.push({ shotId: `spoken-product-${lower.replace(/\s+/g, '-')}`, sourceLabel: term,
        time: line.time || '', visual: line.visual || '', position: lineIndex * 10000 + text.toLocaleLowerCase().indexOf(lower) });
    }
  });
  return candidates.sort((a, b) => a.position - b.position).map(({ position: _position, ...slot }) => slot);
}

/** Count speech mentions separately from distinct replacement targets. A speech line
 * repeated under several visual shots is one audio interval, not extra products. */
export function referenceProductMentions(lines: Array<{ text: string; time?: string }>, terms?: string[]) {
  const labels = terms || referenceProductTerms(lines).map(slot => slot.sourceLabel);
  const seenLines = new Set<string>();
  return lines.flatMap(line => {
    const key = `${line.time || ''}:${line.text.trim()}`;
    if (seenLines.has(key)) return [];
    seenLines.add(key);
    const candidates = labels.flatMap(term => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
      const expression = new RegExp(/^[\x00-\x7f]+$/.test(term) ? `\\b${escaped}\\b` : escaped, 'gi');
      return [...line.text.matchAll(expression)].map(match => ({ sourceLabel: term, text: line.text,
        time: line.time || '', offset: match.index!, length: match[0].length }));
    }).sort((a, b) => a.offset - b.offset || b.length - a.length);
    return candidates.filter((item, index) => !candidates.slice(0, index).some(previous =>
      previous.offset <= item.offset && previous.offset + previous.length >= item.offset + item.length));
  });
}

export function referenceBrandTerm(lines: string[]): string {
  const speech = lines.join(' ');
  const afterBrand = /(?:品牌(?:叫|为|是|：|:)?\s*|\bbrand\s+(?:is|called)\s+)([\p{Script=Han}A-Z][\p{Script=Han}A-Za-z0-9-]{1,30})/iu.exec(speech)?.[1] || '';
  return /^(?:your|our|the|自己的|你的|我们)$/i.test(afterBrand) ? '' : afterBrand;
}

/** Keep an English source narration in English when the catalog only has a Chinese name. */
export function spokenIdentityLabel(sourceTerm: string, catalogName: string, sourceSpeech: string): string {
  if (!/[A-Za-z]/.test(sourceSpeech) || /[\p{Script=Han}]/u.test(sourceSpeech)) return catalogName;
  const english = catalogName.match(/[A-Za-z][A-Za-z0-9\s'&+.-]*/g)
    ?.map(part => part.trim()).find(part => /[A-Za-z]{2}/.test(part));
  return english || sourceTerm;
}

export function replaceReferenceIdentities(source: string, products: Array<{ sourceTerm: string; productLabel: string }>, brand?: { sourceTerm: string; brandLabel: string }): string {
  const replacements = [
    ...products.map(item => ({ source: item.sourceTerm.trim(), target: item.productLabel.trim() })),
    ...(brand?.sourceTerm.trim() && brand.brandLabel.trim() ? [{ source: brand.sourceTerm.trim(), target: brand.brandLabel.trim() }] : []),
  ].filter(item => item.source && item.target).sort((a, b) => b.source.length - a.source.length);
  if (!replacements.length) return source;
  const expression = new RegExp(replacements.map(item => {
    const escaped = item.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return /^[\x00-\x7f]+$/.test(item.source) ? `(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])` : escaped;
  }).join('|'), 'gi');
  return source.replace(expression, match => replacements.find(item => item.source.toLocaleLowerCase() === match.toLocaleLowerCase())?.target || match);
}

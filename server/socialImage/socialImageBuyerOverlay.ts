export type BuyerPosterCopy = {
  headline?: string; subheadline?: string; originBadge?: string; cta?: string;
  sellingPoints?: string[]; bottomBar?: string[];
};
export type BuyerPosterTone = 'cool' | 'warm' | 'botanical';
export type BuyerCopyBacking = 'none' | 'local' | 'solid';

const TONES = {
  cool: { ink: '#15384c', muted: '#31596b', rule: '#6a9bad', footer: '#17465b', footerStrong: '#103449', seal: '#164457', sealLight: '#326f85', edge: '#8cc5d6', pale: '#bde6f0' },
  warm: { ink: '#64283f', muted: '#79405a', rule: '#b97893', footer: '#702b4b', footerStrong: '#581d39', seal: '#792c51', sealLight: '#ae5a7c', edge: '#e3a8c1', pale: '#f2c9dc' },
  botanical: { ink: '#254a35', muted: '#41624c', rule: '#85a88b', footer: '#28523b', footerStrong: '#1c3d2b', seal: '#315f41', sealLight: '#5b8961', edge: '#a9c9aa', pale: '#d6e8cf' },
} as const;

const xml = (value: string) => value.replace(/[<>&"']/g, character => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
}[character]!));

const lines = (value: string, max: number): string[] => {
  const words = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\u0600-\u06ff]/.test(value)
    ? [...value.trim()] : value.trim().split(/\s+/).filter(Boolean);
  const join = words[0]?.length === 1 ? '' : ' ';
  const output: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line}${join}${word}` : word;
    if (candidate.length <= max) { line = candidate; continue; }
    if (line) output.push(line);
    line = word;
  }
  if (line) output.push(line);
  return output;
};

export function isSocialImageBuyerPoster(poster: BuyerPosterCopy): boolean {
  return Boolean(poster.originBadge?.trim() && poster.sellingPoints?.length
    && poster.bottomBar?.length && poster.cta?.trim());
}

export function socialImageBuyerVisibleTexts(poster: BuyerPosterCopy): string[] {
  return [poster.originBadge, poster.headline, poster.subheadline, ...(poster.sellingPoints || []),
    ...(poster.bottomBar || []), poster.cta].map(value => String(value || '').trim()).filter(Boolean);
}

/** The text and seal reserve space before the model places the product hero. */
export function socialImageBuyerLayout(poster: BuyerPosterCopy): {
  copyRight: number; sealLeft: number; heroCenter: number;
} {
  const longestFact = Math.max(0, ...(poster.sellingPoints || []).map(item => item.trim().length));
  const denseCopy = longestFact > 27 || (poster.subheadline || '').trim().length > 28
    || (poster.headline || '').trim().length > 19;
  const copyRight = denseCopy ? .44 : .40;
  const sealLeft = .90 - .083;
  return { copyRight, sealLeft, heroCenter: (copyRight + sealLeft) / 2 + .03 };
}

function productSeal(width: number, height: number, poster: BuyerPosterCopy, scale: number,
  font: (size: number) => number, tone: BuyerPosterTone): string {
  const net = poster.bottomBar?.[0] || '';
  if (!net) return '';
  // Keep the seal in the outer corner; the right-hand product hero owns the inner edge.
  const cx = Math.round(width * .90), cy = Math.round(height * .155);
  const radius = Math.round(Math.min(width, height) * .083);
  const point = (angle: number, distance: number) => `${(cx + Math.cos(angle) * distance).toFixed(1)},${(cy + Math.sin(angle) * distance).toFixed(1)}`;
  const scallop = Array.from({ length: 48 }, (_, index) => point(index * Math.PI / 24,
    radius * (index % 2 ? .955 : 1))).join(' ');
  const ribbonY = cy + Math.round(radius * .60);
  const brand = (poster.originBadge || '').trim();
  const themeWord = (poster.headline || '').split(/\s+/)[0] || '';
  const theme = themeWord.length <= 10 ? xml(themeWord.toUpperCase()) : '';
  const snowY = cy - Math.round(radius * .55), snowArm = Math.round(radius * .10);
  const colors = TONES[tone];
  const leaves = [-.58, -.30, 0, .30, .58].flatMap((offset, index) => [-1, 1].map(side => {
    const x = cx + side * Math.round(radius * (.68 + .07 * Math.abs(offset)));
    const y = cy + Math.round(radius * offset);
    return `<ellipse cx="${x}" cy="${y}" rx="${Math.max(3, Math.round(5 * scale))}" ry="${Math.max(7, Math.round(13 * scale))}" transform="rotate(${side * (28 + index * 3)} ${x} ${y})" fill="${colors.pale}" opacity=".9"/>`;
  })).join('');
  return `<polygon points="${scallop}" fill="url(#sealEdge)" stroke="#fff" stroke-width="${Math.max(2, Math.round(3 * scale))}"/>
    <circle cx="${cx}" cy="${cy}" r="${Math.round(radius * .88)}" fill="url(#sealFace)" stroke="#fff" stroke-width="${Math.max(2, Math.round(3 * scale))}"/>
    <circle cx="${cx}" cy="${cy}" r="${Math.round(radius * .78)}" fill="none" stroke="${colors.edge}" stroke-width="${Math.max(1, Math.round(2 * scale))}"/>
    ${leaves}
    ${tone === 'cool' ? `<path d="M ${cx - snowArm} ${snowY} H ${cx + snowArm} M ${cx} ${snowY - snowArm} V ${snowY + snowArm} M ${cx - snowArm} ${snowY - snowArm} L ${cx + snowArm} ${snowY + snowArm} M ${cx - snowArm} ${snowY + snowArm} L ${cx + snowArm} ${snowY - snowArm}" stroke="#e6faff" stroke-width="${Math.max(2, Math.round(2 * scale))}" stroke-linecap="round"/>` : ''}
    <text x="${cx}" y="${cy - Math.round(radius * .18)}" text-anchor="middle" fill="#ddf5fb" font-family="Arial, PingFang SC, sans-serif" font-size="${font(17)}" font-weight="700" letter-spacing="1.2">${theme}</text>
    <text x="${cx}" y="${cy + Math.round(radius * .24)}" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="${font(45)}" font-weight="700">${xml(net)}</text>
    <path d="M ${cx - Math.round(radius * .91)} ${ribbonY} H ${cx + Math.round(radius * .91)} L ${cx + Math.round(radius * .78)} ${ribbonY + Math.round(radius * .29)} H ${cx - Math.round(radius * .78)} Z" fill="${colors.pale}" stroke="#fff" stroke-width="${Math.max(1, Math.round(2 * scale))}"/>
    ${brand.length <= 18 ? `<text x="${cx}" y="${ribbonY + Math.round(radius * .20)}" text-anchor="middle" fill="${colors.ink}" font-family="Arial, PingFang SC, sans-serif" font-size="${font(17)}" font-weight="700" letter-spacing="1">${xml(brand)}</text>` : ''}`;
}

/** A deterministic, evidence-bound B2B layer. All visible wording comes from the frozen poster. */
export function socialImageBuyerOverlaySvg(width: number, height: number, poster: BuyerPosterCopy,
  highContrast = false, tone: BuyerPosterTone = 'cool', backing: BuyerCopyBacking = 'solid'): Buffer {
  const colors = TONES[tone];
  const layout = socialImageBuyerLayout(poster);
  const scale = Math.min(width, height) / 1200;
  const font = (size: number) => Math.max(10, Math.round(size * scale));
  const x = Math.round(width * .057), right = Math.round(width * .943);
  const brand = lines(poster.originBadge || '', 22);
  const wideGlyphs = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(poster.headline || '');
  const headingWidth = Math.round(width * (layout.copyRight - .035)) - font(36);
  const headingLayout = [60, 54, 48, 42, 36, 32].map(size => {
    const maxChars = Math.max(4, Math.floor(headingWidth / (font(size) * (wideGlyphs ? 1 : .85))));
    return { size, maxChars, rows: lines(poster.headline || '', maxChars) };
  }).find(candidate => candidate.rows.length <= 2 && candidate.rows.every(row => row.length <= candidate.maxChars));
  if (!headingLayout) throw new Error('social_image_buyer_copy_overflow');
  const heading = headingLayout.rows;
  const supporting = lines(poster.subheadline || '', Math.max(12, Math.floor(width * (layout.copyRight - .05) / font(27) * 1.5)));
  const [netContent = '', label = '', question = ''] = poster.bottomBar || [];
  const facts = (poster.sellingPoints || []).flatMap(item => lines(
    item.startsWith('SKU:') && netContent ? `${item} · ${netContent}` : item,
    Math.max(12, Math.floor(width * (layout.copyRight - .10) / font(23) * 1.8))));
  const cta = lines(poster.cta || '', Math.max(12, Math.floor(width * .60 / font(36) * 1.7)));
  const inquiry = lines(question, Math.max(12, Math.floor(width * .38 / font(22) * 1.7)));
  if (brand.length > 1 || heading.length > 2 || supporting.length > 2 || facts.length > 5
    || cta.length > 2 || inquiry.length > 2 || (netContent && !/^\d+(?:\.\d+)?\s?(?:g|kg|ml|l|oz)$/i.test(netContent))) {
    throw new Error('social_image_buyer_copy_overflow');
  }
  const topY = Math.round(height * .046), headingY = Math.round(height * .136);
  const headingLine = font(headingLayout.size + 9);
  const supportY = headingY + (heading.length - 1) * headingLine + font(44);
  const factY = Math.max(Math.round(height * .30), supportY + font(100));
  const factLine = font(43);
  if (factY + facts.length * factLine > height * .47) throw new Error('social_image_buyer_copy_overflow');
  // One compact copy card carries both the headline and buyer facts. Keep the
  // rest of the generated scene untouched so its lighting and detail survive.
  const copyCardTop = topY - font(17);
  const copyCardBottom = factY + (facts.length - 1) * factLine + font(75);
  const labelSize = label.length <= 14 ? font(54) : font(32);
  // Keep the benchmark's full-width rectangular CTA, with the product's color family.
  const footerTop = Math.round(height * .875);
  const footerCtaY = Math.round(height * .953);
  const questionY = Math.round(height * (inquiry.length > 1 ? .938 : .958));
  const fontFamily = 'Arial, PingFang SC, Noto Sans, sans-serif';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="sealEdge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff"/><stop offset=".5" stop-color="${colors.edge}"/><stop offset="1" stop-color="${colors.pale}"/></linearGradient>
      <radialGradient id="sealFace"><stop stop-color="${colors.sealLight}"/><stop offset="1" stop-color="${colors.seal}"/></radialGradient>
    </defs>
    ${facts.length && backing === 'solid' ? `<rect x="${x - font(18)}" y="${copyCardTop}" width="${Math.round(width * (layout.copyRight - .035))}" height="${copyCardBottom - copyCardTop}" rx="${font(18)}" fill="#fff" stroke="${colors.pale}" stroke-width="${Math.max(1, Math.round(2 * scale))}"/>` : ''}
    ${facts.length && backing === 'local' ? `<rect x="${x - font(13)}" y="${copyCardTop}" width="${Math.round(width * (layout.copyRight - .045))}" height="${copyCardBottom - copyCardTop}" rx="${font(12)}" fill="#fff" fill-opacity=".88"/>` : ''}
    <rect y="${footerTop}" width="${width}" height="${height - footerTop}" fill="${highContrast ? colors.footerStrong : colors.footer}"/>
    <line x1="0" y1="${footerTop}" x2="${width}" y2="${footerTop}" stroke="${colors.pale}" stroke-width="${Math.max(2, Math.round(3 * scale))}"/>
    ${brand.map((line, index) => `<text x="${x}" y="${topY + font(30) + index * font(34)}" fill="${colors.ink}" font-family="${fontFamily}" font-size="${font(28)}" font-weight="700" letter-spacing="1">${xml(line)}</text>`).join('')}
    ${brand.length ? `<line x1="${x}" y1="${topY + font(48)}" x2="${x + font(216)}" y2="${topY + font(48)}" stroke="${colors.rule}" stroke-width="2"/>` : ''}
    ${heading.map((line, index) => `<text x="${x}" y="${headingY + index * headingLine}" fill="${colors.ink}" font-family="${fontFamily}" font-size="${font(headingLayout.size)}" font-weight="700">${xml(line)}</text>`).join('')}
    ${supporting.map((line, index) => `<text x="${x}" y="${supportY + index * font(34)}" fill="${colors.muted}" font-family="${fontFamily}" font-size="${font(27)}">${xml(line)}</text>`).join('')}
    ${label && facts.length ? `<text x="${x}" y="${factY - font(58)}" fill="${colors.ink}" font-family="${fontFamily}" font-size="${labelSize}" font-weight="800" letter-spacing=".4">${xml(label)}</text>` : ''}
    ${facts.length ? `<line x1="${x}" y1="${factY - font(32)}" x2="${x + font(315)}" y2="${factY - font(32)}" stroke="${colors.rule}" stroke-width="${Math.max(1, Math.round(2 * scale))}"/>` : ''}
    ${facts.map((line, index) => `<text x="${x}" y="${factY + index * factLine}" fill="${colors.ink}" font-family="${fontFamily}" font-size="${font(line.startsWith('SKU:') ? 21 : 29)}" font-weight="${line.startsWith('SKU:') ? 500 : 700}">${xml(line)}</text>`).join('')}
    ${netContent ? productSeal(width, height, poster, scale, font, tone) : ''}
    <line x1="${Math.round(width * .64)}" y1="${footerTop + font(20)}" x2="${Math.round(width * .64)}" y2="${height - font(20)}" stroke="${colors.pale}" stroke-opacity=".68" stroke-width="${Math.max(1, Math.round(2 * scale))}"/>
    ${cta.map((line, index) => `<text x="${x}" y="${footerCtaY + index * font(37)}" fill="#fff" font-family="${fontFamily}" font-size="${font(36)}" font-weight="700">${xml(line)}</text>`).join('')}
    ${inquiry.map((line, index) => `<text x="${right}" y="${questionY + index * font(26)}" text-anchor="end" fill="#f4fbff" font-family="${fontFamily}" font-size="${font(22)}" font-weight="600">${xml(line)}</text>`).join('')}
  </svg>`);
}

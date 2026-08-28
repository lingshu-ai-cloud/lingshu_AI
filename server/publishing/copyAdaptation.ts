export const PUBLISH_COPY_PLATFORMS = ['youtube', 'tiktok', 'instagram', 'facebook'] as const;

export type PublishCopyPlatform = typeof PUBLISH_COPY_PLATFORMS[number];

export type PlatformCopy = {
  title?: string;
  description?: string;
  caption?: string;
  text?: string;
  tags?: string[];
  hashtags?: string[];
  firstComment?: string;
};

/**
 * Provider limits used by both generation and the final publish payload.
 * YouTube descriptions are byte-limited; the other body limits are Unicode
 * code-point counts so an emoji is not split halfway through.
 */
export const PUBLISH_COPY_LIMITS = {
  youtube: { title: 100, body: 5_000, firstComment: 10_000, tagCount: 30, tagCharacters: 500 },
  tiktok: { title: 2_200, body: 2_200, firstComment: 0, tagCount: 8, tagCharacters: 2_200 },
  instagram: { title: 0, body: 2_200, firstComment: 2_200, tagCount: 12, tagCharacters: 2_200 },
  facebook: { title: 255, body: 63_206, firstComment: 8_000, tagCount: 12, tagCharacters: 63_206 },
} as const satisfies Record<PublishCopyPlatform, {
  title: number;
  body: number;
  firstComment: number;
  tagCount: number;
  tagCharacters: number;
}>;

const STRING_FIELDS = ['title', 'description', 'caption', 'text', 'firstComment'] as const;
const ARRAY_FIELDS = ['tags', 'hashtags'] as const;

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = [...new Set(value.map(String).map(cleanText).filter(Boolean))].slice(0, 12);
  return items.length ? items : undefined;
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function measuredLength(platform: PublishCopyPlatform, field: 'title' | 'body' | 'firstComment', value: string): number {
  return platform === 'youtube' && field === 'body' ? utf8Length(value) : unicodeLength(value);
}

/** Trim text to the real provider field limit without splitting a Unicode code point. */
function truncateToMeasuredLimit(
  platform: PublishCopyPlatform,
  field: 'title' | 'body' | 'firstComment',
  value: string,
  limit: number,
  addEllipsis: boolean,
): string {
  const normalized = cleanText(value);
  if (measuredLength(platform, field, normalized) <= limit) return normalized;
  const suffix = addEllipsis ? '…' : '';
  const characters = Array.from(normalized);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${characters.slice(0, middle).join('').trimEnd()}${suffix}`;
    if (measuredLength(platform, field, candidate) <= limit) low = middle;
    else high = middle - 1;
  }
  return `${characters.slice(0, low).join('').trimEnd()}${suffix}`;
}

export function truncatePublishText(
  platform: PublishCopyPlatform,
  field: 'title' | 'body' | 'firstComment',
  value: string,
): string {
  const normalized = cleanText(value);
  const limit = PUBLISH_COPY_LIMITS[platform][field];
  if (!limit) return '';
  return truncateToMeasuredLimit(platform, field, normalized, limit, true);
}

function normalizedTag(platform: PublishCopyPlatform, value: unknown): string {
  const withoutHash = cleanText(String(value ?? '')).replace(/^#+/, '');
  if (platform === 'youtube') return withoutHash.replace(/[,，]+/g, ' ').replace(/\s+/g, ' ').trim();
  return withoutHash.replace(/[^\p{L}\p{N}_-]+/gu, '').trim();
}

/** Normalize and de-duplicate generated tags before they reach a provider. */
export function normalizePublishTags(platform: PublishCopyPlatform, value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,，]+/)
      : [];
  const output: string[] = [];
  const seen = new Set<string>();
  const limits = PUBLISH_COPY_LIMITS[platform];
  for (const item of source) {
    const tag = normalizedTag(platform, item);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    const candidate = [...output, tag];
    const aggregateLength = candidate.reduce((total, current) => (
      total + unicodeLength(current) + (current.includes(' ') ? 2 : 0)
    ), Math.max(0, candidate.length - 1));
    if (aggregateLength > limits.tagCharacters) continue;
    output.push(tag);
    seen.add(key);
    if (output.length >= limits.tagCount) break;
  }
  return output;
}

function textContainsHashtag(value: string, tag: string): boolean {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)#${escaped}(?=$|\\s|[.,!?;:])`, 'iu').test(value);
}

/**
 * Build the exact provider body. Social hashtags are appended here (not merely
 * returned as editor metadata), while YouTube keeps them in its native tags
 * field. Required trailing blocks are used for the tracked WhatsApp line.
 */
export function composePlatformBody(
  platform: PublishCopyPlatform,
  body: string,
  tags: unknown,
  requiredTrailingBlocks: string[] = [],
): { text: string; tags: string[] } {
  const normalizedBody = cleanText(body);
  const normalizedTags = normalizePublishTags(platform, tags);
  const trailing = requiredTrailingBlocks.map(cleanText).filter(Boolean);
  if (platform === 'youtube') {
    const suffixText = truncatePublishText(platform, 'body', trailing.join('\n\n'));
    const separator = normalizedBody && suffixText ? '\n\n' : '';
    const availableForBody = Math.max(0, PUBLISH_COPY_LIMITS.youtube.body - measuredLength(platform, 'body', `${separator}${suffixText}`));
    const fittedBody = truncateToMeasuredLimit(platform, 'body', normalizedBody, availableForBody, false);
    return {
      text: truncatePublishText(platform, 'body', [fittedBody, suffixText].filter(Boolean).join('\n\n')),
      tags: normalizedTags,
    };
  }

  const existingTags = normalizedTags.filter(tag => textContainsHashtag(normalizedBody, tag));
  const missingTags = normalizedTags.filter(tag => !textContainsHashtag(normalizedBody, tag));
  let appendedTags = [...missingTags];
  const suffix = () => [appendedTags.length ? appendedTags.map(tag => `#${tag}`).join(' ') : '', ...trailing]
    .filter(Boolean)
    .join('\n\n');
  const bodyLimit = PUBLISH_COPY_LIMITS[platform].body;

  while (appendedTags.length && measuredLength(platform, 'body', suffix()) >= bodyLimit) appendedTags.pop();
  let suffixText = suffix();
  if (measuredLength(platform, 'body', suffixText) > bodyLimit) {
    suffixText = truncatePublishText(platform, 'body', suffixText);
  }
  const separator = normalizedBody && suffixText ? '\n\n' : '';
  const availableForBody = Math.max(0, bodyLimit - measuredLength(platform, 'body', `${separator}${suffixText}`));
  const fittedBody = availableForBody
    ? truncateToMeasuredLimit(platform, 'body', normalizedBody, availableForBody, false)
    : '';
  const text = truncatePublishText(platform, 'body', [fittedBody, suffixText].filter(Boolean).join('\n\n'));
  const included = new Set([...existingTags, ...appendedTags].map(tag => tag.toLocaleLowerCase()));
  return {
    text,
    tags: normalizedTags.filter(tag => included.has(tag.toLocaleLowerCase())),
  };
}

function cleanPlatformCopy(value: unknown): PlatformCopy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const copy: PlatformCopy = {};
  for (const field of STRING_FIELDS) {
    const next = cleanText(source[field]);
    if (next) copy[field] = next;
  }
  for (const field of ARRAY_FIELDS) {
    const next = cleanStringArray(source[field]);
    if (next) copy[field] = next;
  }
  return copy;
}

function enforcePlatformCopy(platform: PublishCopyPlatform, value: PlatformCopy): PlatformCopy {
  if (platform === 'youtube') {
    const tags = normalizePublishTags(platform, value.tags);
    return {
      title: truncatePublishText(platform, 'title', value.title || ''),
      description: truncatePublishText(platform, 'body', value.description || ''),
      ...(tags.length ? { tags } : {}),
      firstComment: truncatePublishText(platform, 'firstComment', value.firstComment || ''),
    };
  }
  const tagSource = value.hashtags;
  const composed = composePlatformBody(
    platform,
    platform === 'facebook' ? value.text || '' : value.caption || '',
    tagSource,
  );
  return {
    ...(platform === 'facebook' ? { text: composed.text } : { caption: composed.text }),
    ...(composed.tags.length ? { hashtags: composed.tags.map(tag => `#${tag}`) } : {}),
    firstComment: truncatePublishText(platform, 'firstComment', value.firstComment || ''),
  };
}

function shorten(value: string, limit: number): string {
  const normalized = cleanText(value).replace(/\s+/g, ' ');
  return normalized.length > limit ? normalized.slice(0, limit).trimEnd() : normalized;
}

const SILENT_SPEECH = /^(?:无|无台词|无口播|none|no voiceover|silent|n\/a)[。.!！]?$/i;
const FALLBACK_TAG_TERMS = [
  'automation', 'assembly', 'equipment', 'factory', 'industrial', 'inspection',
  'machine', 'manufacturing', 'packaging', 'product', 'robotics', 'wholesale',
] as const;

const FACT_SENSITIVE_PATTERNS = [
  /\b(?:no middlem[ae]n|markups?|affordab\w*|prices?|pricing|costs?|value|discount\w*|free)\b/i,
  /\b(?:high[- ]quality|premium quality|quality you trust|well[- ]made|thoughtfully made|built to last|craft(?:ed|smanship)|durab\w*|long[- ]lasting|reliab\w*)\b/i,
  /\b(?:in stock|ready to ship|ship\w*|deliver\w*|lead time)\b/i,
  /\b(?:best[- ]sell\w*|trending|viral|flying off|customers? love|loved by)\b/i,
  /\b(?:certif(?:ied|ication)|compliant|compliance|\bCE\b|\bFDA\b|\bISO\b)\b/i,
  /\b(?:customiz\w*|custom[- ]made|\bOEM\b|\bODM\b)\b/i,
  /\b(?:auto[- ]resiz\w*|voiceover sync|caption optimization|no editing|no delays?)\b/i,
] as const;

function introducesUnsupportedClaim(copy: PlatformCopy, title: string, description: string): boolean {
  const source = `${title}\n${description}`;
  const generated = JSON.stringify(copy);
  return FACT_SENSITIVE_PATTERNS.some(pattern => {
    pattern.lastIndex = 0;
    const presentInGenerated = pattern.test(generated);
    pattern.lastIndex = 0;
    return presentInGenerated && !pattern.test(source);
  });
}

function groundedSourceLines(value: string): string[] {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line
      .replace(/^\s*\[[^\]]+\]\s*/, '')
      .replace(/^\s*(?:台词|人物说|旁白|口播|voiceover|vo|dialogue)\s*[：:]\s*/i, '')
      .replace(/^[“\"]|[”\"]$/g, '')
      .trim())
    .filter(line => Boolean(line) && !SILENT_SPEECH.test(line));
}

function spokenLines(script: string): string[] {
  return String(script || '')
    .split(/\r?\n/)
    .map(line => line.match(/^\s*(?:台词|人物说|旁白|口播|voiceover|vo|dialogue)\s*[：:]\s*(.+)$/i)?.[1] || '')
    .map(line => line.replace(/^[“\"]|[”\"]$/g, '').trim())
    .filter(line => Boolean(line) && !SILENT_SPEECH.test(line));
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.filter(line => {
    const key = line.replace(/\s+/g, ' ').toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function coverLength(value: string): string {
  const clean = value
    .replace(/^\s*(?:product|产品|名称|name)\s*[：:]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  if (/^[\x00-\x7F]+$/.test(clean)) return clean.split(' ').slice(0, 6).join(' ').replace(/[,:;.!?]+$/g, '');
  return clean.slice(0, 18).replace(/[，。！？；：]+$/g, '');
}

/** Build cover candidates from the current script/product only; never reuse demo-category claims. */
export function groundedCoverTitleFallbacks(script: string, productInfo: string, language = 'en'): string[] {
  const fromScript = spokenLines(script);
  const fromProduct = groundedSourceLines(productInfo);
  const candidates = uniqueLines([
    fromScript[0] || '',
    fromProduct[0] || '',
    fromScript.at(-1) || '',
  ]).map(coverLength).filter(Boolean);
  const neutral = String(language).toLowerCase().startsWith('zh')
    ? ['产品实拍', '看看实际效果', '买家重点看什么']
    : ['See the Product', 'Product in Action', 'What Buyers Should Check'];
  return uniqueLines([...candidates, ...neutral]).slice(0, 3);
}

function groundedTags(title: string, description: string, hashPrefix: boolean): string[] {
  const source = `${title} ${description}`.toLowerCase();
  const terms = FALLBACK_TAG_TERMS.filter(term => new RegExp(`\\b${term}\\b`, 'i').test(source));
  const selected = uniqueLines([...terms, 'productdemo']).slice(0, 4);
  return selected.map(tag => `${hashPrefix ? '#' : ''}${tag}`);
}

/** Conservative local caption assembled only from visible/scripted product information. */
export function groundedCaptionFallback(script: string, productInfo: string): { caption: string; hashtags: string[] } {
  const speech = uniqueLines(spokenLines(script));
  const product = uniqueLines(groundedSourceLines(productInfo));
  const selected = speech.length > 1 ? [speech[0], speech.at(-1)!] : speech.length ? speech : product.slice(0, 2);
  const caption = shorten(selected.join(' '), 280) || 'See the product in action.';
  return { caption, hashtags: groundedTags('', `${caption} ${productInfo}`, false) };
}

function youtubeTitle(title: string, variant: number): string {
  const base = truncatePublishText('youtube', 'title', title) || 'Product update';
  if (variant === 1) return truncatePublishText('youtube', 'title', `${base} | A Closer Look`);
  if (variant === 2) return truncatePublishText('youtube', 'title', `See ${base} in Action`);
  return base;
}

/**
 * Local copy keeps the publishing editor useful when the configured LLM is
 * temporarily unavailable. Variants are deliberately conservative and only
 * rearrange user-provided facts plus a generic inquiry CTA.
 */
export function platformCopyFallback(
  platform: PublishCopyPlatform,
  title: string,
  description: string,
  variant = 0,
): PlatformCopy {
  const base = cleanText(description) || cleanText(title) || 'New product update';
  const selectedVariant = ((variant % 3) + 3) % 3;
  const plainTags = groundedTags(title, description, false);
  const hashTags = groundedTags(title, description, true);

  if (platform === 'youtube') {
    const endings = [
      'Contact us if you want to verify specifications or discuss your requirements.',
      'Which detail would help your evaluation? Send us a message.',
      'Share what you need to confirm and we will continue the discussion.',
    ];
    return {
      title: youtubeTitle(title, selectedVariant),
      description: `${base}\n\n${endings[selectedVariant]}`,
      tags: plainTags,
      firstComment: selectedVariant === 0
        ? hashTags.join(' ')
        : selectedVariant === 1
          ? 'What product detail should we show next?'
          : 'Message us with the point you want to verify.',
    };
  }

  if (platform === 'tiktok') {
    const endings = [
      ' Message us for more details.',
      ' What should we show next?',
      ' Tell us what you want to verify.',
    ];
    const ending = endings[selectedVariant];
    return {
      caption: `${shorten(base, Math.max(1, PUBLISH_COPY_LIMITS.tiktok.body - ending.length))}${ending}`,
      hashtags: hashTags,
      firstComment: selectedVariant === 0
        ? hashTags.join(' ')
        : selectedVariant === 1
          ? 'Which detail would help your evaluation?'
          : 'Message us with your requirements.',
    };
  }

  if (platform === 'instagram') {
    const endings = [
      'Message us if you want to verify a product detail.',
      'Save this for your review, then tell us what you want to see next.',
      'Want to discuss your requirements? Send us a message.',
    ];
    return {
      caption: `${base}\n\n${endings[selectedVariant]}`,
      hashtags: hashTags,
      firstComment: selectedVariant === 0
        ? hashTags.join(' ')
        : selectedVariant === 1
          ? 'Which product detail should we show next?'
          : 'Message us with the point you want to verify.',
    };
  }

  const endings = [
    'Message us if you want to verify specifications or discuss your requirements.',
    'Tell us which product detail would help your evaluation.',
    'Contact us with the point you want to confirm.',
  ];
  return {
    text: `${base}\n\n${endings[selectedVariant]}`,
    hashtags: hashTags,
    firstComment: selectedVariant === 0 ? '' : 'Send us a message to continue the conversation.',
  };
}

function visibleCopyFingerprint(platform: PublishCopyPlatform, copy?: PlatformCopy): string {
  if (!copy) return '';
  const values = platform === 'youtube'
    ? [copy.title, copy.description]
    : platform === 'facebook'
      ? [copy.text]
      : [copy.caption];
  return values.map(value => cleanText(value).replace(/\s+/g, ' ').toLocaleLowerCase()).join('\n');
}

function alternativeFallback(
  platform: PublishCopyPlatform,
  title: string,
  description: string,
  current?: PlatformCopy,
): PlatformCopy {
  const currentFingerprint = visibleCopyFingerprint(platform, current);
  for (let variant = 0; variant < 3; variant += 1) {
    const candidate = platformCopyFallback(platform, title, description, variant);
    if (!currentFingerprint || visibleCopyFingerprint(platform, candidate) !== currentFingerprint) return candidate;
  }
  return platformCopyFallback(platform, title, description, 0);
}

export function normalizePlatformCopies(
  raw: unknown,
  platforms: PublishCopyPlatform[],
  title: string,
  description: string,
  options: { currentCopy?: Partial<Record<PublishCopyPlatform, PlatformCopy>>; requireAlternative?: boolean } = {},
): Record<string, PlatformCopy> {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const output: Record<string, PlatformCopy> = {};

  for (const platform of platforms) {
    const current = options.currentCopy?.[platform];
    const fallback = options.requireAlternative
      ? alternativeFallback(platform, title, description, current)
      : platformCopyFallback(platform, title, description);
    const generated = cleanPlatformCopy(source[platform]);
    let candidate = introducesUnsupportedClaim(generated, title, description)
      ? fallback
      : { ...fallback, ...generated };
    if (
      options.requireAlternative
      && visibleCopyFingerprint(platform, candidate) === visibleCopyFingerprint(platform, current)
    ) {
      candidate = fallback;
    }
    output[platform] = enforcePlatformCopy(platform, candidate);
  }

  return output;
}

export function sanitizePublishCopyPlatforms(value: unknown): PublishCopyPlatform[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(PUBLISH_COPY_PLATFORMS);
  return [...new Set(value.map(String).map(cleanText).filter(item => allowed.has(item)))] as PublishCopyPlatform[];
}

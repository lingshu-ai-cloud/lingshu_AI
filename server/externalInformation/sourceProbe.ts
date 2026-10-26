import { XMLParser, XMLValidator } from 'fast-xml-parser';

export interface DiscoveryItem {
  title: string;
  url: string;
  publishedAt: string;
  publisher: string;
  relevance: 'matched' | 'unmatched';
}

/** RSS is discovery evidence only; titles do not establish article facts. */
export function parseDiscoveryFeed(xml: string, kind: 'news' | 'trends', now: number): {
  items: DiscoveryItem[]; total: number; rejected: number;
} {
  if (XMLValidator.validate(xml) !== true) throw Error('feed_xml_invalid');
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' }).parse(xml);
  if (!parsed?.rss?.channel) throw Error('feed_channel_missing');
  const rows = parsed.rss.channel.item;
  const items: DiscoveryItem[] = [];
  const input: Record<string, unknown>[] = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const seen = new Set<string>();
  for (const row of input) {
    const title = String(row.title ?? '').trim();
    const published = Date.parse(String(row.pubDate ?? ''));
    const source = row.source as Record<string, unknown> | undefined;
    let url: URL;
    try { url = new URL(String(row.link ?? '')); } catch { continue; }
    const identity = kind === 'trends' ? `${url.href}#${title}` : url.href;
    if (url.protocol !== 'https:' || url.username || url.password || !title || seen.has(identity)
      || !Number.isFinite(published) || published > now + 300_000 || published < now - 7 * 86400_000) continue;
    seen.add(identity);
    // Explicit sample scope: Vietnam cosmetics; trends feed is nationwide, not keyword history.
    const matched = /cosmetic|c-beauty|skincare|skin care|sunscreen|mỹ phẩm|chống nắng/iu.test(title)
      && (kind === 'trends' || /vietnam|viet nam|việt nam/iu.test(title));
    items.push({ title, url: url.href, publishedAt: new Date(published).toISOString(),
      publisher: String(source?.['#text'] ?? source ?? (kind === 'trends' ? 'Google Trends' : '未知')),
      relevance: matched ? 'matched' : 'unmatched' });
  }
  return { items, total: input.length, rejected: input.length - items.length };
}

export function assessPolicyCandidate(text: string, sources: Array<{ title: string; url: string }>): string[] {
  const reasons: string[] = [];
  if (!sources.some(source => /(?:^|\.)gov\.vn$/iu.test(source.title))) reasons.push('official_original_not_verified');
  if (/链接为示例|示例链接|123456789|example\.com/iu.test(text)) reasons.push('placeholder_link_in_generated_answer');
  if (!sources.length) reasons.push('grounding_sources_missing');
  return reasons;
}

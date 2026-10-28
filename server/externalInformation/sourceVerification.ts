import { publicSearchOriginalUrl } from '../../shared/publicSearchReadPolicy.mjs';
import type { GroundingSource } from '../agents/llm.js';
import { externalText, ExternalInformationError } from './http.js';
import { appendInformationSources, hasOverallConclusion } from './sourceFooter.js';

import { publicSourceUrl } from '../../shared/assistantPublicSourcePolicy.mjs';
export { publicSourceUrl };

export const SEARCH_ORIGINAL_RULES = `联网输出契约：最多引用3篇HTTPS原始公告，不用首页或栏目页。每条事实单独成段，附明确发布日（无发布日且不是近期问题时，直接说明未标明）、一段12至80字的逐字原文短摘录（用中文双引号“”，保留原文语言，不将译文冒充原文）及检索返回的角标[编号]。不编造摘录或数字，不复述查询起止日期。最后单独用“总体结论：”综合判断，注明适用范围或证据不足；不引入新的事实，不自行追加来源清单。`;

export function sourcePlainText(value: string): string {
  return value.replace(/<!--[^]*?-->/gu, ' ').replace(/<(script|style|nav|footer|header)\b[^>]*>[^]*?<\/\1\s*>/giu, ' ')
    .replace(/<[^>]*>/gu, ' ').replace(/&#(x[\da-f]+|\d+);/giu, (_, code: string) => {
      const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' ';
    }).replace(/&(?:nbsp|amp|quot|lt|gt|apos);/gu, token => ({ '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&apos;': "'" })[token] ?? ' ')
    .replace(/\s+/gu, ' ').trim();
}
function dates(value: string): string[] {
  return [...value.matchAll(/(20\d{2})\s*(?:年|[-/])\s*(\d{1,2})\s*(?:月|[-/])\s*(\d{1,2})\s*日?/gu)]
    .map(match => `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`);
}
/** A chapter heading is not the document title, even when the publisher styles it as h1. */
export function isArticleSectionHeading(value: string): boolean {
  return /^(?:第[一二三四五六七八九十百\d]+[章节部分]|[一二三四五六七八九十百]+[、.．]|[（(][一二三四五六七八九十百\d]+[）)]|\d{1,2}[、.．])|^(?:市场背景与现状|市场背景|内容摘要|目录|引言|核心趋势分析|市场概述)$/u.test(value.trim());
}
function semanticArticleBody(html: string): string | undefined {
  const clean = html.replace(/<!--[^]*?-->/gu, ' ').replace(/<(script|style|nav|footer|aside)\b[^>]*>[^]*?<\/\1\s*>/giu, ' ');
  const article = clean.match(/<article\b[^>]*>([^]*?)<\/article>/iu)?.[1]
    ?? clean.match(/<main\b[^>]*>([^]*?)<\/main>/iu)?.[1];
  if (article !== undefined) return article;
  // Many publishers use div-based article templates. Admit only explicit article/main markers,
  // not arbitrary "content" containers, and balance nested tags instead of truncating at the first div.
  for (const opening of clean.matchAll(/<(div|section)\b([^>]*)>/giu)) {
    const attrs = Object.fromEntries([...opening[2].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/gu)].map(match => [match[1].toLowerCase(), match[2]]));
    const marked = attrs.role === 'main' || /(?:^|\s)articleBody(?:\s|$)/iu.test(attrs.itemprop ?? '')
      || /(?:^|[\s_-])(?:article-content|article-body|article-detail|news-content|news-body|post-content|post-body)(?:$|[\s_-])/iu.test([attrs.id, attrs.class].filter(Boolean).join(' '));
    if (!marked) continue;
    const start = opening.index! + opening[0].length;
    const tags = new RegExp('<(\\/?)' + opening[1] + '\\b[^>]*>', 'giu'); tags.lastIndex = start;
    let depth = 1; for (const tag of clean.matchAll(tags)) { depth += tag[1] ? -1 : 1; if (!depth) return clean.slice(start, tag.index); }
  }
  return undefined;
}
/** Follow only explicit outbound article citations, never navigation or invented provider URLs. */
export function sourceArticleLinks(html: string, sourceUri: string): GroundingSource[] {
  const body = semanticArticleBody(html);
  if (!body) return [];
  const base = new URL(sourceUri), seen = new Set<string>(), links: GroundingSource[] = [];
  for (const match of body.matchAll(/<a\b([^>]*)>([^]*?)<\/a\s*>/giu)) {
    const href = match[1].match(/\bhref\s*=\s*["']([^"']+)["']/iu)?.[1];
    const title = sourcePlainText(match[2]);
    if (!href || title.length < 2 || title.length > 240) continue;
    try {
      const url = publicSearchOriginalUrl(new URL(href.replaceAll('&amp;', '&'), base).href);
      url.hash = '';
      if (url.hostname.replace(/^www\./u, '') === base.hostname.replace(/^www\./u, '') || seen.has(url.href)) continue;
      seen.add(url.href); links.push({ title, uri: url.href });
      if (links.length === 8) break;
    } catch { /* Unsafe, private and non-article URLs are not read candidates. */ }
  }
  return links;
}
export function extractSourceArticle(html: string): { text: string; published: string[]; headline?: string; publishedTimes?: string[] } {
  const publicationFields: string[] = [];
  let metadataHeadline: string | undefined;
  for (const tag of html.match(/<meta\b[^>]*>/giu) ?? []) {
    const attributes = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/gu)].map(match => [match[1].toLowerCase(), match[2]]));
    if (/^(?:og:title|twitter:title)$/iu.test(attributes.property ?? attributes.name ?? '')) metadataHeadline ??= sourcePlainText(attributes.content ?? '');
    if (/^(?:article:published_time|datePublished|publishdate|publish_date|publish_time|pubtime|pubdate|publication_date|DC.date.issued)$/iu.test(attributes.property ?? attributes.name ?? attributes.itemprop ?? '')) publicationFields.push(attributes.content ?? '');
  }
  // Explicit article JSON-LD is publication evidence; dateModified and unrelated widgets are not.
  if (!publicationFields.flatMap(dates).length) {
    for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([^]*?)<\/script>/giu)) {
      try {
        const root = JSON.parse(match[1]);
        const nodes = Array.isArray(root) ? root : [root, ...(Array.isArray(root?.['@graph']) ? root['@graph'] : [])];
        for (const node of nodes) {
          const types = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
          if (types.some((type: unknown) => typeof type === 'string' && /^(?:NewsArticle|Article|BlogPosting)$/u.test(type)) && typeof node.datePublished === 'string') publicationFields.push(node.datePublished);
        }
      } catch { /* Invalid structured data is not publication evidence. */ }
    }
  }
  const articleBody = semanticArticleBody(html);
  const scopedHeading = articleBody?.match(/<h1\b[^>]*>([^]*?)<\/h1>/iu)?.[1];
  const scopedTitle = scopedHeading ? sourcePlainText(scopedHeading) : undefined;
  const documentTitle = sourcePlainText(html.match(/<title\b[^>]*>([^]*?)<\/title>/iu)?.[1] ?? '');
  const headline = articleBody !== undefined ? [scopedTitle && !isArticleSectionHeading(scopedTitle) ? scopedTitle : undefined, metadataHeadline, documentTitle].find(title => title && title.length >= 4 && title.length <= 240 && !isArticleSectionHeading(title)) : undefined;
  // A headline explicitly associated with the article stays valid when the page renders it outside the body wrapper.
  let text = sourcePlainText(articleBody === undefined ? html : articleBody.replace(/<(\/?)header\b/giu, '<$1div'));
  if (headline && headline.length >= 4 && headline.length <= 240 && !text.includes(headline)) text = headline + ' ' + text;
  // Named publication fields only: a dated URL, copyright or query time is not a publication date.
  if (!publicationFields.flatMap(dates).length) {
    const articleText = articleBody === undefined ? '' : text;
    publicationFields.push(...[...articleText.matchAll(/(?:发布时间|发布日期|发布日|Published(?: on)?|Date published)\s*[:：]?\s*(20\d{2}[年/-]\s*\d{1,2}[月/-]\s*\d{1,2}日?)/giu)].map(match => match[1]));
  }
  if (!publicationFields.flatMap(dates).length) {
    // Media articles often publish only <time datetime>. Restrict this fallback to
    // article/main, excluding navigation, related content and explicit updates.
    const scope = articleBody ?? '';
    const content = scope.replace(/<(script|style|nav|footer|aside)\b[^>]*>[^]*?<\/\1\s*>/giu, ' ');
    const candidates: string[] = [], candidateTimes: string[] = [];
    for (const match of content.matchAll(/<time\b([^>]*)>([^]*?)<\/time\s*>/giu)) {
      const attributes = Object.fromEntries([...match[1].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/gu)].map(attribute => [attribute[1].toLowerCase(), attribute[2]]));
      const context = content.slice(Math.max(0, (match.index ?? 0) - 80), match.index) + ' ' + match[1] + ' ' + sourcePlainText(match[2]);
      if (/modified|updated|dateModified|startDate|endDate|eventDate|更新|修改|活动时间|活动日期/iu.test(context)) continue;
      const value = attributes.datetime;
      if (!value || !/^20\d{2}-\d{2}-\d{2}(?:T[^\s]+)?$/u.test(value) || !Number.isFinite(Date.parse(value))) continue;
      const day = value.slice(0, 10);
      if (Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day) { candidates.push(day); candidateTimes.push(value); }
    }
    const unique = [...new Set(candidates)];
    if (unique.length === 1) publicationFields.push(unique[0], ...candidateTimes);
  }
  const publishedTimes = [...new Set(publicationFields.filter(value => /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/u.test(value) && Number.isFinite(Date.parse(value))))];
  return { text, published: [...new Set(publicationFields.flatMap(dates))], ...(headline ? { headline } : {}), ...(publishedTimes.length ? {publishedTimes} : {}) };
}
function compact(value: string): string { return value.replace(/[\s,，]/gu, '').normalize('NFKC'); }
export function assertSourceSupport(answer: string, articles: Array<{ text: string; published: string[] }>, days?: number, now = Date.now()): void {
  const body = answer.replace(/\[(?:ref_)?\d+\]/gu, '').replace(/^\s*\d+[.、)]\s*/gmu, '');
  const quotes = [...body.matchAll(/“([^”\n]{12,160})”/gu)].map(match => compact(match[1]));
  const texts = articles.map(article => compact(article.text + ' ' + article.published.join(' ')));
  if (!quotes.length || quotes.some(quote => !texts.some(text => text.includes(quote)))) throw Error('source_quote_mismatch');
  // B2B/B2C are business audience labels, not numeric evidence; strip on both sides.
  const numericText=(value:string)=>value.normalize('NFKC').replace(/\bB2[BC]\b/giu,'').replace(/(?<![\d.])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)/gu,number=>number.replaceAll(',',''));
  const originalNumbers = new Set([...numericText(articles.map(article=>article.text+' '+article.published.join(' ')).join(' ')).matchAll(/\d+(?:\.\d+)?%?/gu)].map(match => match[0]));
  // Exact lexical guard, not a semantic proof: never release changed or invented figures.
  const numbers = [...numericText(body).matchAll(/\d+(?:\.\d+)?%?/gu)].map(match => match[0]);
  if (numbers.some(number => !originalNumbers.has(number))) throw Error('source_number_mismatch');
  const originalDates = articles.flatMap(article => [...article.published, ...dates(article.text)]);
  if (dates(body).some(date => !originalDates.includes(date))) throw Error('source_date_mismatch');
  if (days) {
    const published = articles.flatMap(article => article.published).filter(date => {
      const time = Date.parse(date + 'T00:00:00Z');
      return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date && time >= now - days * 86400000 && time <= now + 86400000;
    });
    const claimed = dates(body);
    if (!claimed.length || claimed.some(date => !published.includes(date)) || articles.some(article => !article.published.some(date => published.includes(date)))) throw Error('source_publication_unverified');
  }
}

/** At most three original pages; fail closed before any generated claims reach the browser. */
export async function verifySearchAnswer(text: string, sources: GroundingSource[], options: {
  signal?: AbortSignal; freshnessDays?: number; fetcher?: typeof fetch;
} = {}): Promise<GroundingSource[]> {
  const cited = [...new Set([...text.matchAll(/\[(?:ref_)?(\d+)\]/gu)].map(match => Number(match[1])))];
  const selected = cited.length ? sources.filter(source => source.citationIndex !== undefined && cited.includes(source.citationIndex)) : sources;
  try {
    if (!hasOverallConclusion(text)) throw Error('answer_conclusion_missing');
    if (sources.some(source => source.citationIndex !== undefined && sources.filter(item => item.citationIndex === source.citationIndex).length !== 1)) throw Error('source_index_ambiguous');
    if (!selected.length || selected.length > 3 || cited.some(index => !selected.some(source => source.citationIndex === index))) throw Error('source_citation_mismatch');
    const articles = [];
    for (const source of selected) {
      const html = await externalText(publicSourceUrl(source.uri), { signal: options.signal, timeoutMs: 8000, fetcher: options.fetcher,
        init: { headers: { Accept: 'text/html,application/xhtml+xml' } } });
      const article = extractSourceArticle(html);
      if (article.text.length < 80) throw Error('source_article_missing');
      const title = compact(source.title);
      if (title.length < 6 || !compact(article.text).includes(title)) throw Error('source_title_mismatch');
      articles.push(article);
    }
    assertSourceSupport(text, articles, options.freshnessDays);
    // Check each cited paragraph against its own originals, rather than an unrelated source.
    for (const paragraph of text.split(/\n\s*\n/u)) {
      const indexes = [...paragraph.matchAll(/\[(?:ref_)?(\d+)\]/gu)].map(match => Number(match[1]));
      if (/^(?:\*\*)?总体结论(?:\*\*)?[：:]/u.test(paragraph.trim())) continue;
      if (!indexes.length) {
        if (paragraph.trim().length > 30) throw Error('source_paragraph_uncited');
        continue;
      }
      assertSourceSupport(paragraph, articles.filter((_, index) => indexes.includes(selected[index].citationIndex!)), options.freshnessDays);
    }
    return selected;
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    const reason = error instanceof ExternalInformationError ? error.code
      : error instanceof Error && /^(?:source_[a-z_]+|answer_conclusion_missing)$/u.test(error.message) ? error.message : 'source_verification_unavailable';
    console.info('[assistant-source-verification]', JSON.stringify({ code: 'search_source_verification_failed', reason,
      hosts: selected.map(source => new URL(source.uri).hostname) }));
    const leads = (selected.length ? selected : sources).slice(0, 3).map(source => ({ ...source, title: `${source.title}（检索线索，原文未核验）` }));
    throw new ExternalInformationError('search_source_verification_failed', appendInformationSources(
      '总体结论：本轮检索找到了线索，但原文读取、发布日期或关键摘录/数字未通过核验，暂不能据此确认最新动态或给出经营判断。以下仅为检索线索。', leads), leads.map(({ title, uri }) => ({ title, uri })));
  }
}

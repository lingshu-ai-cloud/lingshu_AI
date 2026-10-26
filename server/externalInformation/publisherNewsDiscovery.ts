import type { GroundingSource } from '../agents/llm.js';
import { externalText } from './http.js';
import { publicSourceUrl } from './sourceVerification.js';

const basfIndex = 'https://www.basf.com/tw/zh/media/news-releases';
/** Discovery only: a directory is never evidence; article bodies/dates must pass the normal verifier. */
export function basfArticleLinks(html: string): GroundingSource[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/giu)) {
    try {
      const url = publicSourceUrl(new URL(match[1].replaceAll('&amp;', '&'), basfIndex).href);
      if (url.origin === 'https://www.basf.com' && /^\/tw\/zh\/media\/news-releases\/asia-pacific\/20\d{2}\/\d{2}\/[^/]+$/u.test(url.pathname)) urls.add(url.href);
    } catch { /* Non-article navigation cannot become a source. */ }
  }
  return [...urls].slice(0, 4).map(uri => ({ title: 'BASF官方公告（正文标题待核验）', uri }));
}

export async function discoverPublisherNews(question: string, options: {
  domains?: readonly string[]; signal?: AbortSignal; fetcher?: typeof fetch;
} = {}): Promise<GroundingSource[]> {
  if (!/\bBASF\b|巴斯夫/iu.test(question) || !/美妆|美妝|化妆品|化妝品|个护|個護|personal care|cosmetic|NeoHelix/iu.test(question)
    || (options.domains?.length && !options.domains.some(domain => domain === 'basf.com' || domain === 'www.basf.com'))) return [];
  try {
    const html = await externalText(publicSourceUrl(basfIndex), { signal: options.signal, timeoutMs: 7000,
      fetcher: options.fetcher, init: { headers: { Accept: 'text/html' } } });
    return basfArticleLinks(html);
  } catch {
    options.signal?.throwIfAborted();
    return []; // A failed directory read permits the one normal search, never a paid retry.
  }
}

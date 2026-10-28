import type { GroundingSource } from '../agents/llm.js';
import { externalText } from './http.js';
import { publicSourceUrl } from './sourceVerification.js';
import { discoverNewsArticles } from './authoritativeNews.js';
import { AUTHORITATIVE_NEWS_SOURCES } from '../../shared/authoritativeNewsSources.js';

const basfIndex = 'https://www.basf.com/tw/zh/media/news-releases';
/** A directory sample is useful only for an explicitly broad industry brief. Unknown subjects use normal search. */
function isGeneralBeautyBrief(question: string): boolean {
  const query = question.split('\n已明确的查询范围：')[0].trim()
    .replace(/^(?:行业资讯|今日资讯)。\s*/u, '');
  const category = '(?:美妆|化妆品|护肤|个护)(?:原料)?';
  const market = '(?:全球|欧洲|欧盟|中国|国内|美国|英国|日本|韩国|东南亚|中东|非洲|澳大利亚|加拿大)';
  if (new RegExp(`^(?:行业资讯|今日资讯)[：:]${market}?${category}(?:最近30天)?[。]?$`, 'u').test(query)) return true;
  const heading = new RegExp(`^(?:行业资讯|今日资讯)[：:]行业[：:]${category}[，,]\\s*目标市场[：:]${market}(?:。|$)`, 'u').exec(query);
  if (!heading) return false;
  // Recognize the broad launcher instructions, never arbitrary trailing company, ingredient or policy topics.
  const generalInstructions = new Set([
    '查询最近30天与该行业及市场相关的市场变化、技术趋势、供应链和竞争动向',
    '查询最近30天相关的市场变化、技术趋势、供应链和竞争动向',
    '只采用可读取且有发布日期的原始来源，区分事实、推断与建议，不把发布计划当作销量或收益',
    '只采用有明确发布日期、实际可读取的原始来源',
    '区分事实、分析推断和建议，给出可执行的调研方向，不把发布计划当作销量或收益',
  ]);
  return query.slice(heading[0].length).split(/[。；;]/u).map(clause => clause.trim()).filter(Boolean)
    .every(clause => generalInstructions.has(clause));
}
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
  if (isGeneralBeautyBrief(question)) {
    const directories = [
      { host: 'basf.com', url: AUTHORITATIVE_NEWS_SOURCES[0].index },
      { host: 'dsm-firmenich.com', url: 'https://www.dsm-firmenich.com/en/businesses/perfumery-beauty/beauty-care/press-releases.html' },
    ].filter(item => !options.domains?.length || options.domains.includes(item.host));
    const outcomes = await Promise.allSettled(directories.map(async directory => {
      const html = await externalText(publicSourceUrl(directory.url), { signal: options.signal, timeoutMs: 7000,
        fetcher: options.fetcher, init: { headers: { Accept: 'text/html' } } });
      if (directory.host === 'basf.com') return discoverNewsArticles(html, AUTHORITATIVE_NEWS_SOURCES[0]).slice(0, 3)
        .map(item => ({ title: item.title, uri: item.url }));
      const urls = new Set<string>();
      for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/giu)) {
        try {
          const url = publicSourceUrl(new URL(match[1].replaceAll('&amp;', '&'), directory.url).href);
          if (url.hostname === 'www.dsm-firmenich.com' && /^\/en\/businesses\/perfumery-beauty\/beauty-care\/press-releases\/.+\.html$/u.test(url.pathname)
            && !url.search) urls.add(url.href);
        } catch { /* Only actual same-publisher original links qualify. */ }
      }
      return [...urls].slice(0, 3).map(uri => ({ title: 'dsm-firmenich官方公告（正文标题待核验）', uri }));
    }));
    options.signal?.throwIfAborted();
    return outcomes.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  }
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

import { XMLParser } from 'fast-xml-parser';
import type { GroundingSource } from '../agents/llm.js';
import { publicSearchOriginalUrl, readPublicSearchOriginal } from './publicSearchOriginal.js';
import { sourcePlainText } from './sourceVerification.js';

/** Feed metadata discovers candidates only. Neither pubDate nor description can become article evidence. */
export function publicNewsRssCandidates(xml: string, options: { now?: number; freshnessDays?: number } = {}): GroundingSource[] {
 if (xml.length > 1_000_000 || /<!DOCTYPE|<!ENTITY/iu.test(xml)) throw Error('news_rss_invalid');
 const parsed = new XMLParser({ ignoreAttributes: true, parseTagValue: false }).parse(xml);
 const value = parsed?.rss?.channel?.item;
 const items = Array.isArray(value) ? value : value ? [value] : [];
 const result:GroundingSource[] = [], seen = new Set<string>();
 for (const item of items.slice(0, 40)) {
  if (typeof item?.title !== 'string' || typeof item?.link !== 'string' || typeof item?.pubDate !== 'string') continue;
  const date = Date.parse(item.pubDate), now = options.now ?? Date.now();
  if (!Number.isFinite(date) || date > now + 86400000 || (options.freshnessDays && date < now - options.freshnessDays * 86400000)) continue;
  try {
   const link = new URL(item.link);
   // Bing's RSS explicitly includes the publisher URL. Do not follow the tracking redirect or invent a destination.
   const target = ['www.bing.com', 'bing.com'].includes(link.hostname) && link.pathname === '/news/apiclick.aspx' ? link.searchParams.get('url') : link.href;
   if (!target) continue;
   const url = publicSearchOriginalUrl(target);
   if (/(?:^|\.)(?:bing|google)\.com$/u.test(url.hostname) || seen.has(url.href)) continue;
   const title = sourcePlainText(item.title).slice(0, 240);
   if (title.length < 4) continue;
   seen.add(url.href); result.push({ title, uri: url.href });
   if (result.length === 12) break;
  } catch { /* Non-public original destinations cannot become read candidates. */ }
 }
 return result;
}
export async function discoverPublicNewsRss(queries: string[], options: {
 signal?:AbortSignal; freshnessDays?:number; fetcher?:typeof fetch; articleRequestBudget:{remaining:number}; now?:number;
}):Promise<GroundingSource[]> {
 options.signal?.throwIfAborted();
 const selected = [...new Set(queries.map(query => query.trim().slice(0,240)).filter(Boolean))].slice(0,Math.min(2,options.articleRequestBudget.remaining));
 const outcomes = await Promise.allSettled(selected.map(async query => {
  const url = new URL('https://www.bing.com/news/search');
  url.search = new URLSearchParams({q:query,format:'rss',setlang:'en-US',mkt:/\bCanada\b/u.test(query)?'en-CA':'en-US'}).toString();
  const xml = await readPublicSearchOriginal(url,{signal:options.signal,timeoutMs:7000,fetcher:options.fetcher,articleRequestBudget:options.articleRequestBudget,responseFormat:'rss'});
  return publicNewsRssCandidates(xml,options);
 }));
 options.signal?.throwIfAborted();
 console.info('[public-news-rss]', JSON.stringify({ requestedFeeds:selected.length, failedFeeds:outcomes.filter(result=>result.status==='rejected').length }));
 const seen = new Set<string>();
 return outcomes.flatMap(result => result.status === 'fulfilled' ? result.value : []).filter(source => !seen.has(source.uri) && !!seen.add(source.uri)).slice(0,16);
}

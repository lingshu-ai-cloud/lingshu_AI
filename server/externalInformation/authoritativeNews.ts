import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { externalText } from './http.js';
import { extractSourceArticle, publicSourceUrl } from './sourceVerification.js';
import { AUTHORITATIVE_NEWS_SOURCES } from '../../shared/authoritativeNewsSources.js';
export { AUTHORITATIVE_NEWS_SOURCES } from '../../shared/authoritativeNewsSources.js';
const itemSchema = z.object({ sourceId: z.string(), publisher: z.string(), kind: z.string(), title: z.string().max(300),
  url: z.string().url(), publishedAt: z.string().nullable(), fetchedAt: z.string(), excerpt: z.string().max(180) });
const snapshotSchema = z.object({ version: z.literal(1), fetchedAt: z.string(), items: z.array(itemSchema).max(60),
  failures: z.array(z.object({ sourceId: z.string(), code: z.string() })) });
type NewsSnapshot = z.infer<typeof snapshotSchema>;
type NewsItem = z.infer<typeof itemSchema>;
type Source = typeof AUTHORITATIVE_NEWS_SOURCES[number];
const directory = () => path.resolve(process.env.ASSISTANT_NEWS_CACHE_DIR || 'data/local-store/authoritative-news');
const clean = (value: string) => extractSourceArticle(value).text;
export function discoverNewsArticles(html: string, source: Source): Array<{ url: string; title: string }> {
  const links = new Map<string, string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([^]*?)<\/a>/giu)) {
    try {
      const url = new URL(match[1].replaceAll('&amp;', '&'), source.index); url.hash = '';
      if (!source.article.test(url.href) || url.search) continue;
      publicSourceUrl(url.href);
      const title = clean(match[2]);
      if (title.length >= 12 && title.length <= 300) links.set(url.href, title);
    } catch { /* Never follow an unapproved or malformed link. */ }
  }
  return [...links].map(([url, title]) => ({ url, title }));
}
export async function readAuthoritativeNews(cacheDir = directory()): Promise<NewsSnapshot | null> {
  try {
    const snapshot = snapshotSchema.parse(JSON.parse(await fs.readFile(path.join(cacheDir, 'latest.json'), 'utf8')));
    snapshot.items = snapshot.items.filter(item => AUTHORITATIVE_NEWS_SOURCES.some(source => source.id === item.sourceId && source.article.test(item.url)));
    return snapshot;
  } catch { return null; }
}
export async function collectAuthoritativeNews(options: { fetcher?: typeof fetch; signal?: AbortSignal; cacheDir?: string; now?: Date } = {}): Promise<NewsSnapshot> {
  const cacheDir = options.cacheDir ?? directory(), now = (options.now ?? new Date()).toISOString();
  const previous = await readAuthoritativeNews(cacheDir), items: NewsItem[] = [], failures: NewsSnapshot['failures'] = [];
  for (const source of AUTHORITATIVE_NEWS_SOURCES) {
    if (options.signal?.aborted) throw options.signal.reason;
    try {
      const html = await externalText(publicSourceUrl(source.index), { ...options, timeoutMs: 8000 });
      const links = discoverNewsArticles(html, source).slice(0, 3);
      if (!links.length) throw Error('news_index_empty');
      for (const link of links) {
        try {
          const body = await externalText(publicSourceUrl(link.url), { ...options, timeoutMs: 8000 });
          const article = extractSourceArticle(body);
          const heading = body.match(/<h1\b[^>]*>([^]*?)<\/h1>/iu)?.[1];
          const title = heading ? clean(heading).slice(0, 300) : link.title;
          if (article.text.length < 100 || !article.text.includes(title) || /access denied|just a moment|verify you are human/iu.test(title)) throw Error('news_article_invalid');
          const description = [...body.matchAll(/<meta\b[^>]*>/giu)].find(([tag]) => /(?:name|property)=["'](?:description|og:description)["']/iu.test(tag))?.[0].match(/content=["']([^"']*)["']/iu)?.[1];
          items.push({ sourceId: source.id, publisher: source.label, kind: source.kind, title, url: link.url,
            publishedAt: article.published.find(date => Date.parse(date) <= Date.parse(now)) ?? null, fetchedAt: now,
            excerpt: description ? clean(description).slice(0, 180) : '' });
        } catch (error) {
          if (options.signal?.aborted) throw options.signal.reason;
          failures.push({ sourceId: source.id, code: error instanceof Error && 'code' in error ? String(error.code) : 'news_article_unavailable' });
        }
      }
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      failures.push({ sourceId: source.id, code: error instanceof Error && 'code' in error ? String(error.code) : 'news_index_unavailable' });
    }
  }
  // A source outage must not erase a previously verified original; its old capture date stays visible.
  const unique = new Map([...(previous?.items ?? []), ...items].map(item => [item.url, item]));
  const snapshot: NewsSnapshot = { version: 1, fetchedAt: now, failures, items: [...unique.values()].sort((a,b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')).slice(0, 60) };
  await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
  const revision = `${now.replaceAll(':', '-')}-${randomUUID()}.json`;
  const data = JSON.stringify(snapshot, null, 2);
  await fs.writeFile(path.join(cacheDir, revision), data, { mode: 0o600 });
  const temporary = path.join(cacheDir, `${revision}.tmp`);
  await fs.writeFile(temporary, data, { mode: 0o600 });
  await fs.rename(temporary, path.join(cacheDir, 'latest.json'));
  return snapshot;
}
export function renderAuthoritativeNews(snapshot: NewsSnapshot, question: string, now = new Date()) {
  const social = question.startsWith('社交媒体资讯'), policy = question.startsWith('政策与平台资讯');
  const beauty = /美妆|化妆品|护肤|防晒|个护|原料|cosmetic|skincare/iu.test(question);
  const meta = /Facebook|Instagram|Meta|平台.*未配置/iu.test(question);
  const us = /美国|全球|北美|\bUSA?\b/iu.test(question);
  const candidates = snapshot.items.filter(item => social ? item.kind === 'social' && meta
    : policy ? (item.kind === 'social' && meta || item.kind === 'policy' && us && beauty)
      : item.kind === 'industry' && beauty || item.kind === 'policy' && us && beauty || item.kind === 'social' && meta);
  const recent = candidates.filter(item => item.publishedAt && Date.parse(item.publishedAt) >= now.getTime() - 7 * 86400000);
  const selected = (recent.length ? recent : candidates).slice(0, 4);
  if (!selected.length) return { text: '当前固定来源中还没有与企业范围匹配的已核验资讯。可查看官方资讯入口；没有用不相关消息或历史资料冒充今日动态。',
    sources: AUTHORITATIVE_NEWS_SOURCES.map(source => ({ title: source.label, uri: source.index })) };
  const status = recent.length ? `已找到 ${selected.length} 条近一周的官方动态。` : `近一周没有匹配的新发布；先列出 ${selected.length} 条可查阅资料，以下不代表今日动态。`;
  const markdown = (value: string) => value.replace(/[\[\]<>`\\]/gu,' ').replace(/[\r\n]/gu,' ');
  const text = `${status}\n\n${selected.map(item => `- **${item.publisher}** · ${item.publishedAt ?? '发布日期未核验'}\n  [${markdown(item.title)}](${item.url})`).join('\n')}\n\n${snapshot.failures.length ? '部分来源本次读取失败，已保留此前核验资料。' : ''}这些是原始资料入口；是否适用于你的产品和目标市场，仍需结合原文判断。\n\n\`\`\`details\n${selected.map(item=>`${item.publisher}：原文核验时间 ${item.fetchedAt}；${item.publishedAt ? '发布日期来自页面字段' : '未取得明确发布日期，不计入近期动态'}。`).join('\n')}\n固定采集栏目：${AUTHORITATIVE_NEWS_SOURCES.map(source=>source.index).join('、')}\n\`\`\``;
  return { text, sources: selected.map(item => ({ title: item.title, uri: item.url })) };
}
let refreshing: Promise<NewsSnapshot> | undefined;
export async function authoritativeNewsAnswer(question: string, signal?: AbortSignal) {
  let snapshot = await readAuthoritativeNews();
  if (!snapshot || Date.now() - Date.parse(snapshot.fetchedAt) > 6 * 3600000) {
    refreshing ??= collectAuthoritativeNews({ signal }).finally(() => { refreshing = undefined; });
    snapshot = await refreshing;
  }
  return renderAuthoritativeNews(snapshot, question);
}

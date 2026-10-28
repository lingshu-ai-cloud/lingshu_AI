import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { externalText } from './http.js';

export { isPublicSearchAddress, publicSearchOriginalUrl } from '../../shared/publicSearchReadPolicy.mjs';
import { isPublicSearchAddress, publicSearchOriginalUrl } from '../../shared/publicSearchReadPolicy.mjs';
import { withAssistantPreviewPublicRead } from '../../scripts/customer-preview-ai-scope.mjs';

type DnsRecord = { address: string; family: 4 | 6 };
const dnsName = (value: string) => value.toLowerCase().replace(/\.$/u, '');

/** Validate the fixed resolver's response before any address becomes a connection target. */
export function parseTrustedDnsAnswer(value: unknown, hostname: string, type: 1 | 28): DnsRecord[] {
  const data = value as { Status?: unknown; TC?: unknown; Question?: Array<{ name?: string; type?: number }>; Answer?: Array<{ name?: string; type?: number; data?: string }> };
  if (!data || data.Status !== 0 || data.TC !== false || data.Question?.length !== 1
    || dnsName(data.Question[0].name ?? '') !== dnsName(hostname) || data.Question[0].type !== type) throw Error('source_dns_response_invalid');
  const answers = data.Answer ?? [];
  if (!Array.isArray(answers) || answers.length > 100) throw Error('source_dns_response_invalid');
  const names = new Set([dnsName(hostname)]);
  for (let depth = 0; depth < 8; depth++) for (const item of answers) {
    if (item.type === 5 && names.has(dnsName(item.name ?? ''))) {
      const target = dnsName(item.data ?? '');
      if (!/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/u.test(target)) throw Error('source_dns_response_invalid');
      names.add(target);
    }
  }
  return answers.flatMap(item => {
    if (item.type !== 1 && item.type !== 28) return [];
    const address = item.data ?? '';
    if (!names.has(dnsName(item.name ?? '')) || isIP(address) !== (item.type === 1 ? 4 : 6) || !isPublicSearchAddress(address)) throw Error('source_dns_not_public');
    return [{ address, family: item.type === 1 ? 4 as const : 6 as const }];
  });
}

/** Fixed TLS hostname and fixed public bootstrap IP, independent of the local synthetic resolver. */
async function queryTrustedDns(hostname: string, type: 1 | 28, signal?: AbortSignal): Promise<unknown> {
  const url = new URL('https://cloudflare-dns.com/dns-query');
  url.searchParams.set('name', hostname); url.searchParams.set('type', String(type));
  return withAssistantPreviewPublicRead({ url: url.href, pinnedAddress: '1.1.1.1', kind: 'dns' }, lookup => new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', signal, agent: false, family: 4, headers: { Accept: 'application/dns-json' }, lookup }, response => {
      if (response.statusCode !== 200 || !/^application\/(?:dns-)?json(?:;|$)/iu.test(String(response.headers['content-type'] ?? ''))) {
        response.destroy(); reject(Error('source_dns_response_invalid')); return;
      }
      let bytes = 0; const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 65536) response.destroy(Error('source_dns_response_invalid')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Error('source_dns_response_invalid')); } });
    });
    req.on('error', reject); req.end();
  }));
}

export async function resolvePublicSearchHost(hostname: string, resolver = lookup, options: {
  signal?: AbortSignal; allowSyntheticDns?: boolean; queryDns?: typeof queryTrustedDns;
} = {}): Promise<DnsRecord> {
  const records = await resolver(hostname, { all: true, verbatim: true });
  const syntheticOnly = records.length > 0 && records.every(item => item.family === 4 && /^198\.(?:18|19)\./u.test(item.address));
  if ((options.allowSyntheticDns ?? process.env.LINGSHU_LOCAL_PREVIEW === '1') && syntheticOnly) {
    const query = options.queryDns ?? queryTrustedDns;
    // Pin a validated IPv4 answer immediately; an unrelated AAAA failure must not discard it.
    const ipv4 = parseTrustedDnsAnswer(await query(hostname, 1, options.signal), hostname, 1);
    const publicRecords = ipv4.length ? ipv4 : parseTrustedDnsAnswer(await query(hostname, 28, options.signal), hostname, 28);
    if (!publicRecords.length) throw Error('source_dns_not_public');
    return publicRecords.find(item => item.family === 4) ?? publicRecords[0];
  }
  if (!records.length || records.some(item => !isPublicSearchAddress(item.address))) throw Error('source_dns_not_public');
  const chosen = records[0];
  return { address: chosen.address, family: chosen.family as 4 | 6 };
}

/** Every redirect is a new public URL and a separately DNS-pinned request. */
export function publicArticleRedirect(from: URL, location: string, visited: Set<string>): URL {
  const target = publicSearchOriginalUrl(new URL(location, from).href);
  if (visited.has(target.href)) throw Error('source_redirect_loop');
  return target;
}
type PageRead = { location?: string; body?: string };
const redirects = new Set([301, 302, 303, 307, 308]);
export async function readPublicSearchOriginal(url: URL, options: { signal?: AbortSignal; timeoutMs?: number; fetcher?: typeof fetch; articleRequestBudget?: { remaining: number }; responseFormat?: 'rss' } = {}): Promise<string> {
  publicSearchOriginalUrl(url.href);
  const rss = options.responseFormat === 'rss';
  if (rss && (url.hostname !== 'www.bing.com' || url.pathname !== '/news/search' || url.searchParams.get('format') !== 'rss'
    || !url.searchParams.get('q') || url.searchParams.get('q')!.length > 240 || [...url.searchParams.keys()].some(key => !['q', 'format', 'setlang', 'mkt'].includes(key)))) throw Error('source_rss_endpoint_invalid');
  const contentTypeAllowed = (value: string) => (rss ? /^(?:application\/(?:rss\+xml|xml)|text\/xml)(?:;|$)/iu : /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/iu).test(value);
  const accept = rss ? 'application/rss+xml,application/xml,text/xml' : 'text/html,application/xhtml+xml';
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 18000);
  const budget = options.articleRequestBudget ?? { remaining: 3 };
  try {
    const cancelled = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(Error('source_timeout')), { once: true }));
    const visited = new Set<string>(); let current = url;
    for (let hop = 0; hop <= 2; hop++) {
      if (controller.signal.aborted) throw Error('source_timeout');
      if (budget.remaining <= 0) throw Error('source_read_budget_exhausted');
      budget.remaining--; visited.add(current.href);
      let page: PageRead;
      if (options.fetcher) {
        // Test transport uses the same redirect policy, with no automatic following.
        const response = await Promise.race([options.fetcher(current, { redirect: 'manual', signal: controller.signal }), cancelled]);
        if (redirects.has(response.status)) {
          page = { location: response.headers.get('location') ?? '' }; await response.body?.cancel();
        } else {
          if (response.status !== 200 || !contentTypeAllowed(response.headers.get('content-type') ?? '')) { await response.body?.cancel(); throw Error(`source_http_${response.status}`); }
          page = { body: await externalText(current, { signal: controller.signal, fetcher: async () => response }) };
        }
      } else {
        const target = await Promise.race([resolvePublicSearchHost(current.hostname, lookup, { signal: controller.signal }), cancelled]);
        if (controller.signal.aborted) throw Error('source_timeout');
        page = await Promise.race([withAssistantPreviewPublicRead({ url: current.href, pinnedAddress: target.address, kind: 'article' }, lookup => new Promise<PageRead>((resolve, reject) => {
          const req = request(current, { method: 'GET', signal: controller.signal, family: target.family, agent: false, headers: { Accept: accept }, lookup }, response => {
            if (redirects.has(response.statusCode ?? 0)) { const location = response.headers.location ?? ''; response.resume(); resolve({ location }); return; }
            if (response.statusCode !== 200 || !contentTypeAllowed(String(response.headers['content-type'] ?? ''))) {
              response.resume(); reject(Error(`source_http_${response.statusCode ?? 0}`)); return;
            }
            const chunks: Buffer[] = []; let size = 0;
            response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 2_000_000) response.destroy(Error('source_too_large')); else chunks.push(chunk); });
            response.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }));
            response.on('error', reject);
          });
          req.on('error', reject); req.end();
        })), cancelled]);
      }
      if (page.body !== undefined) return page.body;
      if (rss) throw Error('source_rss_redirect_forbidden');
      if (!page.location || hop === 2) throw Error('source_redirect_limit');
      current = publicArticleRedirect(current, page.location, visited);
    }
    throw Error('source_redirect_limit');
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}

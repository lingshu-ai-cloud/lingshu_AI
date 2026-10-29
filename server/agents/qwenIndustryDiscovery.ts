import { isAffiliateShoppingGuide, isConsumerCouponPromotion } from '../externalInformation/industrySourceQuality.js';
import type { GroundingSource } from './llm.js';
import { readSearchOriginals, type SearchOriginal } from '../externalInformation/searchEvidenceAnswer.js';

type ReadResult = Awaited<ReturnType<typeof readSearchOriginals>>;
const compact = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const sourceKey = (source: GroundingSource) => { try { const url = new URL(source.uri); url.hash = ''; return url.href; } catch { return ''; } };
const hostname = (uri: string) => { try { return new URL(uri).hostname.replace(/^www\./u, ''); } catch { return ''; } };
export function uniqueIndustryOriginals(originals: SearchOriginal[]): SearchOriginal[] {
  const urls = new Set<string>(), titles = new Set<string>(), bodies = new Set<string>();
  return originals.filter(original => {
    if (isConsumerCouponPromotion(original.source.title) || isAffiliateShoppingGuide(original.source.title, original.text)) return false;
    const url = sourceKey(original.source), title = compact(original.source.title);
    const fullBody = compact(original.text), body = fullBody.replace(title, '');
    if (urls.has(url) || titles.has(title) || bodies.has(fullBody) || bodies.has(body)) return false;
    urls.add(url); titles.add(title); bodies.add(fullBody); bodies.add(body); return true;
  });
}
/** At most two discovery rounds, twenty-four original reads and one downstream synthesis. */
export async function collectIndustryOriginals(initial: GroundingSource[], options: {
  discover: (instruction: string, articleRequestBudget: { remaining: number }) => Promise<GroundingSource[]>;
  read?: typeof readSearchOriginals; signal?: AbortSignal; freshnessDays?: number; publicationDay?:string; rollingCutoff?:string; fetcher?: typeof fetch;
  shouldSupplement?: (originals: SearchOriginal[]) => boolean;
}): Promise<ReadResult & { discovery: { attemptedReads: number; reason: 'sufficient' | 'cache-unchanged' | 'few-originals' | 'few-publishers' | 'request-budget'; supplemented: boolean; supplementFailed: boolean } }> {
  const read = options.read ?? readSearchOriginals;
  const articleRequestBudget = { remaining: 24 };
  const attempted = new Set<string>();
  const candidates = (values: GroundingSource[], max: number) => {
    if (max <= 0) return [];
    const result: GroundingSource[] = [], diverse: GroundingSource[] = [], remainder: GroundingSource[] = [];
    const firstByHost = new Set<string>();
    for (const source of values) { if (isConsumerCouponPromotion(source.title)) continue; const host = hostname(source.uri); if (firstByHost.has(host)) remainder.push(source); else { firstByHost.add(host); diverse.push(source); } }
    for (const source of [...diverse, ...remainder]) {
      const key = sourceKey(source); if (!key || attempted.has(key)) continue;
      attempted.add(key); result.push(source); if (result.length >= max) break;
    }
    return result;
  };
  const finish = async (result: ReadResult, discovery: { attemptedReads: number; reason: 'sufficient' | 'cache-unchanged' | 'few-originals' | 'few-publishers' | 'request-budget'; supplemented: boolean; supplementFailed: boolean }) => {
    const hosts = new Set(result.originals.map(original => hostname(original.source.uri)));
    if (hosts.size >= 2 || discovery.reason === 'cache-unchanged') return { ...result, discovery };
    const allowance = Math.min(8, 24 - discovery.attemptedReads, articleRequestBudget.remaining);
    if (allowance <= 0) return { ...result, discovery };
    const linked = candidates(result.originals.flatMap(original => original.relatedSources ?? []), allowance);
    if (!linked.length) return { ...result, discovery };
    discovery.attemptedReads += linked.length;
    try {
      const next = await read(linked, { signal: options.signal, freshnessDays: options.freshnessDays, publicationDay:options.publicationDay, rollingCutoff:options.rollingCutoff, maxCandidates: linked.length, publicWeb: true, articleRequestBudget, fetcher: options.fetcher });
      options.signal?.throwIfAborted();
      const rejectionReasons = { ...result.rejectionReasons };
      for (const [reason, count] of Object.entries(next.rejectionReasons)) rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + count;
      return { originals: uniqueIndustryOriginals([...result.originals, ...next.originals.map((original, index) => ({ ...original, id: `S${49 + index}` }))]), rejected: result.rejected + next.rejected, rejectionReasons, discovery };
    } catch {
      options.signal?.throwIfAborted();
      return { ...result, discovery };
    }
  };
  options.signal?.throwIfAborted();
  const firstCandidates = candidates(initial, 12);
  const first = firstCandidates.length ? await read(firstCandidates, { signal: options.signal, freshnessDays: options.freshnessDays, publicationDay:options.publicationDay, rollingCutoff:options.rollingCutoff, maxCandidates: 12, publicWeb: true, articleRequestBudget, fetcher: options.fetcher }) : { originals: [], rejected: 0, rejectionReasons: {} };
  options.signal?.throwIfAborted();
  const originals = uniqueIndustryOriginals(first.originals);
  const hosts = new Set(originals.map(original => hostname(original.source.uri)));
  const sufficient = originals.length >= 3 && hosts.size >= 2;
  const cacheUnchanged = !sufficient && options.shouldSupplement?.(originals) === false;
  const exhausted = articleRequestBudget.remaining <= 0;
  const discovery = { attemptedReads: firstCandidates.length, reason: exhausted ? 'request-budget' as const : sufficient ? 'sufficient' as const : cacheUnchanged ? 'cache-unchanged' as const : originals.length < 3 ? 'few-originals' as const : 'few-publishers' as const, supplemented: false, supplementFailed: false };
  if (sufficient || cacheUnchanged || exhausted) return { ...first, originals, discovery };
  const succeeded = new Set(first.originals.map(original => sourceKey(original.source)));
  const failedHosts = [...new Set(firstCandidates.filter(source => !succeeded.has(sourceKey(source))).map(source => hostname(source.uri)))].filter(Boolean);
  const coverage = originals.map(original => original.source.title + ' ' + original.text).join(' ');
  const missingTopics = ([
    ['监管与行业标准', /监管|法规|标准|regulat|compliance|standard/iu],
    ['市场与竞争动作', /市场|竞争|渠道|market|competit|retail/iu],
    ['技术与研究', /研究|技术|配方|research|technolog|formulat/iu],
    ['供应链与生产', /供应链|工厂|产能|生产|supply.chain|manufactur|capacity/iu],
  ] as const).filter(([, pattern]) => !pattern.test(coverage)).map(([label]) => label);
  try {
    discovery.supplemented = true;
    const additional = await options.discover(`这是同一次行业研究的唯一一轮补充检索，不是重试答案。首轮有${originals.length}篇可读取合格原文、${hosts.size}个发布方。需补充的议题：${missingTopics.join('、') || '已有主题的独立发布方及关联经营证据'}；优先行业新闻、行业媒体、协会、研究机构的可直接访问文章，排除文库、论文下载平台、报告售卖目录、需登录下载的资料库以及只有摘要的转载，不返回人人文库、原创力文档等下载结果；这些不可读链接不能作为已完成检索的依据。优先检索带具体近期发布日期的市场事件/技术发布/企业合作报道；只补用户行业、地区、期间直接相关且首轮未覆盖的实质原文，不为凑类别增加无关资料。以中文与目标市场常用语言检索。首轮不可读取或日期不合格的域名：${failedHosts.join('、') || '无'}，优先寻找其他可读发布方；已成功域名：${[...hosts].join('、') || '无'}。商业研究、公开评论和AI整理内容可作为专题观察资料，保留来源归属及原始口径。不得仅返回首页、聚合页或重复营销稿；不同站点转载同稿不算独立证据。返回至多十二条新原文候选。`, articleRequestBudget);
    options.signal?.throwIfAborted();
    const next = candidates([...additional, ...initial], Math.min(12, articleRequestBudget.remaining));
    discovery.attemptedReads += next.length;
    if (!next.length) return finish({ ...first, originals }, discovery);
    const second = await read(next, { signal: options.signal, freshnessDays: options.freshnessDays, publicationDay:options.publicationDay, rollingCutoff:options.rollingCutoff, maxCandidates: 12, publicWeb: true, articleRequestBudget, fetcher: options.fetcher });
    options.signal?.throwIfAborted();
    const mergedReasons = { ...first.rejectionReasons };
    for (const [reason, count] of Object.entries(second.rejectionReasons)) mergedReasons[reason] = (mergedReasons[reason] ?? 0) + count;
    // Reader IDs are local to each batch; allocate disjoint IDs before downstream citation synthesis.
    return finish({ originals: uniqueIndustryOriginals([...originals, ...second.originals.map((original, index) => ({ ...original, id: `S${25 + index}` }))]), rejected: first.rejected + second.rejected, rejectionReasons: mergedReasons }, discovery);
  } catch {
    options.signal?.throwIfAborted();
    discovery.supplementFailed = true;
    // Supplemental discovery/read failures must never discard the original verified evidence.
    return finish({ ...first, originals }, discovery);
  }
}

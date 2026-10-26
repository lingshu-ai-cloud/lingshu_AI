import { newsSourceCacheKey, recallNewsSources, rememberNewsSources, sameNewsOriginals } from '../externalInformation/newsSourceCache.js';
import { discoverPublisherNews } from '../externalInformation/publisherNewsDiscovery.js';
import { readSearchOriginals, composeSearchEvidenceAnswer } from '../externalInformation/searchEvidenceAnswer.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChatMessage, GroundingSource, LLMCallOptions } from './llm.js';
import { dashscopeApiKey } from './qwenClient.js';
import { qwenCompatibleBaseUrl } from '../lib/qwenCompatibleEndpoint.js';
import { externalJson, ExternalInformationError, object } from '../externalInformation/http.js';
import { exactQwenScope } from './exactQwenScope.js';
import { verifySearchAnswer } from '../externalInformation/sourceVerification.js';

function nativeEndpoint(): URL {
  const configured = process.env.QWEN_SEARCH_ENDPOINT?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new ExternalInformationError('qwen_search_endpoint_invalid', '联网来源接口配置无效，请联系管理员。');
    }
    return url;
  }
  const compatible = new URL(qwenCompatibleBaseUrl());
  // Do not silently send the current MaaS key to a different provider/region.
  if (compatible.protocol === 'https:' && (compatible.hostname === 'maas.qianwenaiapi.com' || compatible.hostname === 'dashscope.aliyuncs.com'
    || compatible.hostname.endsWith('.maas.aliyuncs.com'))) {
    return new URL('/api/v1/services/aigc/text-generation/generation', compatible.origin);
  }
  throw new ExternalInformationError('qwen_search_not_configured', '联网来源能力尚未配置完成，本次不提供未经核验的资讯结论。');
}

export function validatedSearchSources(values: unknown, domains: readonly string[] = []): GroundingSource[] {
  if (!Array.isArray(values)) return [];
  const result: GroundingSource[] = [];
  for (const value of values) {
    const source = object(value);
    try {
      const url = new URL(String(source.url ?? source.uri ?? ''));
      if (url.href.length > 900 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || !url.hostname.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/u.test(url.hostname)) throw new Error();
      if (domains.length && !domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
        throw new ExternalInformationError('search_source_scope_mismatch', '本轮未取得符合来源要求的公开资料，暂不下结论。');
      }
      // Provider index is authoritative; array position and model-written URLs are not.
      if (source.index !== undefined && (!Number.isSafeInteger(source.index) || Number(source.index) < 1)) throw new Error();
      result.push({ title: String(source.title || url.hostname).slice(0, 240), uri: url.href,
        ...(source.index !== undefined ? { citationIndex: Number(source.index) } : {}) });
    } catch (error) {
      if (error instanceof ExternalInformationError) throw error;
      throw new ExternalInformationError('search_source_invalid', '检索返回的来源链接无效，本次未采用。');
    }
  }
  if (result.length > 40) throw new ExternalInformationError('search_sources_over_limit', '本次检索来源超出支持范围，请缩小查询条件。');
  return result;
}

/** Same Qwen model/key, native API only where source metadata is actually supported.
 * One search; news scenes add one closed-book synthesis after original-page reads. No paid retry. */
export async function qwenSearchAnswer(messages: ChatMessage[], opts: LLMCallOptions): Promise<{ text: string; sources: GroundingSource[] }> {
  if (exactQwenScope()) throw new ExternalInformationError('qwen_search_execution_scope_forbidden', '当前受约束执行任务不支持额外联网请求，请回到普通对话查询。');
  const cacheKey = newsSourceCacheKey(nativeEndpoint().href, messages.at(-1)?.content ?? '', opts);
  const cached = opts.searchEvidenceFirst ? recallNewsSources(cacheKey) : undefined;
  let sources = cached?.answer.sources;
  let text: unknown;
  let directoryDiscovery = false;
  if (!sources && opts.searchEvidenceFirst) {
    const discovered = await discoverPublisherNews(messages.at(-1)?.content ?? '', { domains: opts.searchDomains, signal: opts.signal });
    if (discovered.length) { sources = discovered; directoryDiscovery = true; }
  }
  if (!sources) {
    const response = object(await externalJson(nativeEndpoint(), {
      signal: opts.signal, timeoutMs: opts.timeoutMs ?? 60_000,
      init: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dashscopeApiKey()}` },
        body: JSON.stringify({ model: opts.model ?? process.env.QWEN_TEXT_MODEL ?? 'qwen-plus',
          input: { messages: opts.searchEvidenceFirst ? [{ role: 'system', content: `查询时间：${new Date().toISOString()}（服务器UTC时间）。检索直接相关的至多6篇原始发布，必须调用联网搜索并返回来源元数据。只找资料，不撰写经营结论。不得用首页、栏目页、聚合页、无关宏观新闻凑数。尊重用户的地区、行业和期间；指定近期时只找有明确发布日期的近期原文。` }, { role: 'user', content: messages.at(-1)?.content ?? '' }] : [...(opts.systemPrompt ? [{ role: 'system', content: opts.systemPrompt }] : []), ...messages] },
          parameters: { result_format: 'message', max_tokens: opts.deepThinking ? 8192 : 4096, enable_search: true,
            search_options: { forced_search: true, search_strategy: 'turbo', enable_source: true,
              enable_citation: true, ...(opts.searchFreshnessDays ? { freshness: opts.searchFreshnessDays } : {}),
              ...(opts.searchDomains?.length ? { assigned_site_list: opts.searchDomains } : {}) } } }),
      },
    }));
    if (response.code) throw new ExternalInformationError('qwen_search_provider_error', '联网检索服务未完成请求，请稍后再查。');
    const output = object(response.output), choices = Array.isArray(output.choices) ? output.choices : [];
    const choice = object(choices[0]); text = object(choice.message).content;
    sources = validatedSearchSources(object(output.search_info).search_results, opts.searchDomains);
    if (choice.finish_reason !== 'stop' || typeof text !== 'string' || !text.trim()) {
      throw new ExternalInformationError('qwen_search_incomplete', '联网回答未完整生成，本次未作为核验结果。');
    }
    if (process.env.LINGSHU_LOCAL_PREVIEW === '1' && process.env.NODE_ENV === 'development') {
      const directory = path.resolve('data/local-store/search-candidates');
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, `${Date.now()}-${randomUUID()}.json`), JSON.stringify({ text, sources, fetchedAt: new Date().toISOString() }));
    }
    if (!sources.length) throw new ExternalInformationError('search_sources_missing', '总体结论：本轮没有取得可核验来源，暂不提供外部资讯判断。\n\n信息来源：检索服务未返回有效来源。');
  }
  if (opts.searchEvidenceFirst) {
    const { originals, rejected } = await readSearchOriginals(sources, { signal: opts.signal, freshnessDays: opts.searchFreshnessDays });
    if (cached && sameNewsOriginals(cached, originals)) {
      const reused = cached.answer.text.replace('本轮核验 ', '首次整理时核验 ').replace('本轮从巴斯夫官方新闻目录', '首次整理从巴斯夫官方新闻目录');
      return { ...cached.answer, text: reused + '\n\n本轮复用十分钟内同一查询的已核验解读，并已重新读取全部引用原文，正文及发布日期未变化；未重新发现其他候选，不代表新增动态。' };
    }
    const answer = await composeSearchEvidenceAnswer(messages.at(-1)?.content ?? '', originals, async prompt => {
      const payload = object(await externalJson(nativeEndpoint(), {
        signal: opts.signal, timeoutMs: 35000,
        init: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dashscopeApiKey()}` },
          body: JSON.stringify({ model: opts.model ?? process.env.QWEN_TEXT_MODEL ?? 'qwen-plus',
            input: { messages: [{ role: 'system', content: '你只依据给定原文输出严格JSON。事实与推断分开，保留适用范围与豁免。meaning、action和conclusion不重复数字、年份或角标。' }, { role: 'user', content: prompt }] },
            parameters: { result_format: 'message', max_tokens: 3000, enable_search: false, response_format: { type: 'json_object' } } }),
        },
      }));
      const choices = object(payload.output).choices;
      const choice = object(Array.isArray(choices) ? choices[0] : undefined), content = object(choice.message).content;
      if (payload.code || choice.finish_reason !== 'stop' || typeof content !== 'string') throw new ExternalInformationError('search_analysis_incomplete', '原文已读取，但解读未完整生成，本次未作为正式结论。');
      if (process.env.LINGSHU_LOCAL_PREVIEW === '1' && process.env.NODE_ENV === 'development') {
        const directory = path.resolve('data/local-store/search-candidates');
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, `${Date.now()}-analysis-${randomUUID()}.json`), JSON.stringify({ raw: content, originals, rejected }));
      }
      return content;
    }, { rejected, freshnessDays: opts.searchFreshnessDays });
    if (process.env.LINGSHU_LOCAL_PREVIEW === '1' && process.env.NODE_ENV === 'development') {
      const directory = path.resolve('data/local-store/search-candidates');
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, `${Date.now()}-verified-${randomUUID()}.json`), JSON.stringify({ answer, rejected, originals, fetchedAt: new Date().toISOString() }));
    }
    if (directoryDiscovery) answer.text += '\n\n来源范围：本轮从巴斯夫官方新闻目录发现候选并逐篇读取核验，未执行全网搜索，不代表全部官方渠道或全行业动态。';
    if (answer.sources.length) rememberNewsSources(cacheKey, answer, originals);
    return answer;
  }
  const verified = await verifySearchAnswer(String(text), sources!, { signal: opts.signal, freshnessDays: opts.searchFreshnessDays });
  return { text: String(text), sources: verified };
}

/** Guard explicit dates in recent-news replies; do not rebrand an old release as current. */
export function assertRecentSearchAnswer(text: string, days?: number, now = Date.now()): void {
  if (!days) return;
  const dates = [...text.matchAll(/(20\d{2})\s*(?:年|[-/])\s*(\d{1,2})\s*(?:月|[-/])\s*(\d{1,2})\s*日?/gu)];
  if (!dates.length || dates.some(match => {
    const date = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const value = new Date(date);
    return value.getUTCMonth() !== Number(match[2]) - 1 || value.getUTCDate() !== Number(match[3])
      || date < now - days * 86_400_000 || date > now + 86_400_000;
  })) throw new ExternalInformationError('search_recent_sources_missing', '本轮没有取得符合最近30天范围、带明确发布日期的可靠资讯，暂不把旧材料当作最新动态。可改为查询指定时间段的历史资料。');
}

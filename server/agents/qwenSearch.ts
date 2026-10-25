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
  if (compatible.protocol === 'https:' && (compatible.hostname === 'dashscope.aliyuncs.com'
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
 * One bounded call, no paid retry, no ungrounded continuation. */
export async function qwenSearchAnswer(messages: ChatMessage[], opts: LLMCallOptions): Promise<{ text: string; sources: GroundingSource[] }> {
  if (exactQwenScope()) throw new ExternalInformationError('qwen_search_execution_scope_forbidden', '当前受约束执行任务不支持额外联网请求，请回到普通对话查询。');
  const response = object(await externalJson(nativeEndpoint(), {
    signal: opts.signal, timeoutMs: opts.timeoutMs ?? 60_000,
    init: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dashscopeApiKey()}` },
      body: JSON.stringify({ model: opts.model ?? process.env.QWEN_TEXT_MODEL ?? 'qwen-plus',
        input: { messages: [...(opts.systemPrompt ? [{ role: 'system', content: opts.systemPrompt }] : []), ...messages] },
        parameters: { result_format: 'message', max_tokens: opts.deepThinking ? 8192 : 4096, enable_search: true,
          search_options: { forced_search: true, search_strategy: 'turbo', enable_source: true,
            enable_citation: true, ...(opts.searchFreshnessDays ? { freshness: opts.searchFreshnessDays } : {}),
            ...(opts.searchDomains?.length ? { assigned_site_list: opts.searchDomains } : {}) } } }),
    },
  }));
  if (response.code) throw new ExternalInformationError('qwen_search_provider_error', '联网检索服务未完成请求，请稍后再查。');
  const output = object(response.output), choices = Array.isArray(output.choices) ? output.choices : [];
  const choice = object(choices[0]), text = object(choice.message).content;
  const sources = validatedSearchSources(object(output.search_info).search_results, opts.searchDomains);
  if (choice.finish_reason !== 'stop' || typeof text !== 'string' || !text.trim()) {
    throw new ExternalInformationError('qwen_search_incomplete', '联网回答未完整生成，本次未作为核验结果。');
  }
  if (!sources.length) throw new ExternalInformationError('search_sources_missing', '总体结论：本轮没有取得可核验来源，暂不提供外部资讯判断。\n\n信息来源：检索服务未返回有效来源。');
  const verified = await verifySearchAnswer(text, sources, { signal: opts.signal, freshnessDays: opts.searchFreshnessDays });
  return { text, sources: verified };
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

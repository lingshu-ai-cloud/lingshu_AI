import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parse } from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { readExchangeRates, EXCHANGE_RATE_SOURCE } from '../server/externalInformation/exchangeRates.js';
import { assessPolicyCandidate, parseDiscoveryFeed } from '../server/externalInformation/sourceProbe.js';
import { decimalToMoney, parseExactDecimal } from '../server/quotation/fixedDecimal.js';

// Standalone read-only supplier probe. Does not start workers or load business databases.
const root = process.cwd();
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(root, 'artifacts/external-information', runId);
await fs.mkdir(output, { recursive: true, mode: 0o700 });
type Result = { id: string; name: string; status: 'ready' | 'limited' | 'blocked';
  verification: 'payload_validated' | 'discovery_only' | 'not_verified';
  fetchedAt: string; durationMs: number; sourceUrl: string; data?: unknown; limitations: string[];
  errorCode?: string; rawFile?: string; sha256?: string };
const results: Result[] = [];
const safeError = (error: unknown) => {
  const e = error as { code?: string; status?: number; cause?: { code?: string }; name?: string };
  // Never save SDK error messages/request URLs; they can contain credentials.
  return e.cause?.code || e.code || (e.status ? `http_${e.status}` : e.name || 'unknown_error');
};
async function saveRaw(name: string, body: string) {
  const rawFile = `${name}.txt`;
  await fs.writeFile(path.join(output, rawFile), body, { mode: 0o600 });
  return { rawFile, sha256: createHash('sha256').update(body).digest('hex') };
}
async function probe(id: string, name: string, sourceUrl: string, run: () => Promise<Partial<Result>>) {
  const started = Date.now();
  let result: Result;
  try {
    result = { id, name, sourceUrl, status: 'limited', verification: 'not_verified',
      fetchedAt: new Date().toISOString(), durationMs: 0, limitations: [], ...await run() };
  } catch (error) {
    result = { id, name, sourceUrl, status: 'blocked', verification: 'not_verified',
      fetchedAt: new Date().toISOString(), durationMs: 0,
      errorCode: safeError(error), limitations: ['本轮未取得合格数据，不用于业务结论。'] };
  }
  result.durationMs = Date.now() - started;
  results.push(result);
  await fs.writeFile(path.join(output, `${id}.json`), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ id, status: result.status, errorCode: result.errorCode, durationMs: result.durationMs }));
}
async function text(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!r.ok) throw Object.assign(Error(), { code: `http_${r.status}` });
  const body = await r.text();
  if (body.length > 2_000_000) throw Object.assign(Error(), { code: 'response_too_large' });
  return body;
}
const newsUrl = 'https://news.google.com/rss/search?q=cosmetics%20Vietnam%20when%3A7d&hl=en&gl=US&ceid=US:en';
const trendsUrl = 'https://trends.google.com/trending/rss?geo=VN';
await Promise.all([
  probe('exchange', '每日参考汇率', 'https://open.er-api.com/v6/latest/USD', async () => {
    const snapshot = await readExchangeRates('USD');
    const rate = snapshot.rates.CNY;
    if (!rate) throw Object.assign(Error(), { code: 'CNY_missing' });
    const conversion = decimalToMoney(parseExactDecimal('10000'), 'CNY', parseExactDecimal(rate));
    const data = { snapshot, conversion: { amount: '10000', base: 'USD', quote: 'CNY', result: conversion.decimal } };
    return { status: 'ready', verification: 'payload_validated', data, ...await saveRaw('exchange-normalized', JSON.stringify(snapshot, null, 2)),
      limitations: ['每日参考汇率，不是银行成交价。', '仅验证本次快照有效性；不代表长期可用性 SLA。'], sourceUrl: EXCHANGE_RATE_SOURCE.uri };
  }),
  probe('news', 'Google News · 越南美妆近7天', newsUrl, async () => {
    const raw = await text(newsUrl);
    const feed = parseDiscoveryFeed(raw, 'news', Date.now());
    return { status: 'limited', verification: 'discovery_only', ...await saveRaw('news-rss', raw),
      data: { total: feed.total, valid: feed.items.length, rejected: feed.rejected,
        matched: feed.items.filter(item => item.relevance === 'matched').length,
        items: [...feed.items.filter(item => item.relevance === 'matched'), ...feed.items.filter(item => item.relevance !== 'matched')].slice(0, 5) },
      limitations: ['只取得聚合标题与日期；尚未核验原文正文。', '查询命中不等于与企业相关，不据此推导市场增长。'] };
  }),
  probe('trends', 'Google Trends · 越南热搜 RSS', trendsUrl, async () => {
    const raw = await text(trendsUrl);
    const feed = parseDiscoveryFeed(raw, 'trends', Date.now());
    return { status: 'limited', verification: 'discovery_only', ...await saveRaw('trends-rss', raw),
      data: { total: feed.total, valid: feed.items.length, rejected: feed.rejected,
        matched: feed.items.filter(item => item.relevance === 'matched').length, items: feed.items.slice(0, 5) },
      limitations: ['此为地区热搜榜，非 sunscreen 等指定产品关键词的历史兴趣曲线。', '未接通官方 Trends Alpha API；不能计算产品热度增长或销量。'] };
  }),
  probe('customs', '海关总署官网连通性', 'https://www.customs.gov.cn/', async () => {
    const raw = await text('https://www.customs.gov.cn/');
    return { ...await saveRaw('customs-home', raw), status: 'limited', verification: 'not_verified',
      limitations: ['主页可访问仍不等于统计数据获取成功；尚未取得 HS、国家、月份的结构化记录。'] };
  }),
]);

// One explicit Gemini+Google Search request only. Reads credential values without logging them.
let key = process.env.GEMINI_API_KEY || '';
for (const file of [path.join(os.homedir(), '.config/lingshu-ai/.env'), path.join(os.homedir(), '.config/lingshu-ai/.env.local'), path.join(root, '.env.local')]) {
  try { const vars = parse(await fs.readFile(file)); if (vars.GEMINI_API_KEY) key = vars.GEMINI_API_KEY; } catch { /* optional file */ }
}
await probe('google-search', 'Gemini + Google Search', 'https://ai.google.dev/gemini-api/docs/google-search', async () => {
  if (!process.argv.includes('--google-search')) throw Object.assign(Error(), { code: 'explicit_google_search_opt_in_required' });
  if (!key) throw Object.assign(Error(), { code: 'credential_missing' });
  const ai = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 45000, retryOptions: { attempts: 1 } } });
  const response = await ai.models.generateContent({ model: 'gemini-2.5-flash',
    contents: '请检索一条2026年9月至10月越南化妆品或防晒产品的官方政策公告。优先越南主管机构。只提供公告标题、发布机构、明确发布日期、原文链接和一行摘要；找不到则明确说未取得。不要编造，不要把其他国家资料当成越南资料。',
    config: { tools: [{ googleSearch: {} }], maxOutputTokens: 1200, thinkingConfig: { thinkingBudget: 0 } } });
  const candidate = response.candidates?.[0];
  const sources = candidate?.groundingMetadata?.groundingChunks?.flatMap(chunk => chunk.web?.uri
    ? [{ title: chunk.web.title || '', url: chunk.web.uri }] : []) ?? [];
  // Return generated text as a candidate only; never claim original verification from grounding alone.
  const rejectionReasons = assessPolicyCandidate(response.text || '', sources);
  const data = { text: response.text || '', sources, rejectionReasons, eligibleForConclusion: false, finishReason: candidate?.finishReason,
    usage: response.usageMetadata, responseId: response.responseId };
  return { status: rejectionReasons.length ? 'blocked' : 'limited', verification: 'discovery_only', data,
    ...(rejectionReasons.length ? { errorCode: 'candidate_quality_rejected' } : {}),
    ...await saveRaw('google-search-candidate', JSON.stringify(data, null, 2)),
    limitations: ['供应商检索和生成候选，尚未逐条获取原文核验，不计入已确认事实。'] };
});
const report = { schemaVersion: 1, runId, generatedAt: new Date().toISOString(),
  timezone: 'Asia/Shanghai', scope: { industry: '美妆 / 防晒', market: '越南', newsDays: 7,
    note: '公开示例条件，不读取或发送企业私有资料。' },
  git: { branch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) },
  results };
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ reportPath: path.join(output, 'report.json') }));

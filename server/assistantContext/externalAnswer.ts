import type { GroundingSource } from '../agents/llm.js';
import { readExchangeRates, EXCHANGE_RATE_SOURCE } from '../externalInformation/exchangeRates.js';
import { readComtrade, COMTRADE_SOURCE, type TradeQuery } from '../externalInformation/comtrade.js';
import { decimalToMoney, parseExactDecimal } from '../quotation/fixedDecimal.js';
import { planExternalQuestion } from './externalQuestion.js';

export interface ExternalAnswer { text: string; sources: GroundingSource[]; status: 'ready' | 'needs_input' }
const currencies = [
  ['USD', '美元|美金|USD'], ['CNY', '人民币|RMB|CNY'], ['EUR', '欧元|EUR'], ['GBP', '英镑|GBP'],
  ['JPY', '日元|JPY'], ['HKD', '港币|港元|HKD'], ['AED', '迪拉姆|AED'], ['SAR', '沙特里亚尔|SAR'],
  ['AUD', '澳元|AUD'], ['CAD', '加元|CAD'], ['SGD', '新加坡元|新币|SGD'],
];
// Explicit names only. Codes follow UN Comtrade reporter/partner reference codes (India=699, US=842).
const countries: Array<[string, number]> = [['中国', 156], ['美国', 842], ['英国', 826], ['德国', 276], ['法国', 251],
  ['印度', 699], ['日本', 392], ['韩国', 410], ['越南', 704], ['沙特', 682], ['阿联酋', 784], ['澳大利亚', 36], ['加拿大', 124], ['巴西', 76]];

export function parseExchangeQuestion(question: string): { base: string; quote: string; amount?: string } | null {
  const found = currencies.flatMap(([code, aliases]) => {
    return [...question.matchAll(new RegExp(aliases, 'giu'))].map(match => ({ code, index: match.index!, token: match[0] }));
  }).sort((a, b) => a.index - b.index);
  // Unknown codes must not be silently replaced by a familiar currency.
  if (found.length !== 2 || /\b(?!USD\b|CNY\b|RMB\b|EUR\b|GBP\b|JPY\b|HKD\b|AED\b|SAR\b|AUD\b|CAD\b|SGD\b)[A-Z]{3}\b/u.test(question)) return null;
  const before = question.slice(0, found[0].index);
  const amount = before.match(/(?:^|[^\d.,-])(\d{1,12}(?:\.\d{1,6})?)\s*$/)?.[1];
  if (/[\d.,-]\s*$/.test(before) && !amount) return null;
  return { base: found[0].code, quote: found[1].code, ...(amount ? { amount } : {}) };
}

export function parseTradeQuestion(question: string, now = new Date()): TradeQuery | null {
  const years = [...new Set([...question.matchAll(/\b(20\d{2})\b/gu)].map(match => Number(match[1])))];
  const hs = question.match(/HS\s*(?:编码|代码|code)?\s*[:：]?\s*(\d{2}(?:\d{2}){0,2})(?!\d)/iu)?.[1];
  const names = countries.flatMap(([name, code]) => {
    const match = new RegExp(name === '中国' ? '中国(?!香港|澳门|台湾)' : name === '印度' ? '印度(?!尼西亚)' : name, 'u').exec(question);
    return !match ? [] : [{ code, index: match.index }];
  }).sort((a, b) => a.index - b.index);
  const flow = /出口/u.test(question) && !/进口/u.test(question) ? 'X' : /进口/u.test(question) && !/出口/u.test(question) ? 'M' : null;
  if (years.length !== 1 || years[0] > now.getUTCFullYear() || !flow || !names.length || names.length > 2
    || /\d\s*月|月度|季度|同比|环比|增长率|增长|比较|对比|\d{4}\s*[-—~至到]\s*\d{4}/u.test(question)) return null;
  // Do not turn an unrecognized partner into World, or a reversed sentence into the wrong reporter.
  if (/(?:向|对|从)\s*$/u.test(question.slice(0, names[0].index))
    || (names.length === 1 && /(?:对|向|从)\s*[^\s，。]{1,15}(?:出口|进口)/u.test(question))
    || (names.length === 2 && /和|与|以及|、/u.test(question.slice(names[0].index, names[1].index)))) return null;
  if (!hs && !/总额|总出口|总进口|全部商品/u.test(question)) return null;
  // This is a deliberately bounded grammar, not country-name guessing. Residual words may
  // be an unsupported reporter/partner/product qualifier; never silently query World instead.
  let residual = question.replace(/HS\s*(?:编码|代码|code)?\s*[:：]?\s*\d{2,6}/giu, '').replace(/20\d{2}\s*年?/gu, '');
  for (const [name] of countries) residual = residual.replaceAll(name, '');
  residual = residual.replace(/请|帮我|给我|查一下|查询|查看|查|统计|看看|看一下|列出|展示|标明|注明|标注|信息来源|数据来源|来源|年份|时间|单位|降序|排列|并|UN|Comtrade|海关数据|贸易统计|贸易|进口|出口|总额|总|金额|额|全部商品|到|向|对|从|哪些|主要|目的地|市场|国家|伙伴|排名|排行|前|的|年|在|按|是多少|多少|和|与|及/giu, '')
    .replace(/[\s\d，。！？、：:,.?!()（）]/gu, '');
  if (residual) return null;
  const ranking = /排名|排行|哪些|主要|目的地|市场|国家|前\s*\d+/u.test(question);
  return { year: years[0], hs: hs ?? 'TOTAL', reporter: names[0].code, flow,
    ...(names[1] ? { partner: names[1].code } : ranking ? {} : { partner: 0 }) };
}

/** These narrow data queries do not invoke an LLM, read enterprise secrets or execute tasks. */
async function buildExternalDataAnswer(question: string, options: {
  signal?: AbortSignal; rates?: typeof readExchangeRates; trade?: typeof readComtrade;
} = {}): Promise<ExternalAnswer | null> {
  const plan = planExternalQuestion(question);
  if (plan.kind === 'exchange') {
    if (/历史|昨天|去年|上周|走势|趋势|中间价|银行|结汇|买入|卖出|实时|分钟|\b20\d{2}\b/u.test(question)) return {
      text: '当前接入的是每日参考汇率，不能用来代替历史汇率、银行买卖价或实时结汇价。请明确币种及所需报价口径；需要的口径未接入时，我会直接说明。', sources: [], status: 'needs_input' };
    const query = parseExchangeQuestion(question);
    if (!query) return { text: '请明确要查询的两个币种；需要换算时同时给出金额，例如“100 美元换成人民币”。', sources: [], status: 'needs_input' };
    const snapshot = await (options.rates ?? readExchangeRates)(query.base, options.signal);
    const rate = snapshot.rates[query.quote];
    if (!rate) return { text: `本次数据源没有返回 ${query.quote} 的有效参考汇率，未进行换算。`, sources: [], status: 'needs_input' };
    const converted = query.amount ? decimalToMoney(parseExactDecimal(query.amount), query.quote, parseExactDecimal(rate)).decimal : null;
    return { status: 'ready', sources: [EXCHANGE_RATE_SOURCE], text: [
      converted ? `${query.amount} ${query.base} ≈ **${converted} ${query.quote}**。` : `1 ${query.base} = **${rate} ${query.quote}**。`,
      `数据时间：${snapshot.updatedAt}；本次读取：${snapshot.fetchedAt}${snapshot.cached ? '（缓存）' : ''}。`,
      '口径：每日参考汇率，非银行买卖价或实际结汇价；不改变企业报价。',
      `总体结论：按本次每日参考汇率，${converted ? `${query.amount} ${query.base}约合${converted} ${query.quote}` : `1 ${query.base}约合${rate} ${query.quote}`}，可用于初步估算；实际结算仍需采用银行当时的可成交报价。`,
    ].join('\n\n') };
  }
  if (plan.kind === 'trade') {
    const query = parseTradeQuestion(question);
    if (!query) return { status: 'needs_input', sources: [], text: '请补充统计年份、报告国、进口或出口方向，以及产品的 HS 2/4/6 位编码（全部商品可说“总额”）。当前支持单年度金额和贸易伙伴比较；例如“2025 年中国 HS 8504 出口到哪些国家”。我不会猜测产品编码，也不会用单年记录推算增长率。' };
    const data = await (options.trade ?? readComtrade)(query, options.signal);
    const source = { ...COMTRADE_SOURCE, uri: data.sourceUrl };
    if (!data.rows.length) return { status: 'ready', sources: [source], text: `${query.year} 年、HS ${query.hs} 的指定贸易统计，本轮未返回记录。\n\n读取时间：${data.fetchedAt}。\n\n总体结论：本次查询不足以判断市场规模，不能把未返回记录解释为贸易额为零或没有市场。` };
    const rows = data.rows.slice(0, 10).map(row => `| ${row.partnerName.replace(/[|\r\n]/gu, ' ')} | ${row.valueUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })} |`);
    return { status: 'ready', sources: [source], text: [
      `${query.year} 年，${countries.find(([, code]) => code === query.reporter)?.[0] ?? '指定报告国'}，HS ${query.hs}（${data.rows[0].commodity.replace(/[\r\n]/gu, ' ')}）${query.flow === 'X' ? '出口' : '进口'}统计：`,
      '| 贸易伙伴 | 贸易金额（美元） |\n| --- | ---: |\n' + rows.join('\n'),
      `${data.limited ? '本次为受限样本，不能据此称为完整市场排名。' : '按本次返回记录的贸易金额排序，展示至多 10 项。'}统计年份为 ${query.year}，不代表当前订单或实时需求；不含买家名单。`,
      `读取时间：${data.fetchedAt}${data.cached ? '（缓存）' : ''}。金额保留两位小数，进出口估值口径以原始统计为准。`,
      `总体结论：${data.limited ? '这些记录只能作为历史贸易样本，不能确定完整市场排名。' : query.partner !== undefined ? '本次已取得指定贸易范围的年度金额，不涉及其他伙伴的市场排名。' : `本次返回记录中，${data.rows[0].partnerName.replace(/[|\r\n]/gu, ' ')}的贸易金额最高。`}这份${query.year}年统计可作为市场调研线索，但不足以单独决定当前获客优先级，还需结合近期需求和企业自身条件。`,
    ].join('\n\n') };
  }
  return null;
}

export async function answerExternalData(question: string, options: Parameters<typeof buildExternalDataAnswer>[1] = {}): Promise<ExternalAnswer | null> {
  const answer = await buildExternalDataAnswer(question, options);
  if (answer?.status === 'needs_input') answer.text += '\n\n总体结论：当前条件或已接入的数据口径不足以完成这项查询，暂不提供可能误导决策的数字。';
  return answer;
}

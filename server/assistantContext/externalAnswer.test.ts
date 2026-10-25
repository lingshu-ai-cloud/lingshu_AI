import assert from 'node:assert/strict';
import test from 'node:test';
import { answerExternalData, parseExchangeQuestion, parseTradeQuestion } from './externalAnswer.js';
import { planExternalQuestion, latestAssistantQuestion } from './externalQuestion.js';

test('internal task/data questions stay internal while public and mixed questions choose the right data source', () => {
  for (const question of ['今天我的任务做得怎么样', '查一下我的任务数据', '我们本周订单如何', '我的出口额是多少', '查一下我的素材', '暂停任务', '写一封开发信']) {
    assert.equal(planExternalQuestion(question).kind, 'internal', question);
  }
  assert.equal(planExternalQuestion('今天美元兑人民币多少').kind, 'exchange');
  assert.equal(planExternalQuestion('2025年中国HS8504出口市场排名').kind, 'trade');
  assert.equal(planExternalQuestion('最近阿里国际站平台规则').kind, 'web');
  assert.equal(planExternalQuestion('WTO官方资料，不要求近期新闻').freshnessDays, undefined);
  assert.deepEqual(planExternalQuestion('WTO官方资料，不要求近期新闻').domains, ['wto.org']);
  assert.ok(planExternalQuestion('最新阿里国际站规则').domains.includes('supplier.alibaba.com'));
  assert.ok(!planExternalQuestion('最新阿里国际站规则').domains.includes('alibaba.com'));
  assert.ok(planExternalQuestion('美国化妆品准入政策').domains.includes('fda.gov'));
  assert.equal(planExternalQuestion('结合今天汇率分析我们的报价').mixed, true);
  assert.equal(planExternalQuestion('不要联网，今天汇率多少').kind, 'offline');
  assert.equal(latestAssistantQuestion([{ role: 'user', content: '【页面导航】数据\n用户问题：我的任务怎么样' }]), '我的任务怎么样');
});

test('currency amount/direction is explicit; ambiguous or malformed amounts are never guessed', () => {
  assert.deepEqual(parseExchangeQuestion('100美元换成人民币'), { base: 'USD', quote: 'CNY', amount: '100' });
  assert.deepEqual(parseExchangeQuestion('人民币兑美元汇率'), { base: 'CNY', quote: 'USD' });
  for (const value of ['美元汇率', '-100美元换成人民币', '1,000美元换人民币', '1.2.3美元换人民币', '美元欧元人民币', '100 XYZ兑美元人民币']) {
    assert.equal(parseExchangeQuestion(value), null, value);
  }
});

test('pure currency conversion uses deterministic existing money math and no trade/model call', async () => {
  let calls = 0;
  const result = await answerExternalData('100美元换成人民币', { rates: async base => {
    calls++; assert.equal(base, 'USD');
    return { base, rates: { USD: '1', CNY: '7.123456' }, sourceDate: '2026-10-25', updatedAt: '2026-10-25T00:00:00Z', nextUpdateAt: '2026-10-26T00:00:00Z', fetchedAt: '2026-10-25T01:00:00Z', cached: true };
  }, trade: async () => { throw new Error('must not read trade'); } });
  assert.equal(calls, 1);
  assert.match(result!.text, /712\.35 CNY/);
  assert.match(result!.text, /每日参考汇率/);
  assert.match(result!.text, /缓存/);
  assert.equal(result!.sources.length, 1);
});

test('unsupported FX quotation types and missing trade conditions clarify without hitting providers', async () => {
  const options = { rates: async () => { throw new Error('unexpected FX request'); }, trade: async () => { throw new Error('unexpected trade request'); } };
  for (const question of ['实时美元兑人民币汇率', '昨天美元兑人民币汇率', '今天银行结汇价', '美元汇率', '化妆品出口市场', 'HS8504出口额']) {
    assert.equal((await answerExternalData(question, options))?.status, 'needs_input', question);
  }
  assert.equal(await answerExternalData('不要联网查汇率', options), null);
});

test('trade parser requires explicit annual scope and does not substitute a different product or growth calculation', () => {
  assert.deepEqual(parseTradeQuestion('2025年中国HS8504出口到哪些国家'), { year: 2025, reporter: 156, hs: '8504', flow: 'X' });
  assert.deepEqual(parseTradeQuestion('2025年中国HS8504出口到哪些国家？列出主要贸易伙伴、出口金额、统计年份和信息来源。'), { year: 2025, reporter: 156, hs: '8504', flow: 'X' });
  assert.deepEqual(parseTradeQuestion('2025年中国对美国HS8504出口额'), { year: 2025, reporter: 156, partner: 842, hs: '8504', flow: 'X' });
  assert.deepEqual(parseTradeQuestion('2025年中国出口总额'), { year: 2025, reporter: 156, partner: 0, hs: 'TOTAL', flow: 'X' });
  for (const question of ['2025年中国化妆品出口额', '2025年中国HS8504进口出口额', '2025年10月中国HS8504出口额', '2024至2025年中国HS8504出口额', '2025年中国HS8504出口同比增长', '2025年HS8504出口市场', '2025年中国对土耳其HS8504出口额', '2025年印度尼西亚HS8504出口额', '2025年向美国出口的中国HS8504出口额']) assert.equal(parseTradeQuestion(question), null, question);
  for (const question of ['2025年印度尼西亚进口中国HS8504', '2025年中国进口土耳其的HS8504']) assert.equal(parseTradeQuestion(question), null, question);
});

test('trade answer labels partial data, units and time, and does not turn absence of records into zero', async () => {
  const trade: NonNullable<Parameters<typeof answerExternalData>[1]>['trade'] = async query => ({ query, rows: [{ partner: 842, partnerName: 'United States', valueUsd: 1234.56, commodity: 'Transformers' }], limited: true, cached: false, fetchedAt: '2026-10-25T00:00:00Z', sourceUrl: 'https://comtradeapi.un.org/public/v1/preview/C/A/HS?period=2025' });
  const result = await answerExternalData('2025年中国HS8504出口市场排名', { trade });
  assert.match(result!.text, /1,234\.56/);
  assert.match(result!.text, /受限样本/);
  assert.match(result!.text, /美元/);
  const empty = await answerExternalData('2025年中国HS8504出口额', { trade: async query => ({ ...await trade!(query), rows: [] }) });
  assert.match(empty!.text, /不能把未返回记录解释为贸易额为零/);
});

import fs from 'node:fs/promises';
import path from 'node:path';
import { extractSourceArticle } from '../server/externalInformation/sourceVerification.js';
import { parseDiscoveryFeed, assessPolicyCandidate } from '../server/externalInformation/sourceProbe.js';
import { renderExternalInformationDelivery } from './render-external-information-delivery.js';
import { externalInformationDeliverySchema } from '../shared/contracts/externalInformationDelivery.js';

// This reviewed sample uses captured responses only; it never calls a supplier or model.
const input = process.argv[2];
if (!input) throw Error('Usage: tsx scripts/build-external-information-delivery.ts <report.json>');
const directory = path.dirname(path.resolve(input));
const report = JSON.parse(await fs.readFile(input, 'utf8'));
for (const [id, kind] of [['news', 'news'], ['trends', 'trends']] as const) {
  const result = report.results.find((r: { id: string }) => r.id === id);
  if (!result?.rawFile) continue;
  const feed = parseDiscoveryFeed(await fs.readFile(path.join(directory, result.rawFile), 'utf8'), kind, Date.parse(result.fetchedAt));
  result.data = { total: feed.total, valid: feed.items.length, rejected: feed.rejected,
    matched: feed.items.filter(item => item.relevance === 'matched').length,
    items: [...feed.items.filter(item => item.relevance === 'matched'), ...feed.items.filter(item => item.relevance !== 'matched')].slice(0, 5) };
}
const google = report.results.find((r: { id: string }) => r.id === 'google-search');
if (google?.data) {
  google.data.rejectionReasons = assessPolicyCandidate(google.data.text, google.data.sources);
  google.data.eligibleForConclusion = false;
  if (google.data.rejectionReasons.length) { google.status = 'blocked'; google.errorCode = 'candidate_quality_rejected'; }
}
const exchange = report.results.find((r: { id: string }) => r.id === 'exchange');
if (exchange?.status !== 'ready') throw Error('sample_requires_valid_rate');
const articleFetch = JSON.parse(await fs.readFile(path.join(directory, 'article-fetch.json'), 'utf8'));
const article = extractSourceArticle(await fs.readFile(path.join(directory, 'article-original.html'), 'utf8'));
if (articleFetch.httpStatus !== 200 || !article.published.includes('2026-10-19')
  || !['ULACHOI', 'IPCR', 'KEHETO'].every(term => article.text.includes(term))
  || !article.text.includes('Ngày 1/10/2026')) throw Error('article_evidence_not_supported');
const rate = exchange.data.snapshot;
const conversion = exchange.data.conversion;
const delivery = externalInformationDeliverySchema.parse({
  schemaVersion: 1, runId: report.runId, generatedAt: new Date().toISOString(), status: 'partial',
  title: '越南美妆观察与参考汇率', scope: { industry: '美妆 / 防晒', market: '越南', period: '资讯近7天；汇率为数据源最新日快照' },
  conclusion: { text: '已取得一条越南美妆品牌研发与制造合作的媒体报道，以及有效的每日汇率快照。可以据此准备竞品调研与参考换算；目前证据不足以判断越南防晒需求增长、市场规模或新政策已经生效。',
    evidenceIds: ['F-rate', 'F-event'], limitations: ['媒体个案不是行业统计。', '汇率为 USD/CNY，与越南市场需求无直接证明关系。', '本次没有产品关键词趋势曲线、海关统计或越南政策原文。'] },
  facts: [
    { id: 'F-rate', type: 'reference_rate', text: `每日参考：1 USD = ${rate.rates.CNY} CNY；10,000 USD 换算为 ${conversion.result} CNY。数据源更新于 ${rate.updatedAt}，不代表银行结汇价。`, sourceIds: ['S-rate'] },
    { id: 'F-event', type: 'reported_event', text: '越南媒体 Thanh Niên Việt 于10月19日报道：ULACHOI 在10月1日与 IPCR 及 KEHETO 签署研发咨询和生产合作安排。这是报道中的单一企业事件。', sourceIds: ['S-article'] },
  ],
  interpretations: [{ text: '这一合作个案可作为当地品牌重视研发与制造协作的调研线索，不能据此推断整个市场或防晒品类增长。', evidenceIds: ['F-event'] }],
  suggestions: [
    { text: '下一步核对该品牌产品与制造合作对象，判断是否与我方品类相关；先形成调研记录。', evidenceIds: ['F-event'] },
    { text: '美元与人民币的成本测算可引用这份汇率快照；正式报价前确认结算币种、银行牌价及费用。', evidenceIds: ['F-rate'] },
  ],
  gaps: [
    { source: '海关总署', reason: '官网请求证书链校验失败；没有关闭 TLS 校验。', consequence: '未取得商品、国家、月份统计，不输出贸易规模与同比。' },
    { source: 'Google Trends', reason: `越南热搜 RSS 返回 ${report.results.find((r: { id: string }) => r.id === 'trends').data.total} 条；不是指定产品的历史兴趣曲线。`, consequence: '不输出产品热度增长率、销量或需求增长结论。' },
    { source: 'Google Search 政策候选', reason: '接口已返回，但缺少越南官方原文，生成文本含示例链接，候选被拒绝。', consequence: '不输出该政策的内容、生效日期或合规动作。' },
  ],
  sources: [
    { id: 'S-rate', title: 'ExchangeRate-API · 每日参考汇率', url: 'https://www.exchangerate-api.com', publishedAt: rate.updatedAt, fetchedAt: rate.fetchedAt, verification: 'payload_validated' },
    { id: 'S-article', title: 'Thanh Niên Việt · ULACHOI 研发及生产合作报道', url: articleFetch.finalUrl,
      publishedAt: '2026-10-19T17:00:00+07:00', fetchedAt: articleFetch.fetchedAt, verification: 'original_read' },
  ],
});
const reviewed = { ...report, reviewedAt: new Date().toISOString(),
  reviewNote: '基于原始响应重新解析；追加人工检索定位的媒体原文，不代表原聚合链接自动解析链路已完成。' };
await fs.writeFile(path.join(directory, 'reviewed-report.json'), JSON.stringify(reviewed, null, 2));
await fs.writeFile(path.join(directory, 'delivery.json'), JSON.stringify(delivery, null, 2));
const html = renderExternalInformationDelivery(delivery, report, rate, conversion);
await fs.writeFile(path.join(directory, 'index.html'), html);
console.log(JSON.stringify({ delivery: path.join(directory, 'delivery.json'), preview: path.join(directory, 'index.html'),
  sources: report.results.map((r: { id: string; status: string; data?: { total?: number; matched?: number } }) => ({ id: r.id, status: r.status, total: r.data?.total, matched: r.data?.matched })) }));

import { companyEventDateSupported } from '../companyBusinessDates.js';
import { z } from 'zod';

export const COMPANY_REPORT_MAX_EVIDENCE_PAGES = 12;
const text = z.string().trim().min(1).max(1600);
const cited = z.object({ text, evidenceIds: z.array(z.string()).min(1).max(COMPANY_REPORT_MAX_EVIDENCE_PAGES), supplementaryEvidenceIds: z.array(z.string()).max(3).optional() }).strict();
const observation = cited.extend({ quote: z.string().min(8).max(500) });
export const companyAnalysisSchema = z.object({
  headline: z.string().min(5).max(100), conclusion: cited,
  sections: z.array(z.object({ title: z.string().min(2).max(60), observation,
    interpretation: cited.optional(), implication: cited.optional() }).strict()).min(3).max(6),
  watchpoints: z.array(cited.extend({ verifyWith: z.string().min(5).max(300) })).min(1).max(5),
}).strict();
const publicInsightUrl = z.string().url().refine(value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && url.hostname.includes('.') && !url.hostname.endsWith('.') && !/[\[\]:]/u.test(url.hostname) && !/^\d+(?:\.\d+){3}$/u.test(url.hostname) && !/(?:^|\.)(?:localhost|local|internal|test|example|invalid)$/iu.test(url.hostname) && ![...url.searchParams.keys()].some(key => /token|key|secret|auth|password|signature|credential/iu.test(key)); } catch { return false; }
});
export const companyBusinessInsightsSchema = z.object({
  observationPeriod: z.object({ from: z.string(), to: z.string() }).strict(),
  status: z.enum(['ready', 'unavailable']),
  sources: z.array(z.object({ id: z.string(), title: text, url: publicInsightUrl, publishedAt: z.string(), excerpt: z.string().min(8).max(6000) }).strict()).max(8),
  events: z.array(z.object({ id: z.string(), title: z.string().min(4).max(120), date: z.string(),
    category: z.enum(['product', 'partnership', 'channel', 'supply-chain', 'overseas', 'research']),
    sourceIds: z.array(z.string()).min(1).max(4), quote: z.string().min(12).max(600), summary: text }).strict()).max(8),
  judgments: z.array(z.object({ title: z.string().min(4).max(100), text,
    financialEvidenceIds: z.array(z.string()).min(1).max(COMPANY_REPORT_MAX_EVIDENCE_PAGES), sourceIds: z.array(z.string()).min(1).max(4) }).strict()).max(5),
  actions: z.array(z.object({ audience: z.enum(['原料商', '代工厂', '品牌方']), text,
    financialEvidenceIds: z.array(z.string()).min(1).max(COMPANY_REPORT_MAX_EVIDENCE_PAGES), sourceIds: z.array(z.string()).min(1).max(4),
    verifyWith: z.string().min(5).max(400) }).strict()).max(6),
}).strict().superRefine((insights, ctx) => {
  const sources = new Map(insights.sources.map(source => [source.id, source]));
  const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/u.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  const { from, to } = insights.observationPeriod;
  const compact = (value: string) => value.normalize('NFKC').replace(/\s+/gu, '');
  if (!validDate(from) || !validDate(to) || Date.parse(to) - Date.parse(from) !== 89 * 86400000
    || sources.size !== insights.sources.length || new Set(insights.events.map(event => event.id)).size !== insights.events.length
    || insights.sources.some(source => !validDate(source.publishedAt) || source.publishedAt < from || source.publishedAt > to)
    || insights.events.some(event => !validDate(event.date) || event.date < from || event.date > to || event.sourceIds.some(id => !sources.has(id)) || !event.sourceIds.some(id => { const source = sources.get(id); return source && companyEventDateSupported(event.date, source); }) || !event.sourceIds.some(id => compact(sources.get(id)?.excerpt ?? '').includes(compact(event.quote))))
    || [...insights.judgments, ...insights.actions].some(item => item.sourceIds.some(id => !sources.has(id)))) {
    ctx.addIssue({ code: 'custom', message: 'company_insights_evidence_invalid' });
  }
  if ((insights.status === 'ready' && (!insights.events.length || !insights.judgments.length))
    || (insights.status === 'unavailable' && (insights.sources.length || insights.events.length || insights.judgments.length || insights.actions.length))) {
    ctx.addIssue({ code: 'custom', message: 'company_insights_status_invalid' });
  }
});
export type CompanyBusinessInsights = z.infer<typeof companyBusinessInsightsSchema>;
export const companyReportSchema = z.object({
  id: z.string().regex(/^cr_[a-f0-9]{24}$/), company: z.string().min(1).max(80), companyId: z.string().max(40),
  period: z.string().max(60), generatedAt: z.string(), status: z.enum(['ready', 'partial']),
  source: z.object({ title: text, url: z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'static.cninfo.com.cn' && !url.username && !url.password;
  }), publishedAt: z.string(), fetchedAt: z.string(), sha256: z.string().length(64), pages: z.number().int().positive(),
    audited: z.boolean(), auditStatus: z.enum(['audited', 'unaudited', 'not-stated']).optional(), latestVerified: z.literal(false) }),
  metrics: z.array(z.object({ id: z.string(), label: z.string(), current: z.string(), previous: z.string(),
    unit: z.literal('元人民币'), changePct: z.string(), page: z.number().int().positive(), excerpt: text, unitEvidence: z.object({ page: z.number().int().positive(), text: z.string().max(3000) }).optional() })).min(4).max(12),
  evidence: z.array(z.object({ id: z.string(), page: z.number().int().positive(), text: z.string().min(20).max(6000) })).min(3).max(16),
  supplementarySources: z.array(z.object({ id: z.string(), title: text, url: z.string().url().refine(value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } }), publishedAt: z.string(), excerpt: text })).max(3).optional(),
  analysis: companyAnalysisSchema,
  businessInsights: companyBusinessInsightsSchema.optional(),
  limitations: z.array(z.string().max(500)).min(1).max(10),
}).strict().superRefine((report, ctx) => {
  const ids = new Set(report.evidence.map(item => item.id));
  if (report.businessInsights && [...report.businessInsights.judgments, ...report.businessInsights.actions].some(item => item.financialEvidenceIds.some(id => !ids.has(id)))) ctx.addIssue({ code: 'custom', message: 'company_insights_financial_evidence_invalid' });
  const insights = [report.analysis.conclusion, ...report.analysis.sections.flatMap(section => [section.observation, ...(section.interpretation ? [section.interpretation] : []), ...(section.implication ? [section.implication] : [])]), ...report.analysis.watchpoints];
  const supplementalIds = new Set((report.supplementarySources ?? []).map(item => item.id));
  if (insights.some(insight => insight.supplementaryEvidenceIds?.some(id => !supplementalIds.has(id)))) ctx.addIssue({ code: 'custom', message: 'company_report_supplementary_evidence_invalid' });
  if (ids.size !== report.evidence.length || insights.some(insight => insight.evidenceIds.some(id => !ids.has(id)))) {
    ctx.addIssue({ code: 'custom', message: 'company_report_evidence_invalid' });
  }
});
export type CompanyReport = z.infer<typeof companyReportSchema>;
export type CompanyAnalysis = z.infer<typeof companyAnalysisSchema>;
export const COMPANY_REPORT_PHASES = ['读取指定财报原文', '提取报表与业务证据', '计算并核对同比', '分析关键变化', '核验结论引用', '补充检索经营证据', '核验补充经营解读', '检索近九十天企业动态', '综合财报与公开经营证据', '核验经营洞察引用'] as const;

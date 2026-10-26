import { z } from 'zod';

const text = z.string().trim().min(1).max(1600);
const cited = z.object({ text, evidenceIds: z.array(z.string()).min(1).max(6) }).strict();
const observation = cited.extend({ quote: z.string().min(8).max(500) });
export const companyAnalysisSchema = z.object({
  headline: z.string().min(5).max(100), conclusion: cited,
  sections: z.array(z.object({ title: z.string().min(2).max(60), observation,
    interpretation: cited, implication: cited }).strict()).min(3).max(6),
  watchpoints: z.array(cited.extend({ verifyWith: z.string().min(5).max(300) })).min(3).max(5),
}).strict();
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
  analysis: companyAnalysisSchema,
  limitations: z.array(z.string().max(500)).min(1).max(10),
}).strict().superRefine((report, ctx) => {
  const ids = new Set(report.evidence.map(item => item.id));
  const insights = [report.analysis.conclusion, ...report.analysis.sections.flatMap(section => [section.observation, section.interpretation, section.implication]), ...report.analysis.watchpoints];
  if (ids.size !== report.evidence.length || insights.some(insight => insight.evidenceIds.some(id => !ids.has(id)))) {
    ctx.addIssue({ code: 'custom', message: 'company_report_evidence_invalid' });
  }
});
export type CompanyReport = z.infer<typeof companyReportSchema>;
export type CompanyAnalysis = z.infer<typeof companyAnalysisSchema>;
export const COMPANY_REPORT_PHASES = ['读取指定财报原文', '提取报表与业务证据', '计算并核对同比', '分析关键变化', '核验结论引用'] as const;

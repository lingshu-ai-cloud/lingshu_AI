import { z } from 'zod';

export const filingKindSchema = z.enum(['annual', 'half-year', 'q1', 'q3']);
export type FilingKind = z.infer<typeof filingKindSchema>;
export const companyFilingSchema = z.object({
  id: z.string().regex(/^\d{5,20}$/), companyId: z.string(), code: z.string().regex(/^\d{6}$/),
  title: z.string().min(4).max(240), year: z.number().int().min(2000).max(2100), kind: filingKindSchema,
  periodKey: z.string(), periodLabel: z.string(), periodEnd: z.string(), publishedAt: z.string(),
  url: z.string().regex(/^https:\/\/static\.cninfo\.com\.cn\/finalpage\/\d{4}-\d{2}-\d{2}\/\d+\.pdf$/i),
  form: z.enum(['full', 'correction-notice']), revised: z.boolean(),
  periodBasis: z.enum(['title', 'pdf-cover']).default('title'),
}).strict();
export type CompanyFiling = z.infer<typeof companyFilingSchema>;
export const companyFilingsSnapshotSchema = z.object({
  version: z.literal(1), companyId: z.string(), company: z.string(), code: z.string(), orgId: z.string(),
  fetchedAt: z.string(), from: z.string(), through: z.string(), complete: z.boolean(),
  filings: z.array(companyFilingSchema).max(180),
  pendingReviewPeriodKeys: z.array(z.string()).max(80).default([]),
  changes: z.object({ addedIds: z.array(z.string()), removedIds: z.array(z.string()), changedIds: z.array(z.string()) }),
}).strict();
export type CompanyFilingsSnapshot = z.infer<typeof companyFilingsSnapshotSchema>;

export const companyReportOptionsSchema = z.object({
  checkedAt: z.string(), companies: z.array(z.object({
    id: z.string().max(40), name: z.string().max(60), code: z.string().regex(/^\d{6}$/), segment: z.string().max(80),
    sourceCheckedAt: z.string().nullable(),
    reports: z.array(z.object({ year: z.number().int().min(2000).max(2100), period: z.string().max(60),
      publishedAt: z.string(), status: z.enum(['available', 'needs_review']) }).strict()).max(8),
  }).strict()).max(8),
}).strict();
export type CompanyReportOptions = z.infer<typeof companyReportOptionsSchema>;

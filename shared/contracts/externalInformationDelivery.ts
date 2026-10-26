import { z } from 'zod';

const source = z.object({
  id: z.string(), title: z.string(), url: z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  }, 'source_url_unsafe'),
  publishedAt: z.string().optional(), fetchedAt: z.string(),
  verification: z.enum(['payload_validated', 'original_read', 'discovery_only']),
});
export const externalInformationDeliverySchema = z.object({
  schemaVersion: z.literal(1), runId: z.string(), generatedAt: z.string(),
  status: z.enum(['ready', 'partial', 'unavailable']), title: z.string(),
  scope: z.object({ industry: z.string(), market: z.string(), period: z.string() }),
  conclusion: z.object({ text: z.string(), evidenceIds: z.array(z.string()), limitations: z.array(z.string()) }),
  facts: z.array(z.object({ id: z.string(), text: z.string(), sourceIds: z.array(z.string()).min(1),
    type: z.enum(['reference_rate', 'reported_event']) })),
  interpretations: z.array(z.object({ text: z.string(), evidenceIds: z.array(z.string()).min(1) })),
  suggestions: z.array(z.object({ text: z.string(), evidenceIds: z.array(z.string()).min(1) })),
  gaps: z.array(z.object({ source: z.string(), reason: z.string(), consequence: z.string() })),
  sources: z.array(source),
}).superRefine((value, ctx) => {
  const sources = new Set(value.sources.map(item => item.id));
  const facts = new Set(value.facts.map(item => item.id));
  if (sources.size !== value.sources.length || facts.size !== value.facts.length) ctx.addIssue({ code: 'custom', message: 'duplicate_evidence_id' });
  for (const fact of value.facts) {
    if (fact.sourceIds.some(id => !sources.has(id))) ctx.addIssue({ code: 'custom', message: 'source_reference_missing' });
    if (fact.sourceIds.some(id => value.sources.find(source => source.id === id)?.verification === 'discovery_only')) {
      ctx.addIssue({ code: 'custom', message: 'discovery_cannot_support_fact' });
    }
  }
  for (const entry of [value.conclusion, ...value.interpretations, ...value.suggestions]) {
    if (entry.evidenceIds.some(id => !facts.has(id))) ctx.addIssue({ code: 'custom', message: 'fact_reference_missing' });
  }
});
export type ExternalInformationDelivery = z.infer<typeof externalInformationDeliverySchema>;

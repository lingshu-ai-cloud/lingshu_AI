import assert from 'node:assert/strict';
import test from 'node:test';
import { assessPolicyCandidate, parseDiscoveryFeed } from './sourceProbe.js';
import { externalInformationDeliverySchema } from '../../shared/contracts/externalInformationDelivery.js';

test('discovery rejects unknown, old, future dates and unsafe links; keeps scope explicit', () => {
  const now = Date.parse('2026-10-26T04:00:00Z');
  const row = (title: string, date: string, url: string) => `<item><title>${title}</title><link>${url}</link><pubDate>${date}</pubDate></item>`;
  const xml = '<rss><channel>'
    + row('Vietnam cosmetics', '2026-10-25T00:00:00Z', 'https://example.com/1')
    + row('Vietnam cosmetics duplicate', '2026-10-25T00:00:00Z', 'https://example.com/1')
    + row('Football', '2026-10-25T00:00:00Z', 'https://example.com/2')
    + row('Vietnam cosmetics', '', 'https://example.com/3')
    + row('Vietnam cosmetics', '2026-09-25T00:00:00Z', 'https://example.com/4')
    + row('Vietnam cosmetics', '2027-10-25T00:00:00Z', 'https://example.com/5')
    + row('Vietnam cosmetics', '2026-10-25T00:00:00Z', 'javascript:alert(1)')
    + '</channel></rss>';
  const result = parseDiscoveryFeed(xml, 'news', now);
  assert.equal(result.total, 7);
  assert.equal(result.rejected, 5);
  assert.deepEqual(result.items.map(item => item.relevance), ['matched', 'unmatched']);
});

test('invalid feed must not be interpreted as an empty successful search', () => {
  assert.throws(() => parseDiscoveryFeed('<html>denied</html>', 'news', Date.now()), /feed_channel_missing/);
  assert.throws(() => parseDiscoveryFeed('<rss>', 'news', Date.now()), /feed_xml_invalid/);
});

test('Trends topics sharing the feed URL remain separate; generic beauty is not cosmetics', () => {
  const row = (title: string) => `<item><title>${title}</title><link>https://trends.google.com/trending/rss?geo=VN</link><pubDate>2026-10-25T00:00:00Z</pubDate></item>`;
  const result = parseDiscoveryFeed(`<rss><channel>${row('football')}${row('sunscreen')}${row('beauty queen')}</channel></rss>`, 'trends', Date.parse('2026-10-26T00:00:00Z'));
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.items.map(item => item.relevance), ['unmatched', 'matched', 'unmatched']);
});

test('grounding response with example links and no original regulator must be rejected', () => {
  assert.deepEqual(assessPolicyCandidate('请注意，此链接为示例 https://www.sohu.com/a/123456789', [{ title: 'sohu.com', url: 'https://vertexaisearch.cloud.google.com/link' }]),
    ['official_original_not_verified', 'placeholder_link_in_generated_answer']);
});

test('frontend delivery cannot promote discovery to facts or lose evidence links', () => {
  const sample = { schemaVersion: 1, runId: 'test', generatedAt: '2026-10-26T00:00:00Z', status: 'partial', title: 'test',
    scope: { industry: 'test', market: 'test', period: 'test' },
    conclusion: { text: 'test', evidenceIds: ['F1'], limitations: [] },
    facts: [{ id: 'F1', text: 'test', sourceIds: ['S1'], type: 'reported_event' }], interpretations: [], suggestions: [], gaps: [],
    sources: [{ id: 'S1', title: 'test', url: 'https://example.com/article', fetchedAt: '2026-10-26T00:00:00Z', verification: 'original_read' }] };
  assert.equal(externalInformationDeliverySchema.safeParse(sample).success, true);
  assert.equal(externalInformationDeliverySchema.safeParse({ ...sample, sources: [{ ...sample.sources[0], verification: 'discovery_only' }] }).success, false);
  assert.equal(externalInformationDeliverySchema.safeParse({ ...sample, conclusion: { ...sample.conclusion, evidenceIds: ['missing'] } }).success, false);
  assert.equal(externalInformationDeliverySchema.safeParse({ ...sample, sources: [{ ...sample.sources[0], url: 'javascript:alert(1)' }] }).success, false);
});

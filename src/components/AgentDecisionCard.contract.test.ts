import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const card = read('./AgentDecisionCard.tsx');
const digitalEmployees = read('./DigitalEmployeePage.tsx');
const contentReview = read('./socialContent/SocialTaskOverview.tsx');
const quote = read('./customers/QuoteSkillCard.tsx');

for (const kind of ['content_approval', 'publish_confirmation', 'customer_outreach', 'quote_confirmation']) {
  assert.match(card, new RegExp(kind), `the shared decision card must support ${kind}`);
}
for (const label of ['成本 / 预算', '数量', '形式', '时长']) {
  assert.match(card, new RegExp(label), `the shared decision card must expose ${label}`);
}
assert.match(digitalEmployees, /<AgentDecisionCard[\s\S]{0,500}kind=\{approvalDecisionKind\}/, 'digital-employee approvals must use the shared card');
assert.match(digitalEmployees, /followup_batch_approval[\s\S]{0,180}customer_outreach/, 'customer outreach must select the unified decision kind');
assert.match(digitalEmployees, /content_release_approval[\s\S]{0,180}publish_confirmation/, 'publishing must select the unified decision kind');
assert.match(contentReview, /<AgentDecisionCard[\s\S]{0,180}kind="content_approval"/, 'content review must use the shared card');
assert.match(quote, /<AgentDecisionCard[\s\S]{0,180}kind="quote_confirmation"/, 'quote confirmation must use the shared card');

console.log('unified Agent decision card contract tests passed');

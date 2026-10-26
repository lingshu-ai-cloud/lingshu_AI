import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantQueryKind, homeQuickPrompt } from './assistantQueryQuickPrompts';
import { assistantHomePromptById } from './assistantHomeQuickPrompts';
import { planExternalQuestion } from '../../server/assistantContext/externalQuestion';
import { parseExchangeQuestion, parseTradeQuestion } from '../../server/assistantContext/externalAnswer';

test('scenario query drafts route to the existing internal, grounded search and deterministic data contracts', () => {
  assert.equal(assistantQueryKind('OP-09'), 'industry');
  assert.equal(assistantQueryKind('OP-RATES'), 'rates');
  assert.equal(assistantQueryKind('OP-TRADE'), 'trade');
  assert.equal(assistantQueryKind('CO-REPLICATE'), null);
  assert.equal(planExternalQuestion(assistantHomePromptById('CO-11')!.prompt).kind, 'internal');
  const industry = homeQuickPrompt('industry', { industry: '家具' });
  assert.equal(planExternalQuestion(industry).kind, 'web'); assert.equal(planExternalQuestion(industry).freshnessDays, 30);
  assert.deepEqual(parseExchangeQuestion(homeQuickPrompt('rates', { base: '美元', quote: '人民币' })), { base: 'USD', quote: 'CNY' });
  assert.deepEqual(parseTradeQuestion(homeQuickPrompt('trade', { country: '中国', year: 2024, flow: '出口', hs: '8504' })), { year: 2024, hs: '8504', reporter: 156, flow: 'X', partner: 0 });
  assert.throws(() => homeQuickPrompt('industry'));
  assert.throws(() => homeQuickPrompt('rates', { base: '美元', quote: '美元' }));
  assert.throws(() => homeQuickPrompt('trade', { country: '中国', year: 2024, flow: '出口', hs: 'XX' }));
});

test('every retained news scenario uses grounded public search and official domain policy', () => {
  for (const id of ['OP-02', 'OP-09', 'OP-10', 'OP-11', 'OP-12']) {
    const plan = planExternalQuestion(assistantHomePromptById(id)!.prompt);
    assert.equal(plan.kind, 'web', id);
    assert.ok(plan.domains.length > 0, id);
  }
});

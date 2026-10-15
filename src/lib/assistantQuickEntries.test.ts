import assert from 'node:assert/strict';
import test from 'node:test';
import { ASSISTANT_QUICK_ENTRY_PAGES, assistantQuickEntriesForPage } from './assistantQuickEntries';

const expectedPages = [
  'digitalEmployees',
  'socialInspiration',
  'smartAssets',
  'traffic',
  'conversion',
  'enterprise',
  'agentMemory',
  'plugins',
];

test('first release exposes page-local mixed quick entries on the requested surfaces', () => {
  assert.deepEqual([...ASSISTANT_QUICK_ENTRY_PAGES].sort(), [...expectedPages].sort());
  for (const page of expectedPages) {
    const entries = assistantQuickEntriesForPage(page as Parameters<typeof assistantQuickEntriesForPage>[0]);
    assert.ok(entries.length >= 4 && entries.length <= 5, `${page} should expose four or five entries`);
    assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length, `${page} entry ids must be unique`);
    const executions = entries.filter(entry => entry.kind === 'execute');
    assert.ok(executions.length >= 2 && executions.length <= 3, `${page} should mix in two or three executions`);
    assert.ok(entries.some(entry => entry.kind === 'question'), `${page} should retain quick questions`);
  }
});
test('excluded order and scheduler pages do not expose quick entries', () => {
  assert.deepEqual(assistantQuickEntriesForPage('orders'), []);
  assert.deepEqual(assistantQuickEntriesForPage('scheduled'), []);
});

test('outbound and destructive actions carry the strongest confirmation tier', () => {
  const publishing = assistantQuickEntriesForPage('traffic');
  const publish = publishing.find(entry => entry.id === 'publishing-publish');
  assert.equal(publish?.kind, 'execute');
  if (publish?.kind === 'execute') assert.equal(publish.confirmation, 'double');

  const conversation = assistantQuickEntriesForPage('conversion');
  const send = conversation.find(entry => entry.id === 'conversation-send');
  assert.equal(send?.kind, 'execute');
  if (send?.kind === 'execute') assert.equal(send.confirmation, 'double');
});

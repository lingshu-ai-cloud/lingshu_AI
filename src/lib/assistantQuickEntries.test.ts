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
  'plugins',
];

test('static suggestions only expose questions; execution requires backend capability', () => {
  assert.deepEqual([...ASSISTANT_QUICK_ENTRY_PAGES].sort(), [...expectedPages].sort());
  for (const page of expectedPages) {
    const entries = assistantQuickEntriesForPage(page as Parameters<typeof assistantQuickEntriesForPage>[0]);
    assert.equal(entries.length, 2);
    assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length, `${page} entry ids must be unique`);
    const executions = entries.filter(entry => entry.kind === 'execute');
    assert.equal(executions.length, 0, `${page} must not advertise unsupported execution`);
    assert.ok(entries.some(entry => entry.kind === 'question'), `${page} should retain quick questions`);
  }
});
test('excluded order and scheduler pages do not expose quick entries', () => {
  assert.deepEqual(assistantQuickEntriesForPage('orders'), []);
  assert.deepEqual(assistantQuickEntriesForPage('scheduled'), []);
});

test('outbound actions are not offered without a real signed object', () => {
  const publishing = assistantQuickEntriesForPage('traffic');
  const publish = publishing.find(entry => entry.id === 'publishing-publish');
  assert.equal(publish, undefined);

  const conversation = assistantQuickEntriesForPage('conversion');
  const send = conversation.find(entry => entry.id === 'conversation-send');
  assert.equal(send, undefined);
});

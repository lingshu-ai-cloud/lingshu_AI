import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const overview = readFileSync(new URL('./SocialTaskOverview.tsx', import.meta.url), 'utf8');
const decisionCenter = readFileSync(new URL('../assistant/AssistantDecisionCenter.tsx', import.meta.url), 'utf8');
const server = readFileSync(new URL('../../../server/digitalEmployees/assistantDecisionCenter.ts', import.meta.url), 'utf8');

test('assistant workbench handoff reuses the authoritative decision and locates the exact existing shot row', () => {
  assert.match(server, /decisionId: cardId, decisionVersion: subjectVersion/, 'the card deep link carries its own immutable identity');
  assert.match(server, /contentTaskId[\s\S]*shotId/, 'the existing production identities are projected without a second task contract');
  assert.match(decisionCenter, /socialContentTaskId: link\.businessRef\.contentId/, 'navigation opens the existing content task');
  assert.match(overview, /<AssistantDecisionCenter[\s\S]*decisionId=\{decisionTarget\.decisionId\}/, 'task detail reads the same backend decision card');
  assert.match(overview, /focusedShotId=\{decisionTarget\?\.shotId \|\| null\}/, 'shot focus is delegated to the existing shot view instead of duplicating row lookup');
  assert.doesNotMatch(overview, /function\s+DecisionCard|function\s+ShotProgressView/, 'the task detail does not create a second card or shot page');
});

test('an already-mounted task detail follows decision version and shot navigation changes', () => {
  assert.match(overview, /setDecisionTarget\(readSocialTaskDecisionNavigationTarget\(window\.history\.state\)\)/,
    'navigation changes must reread the authoritative history state');
  assert.match(overview, /addEventListener\('popstate', readCurrentTarget\)/,
    'browser history changes must replace the focused decision and shot');
  assert.match(overview, /addEventListener\(SOCIAL_CONTENT_NAVIGATION_EVENT, readCurrentTarget\)/,
    'same-page task handoffs must replace the focused decision and shot without a remount');
  assert.match(overview, /key=\{`\$\{decisionTarget\.decisionId\}:\$\{decisionTarget\.decisionVersion\}`\}/,
    'a new immutable decision version must remount the authoritative decision reader instead of retaining stale card state');
  assert.match(overview, /return decisionId && decisionVersion \? \{ decisionId, decisionVersion, shotId \} : null/,
    'partial or stale navigation without an immutable decision version must not focus an exception');
  assert.match(overview, /focusedShotId=\{decisionTarget\?\.shotId \|\| null\}/,
    'each selected exception may focus its own shot while retaining the existing shot view');
});

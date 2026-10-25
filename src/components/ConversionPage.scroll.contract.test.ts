import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('./ConversionPage.tsx', import.meta.url), 'utf8');
const chat = readFileSync(new URL('./customers/ConversionChatThread.tsx', import.meta.url), 'utf8');
const list = readFileSync(new URL('./customers/ConversionCustomerList.tsx', import.meta.url), 'utf8');
const presentation = readFileSync(new URL('./customers/conversionPresentation.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles/design-system.css', import.meta.url), 'utf8');

test('conversation workspace gives its internal scrollers a bounded desktop row', () => {
  assert.match(
    styles,
    /\.ls-conversation-workspace\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/s,
  );
  assert.match(
    styles,
    /\.ls-conversation-workspace__pane\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    styles,
    /\.ls-conversation-workspace__slot\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/s,
    'alerts and recovery controls must stay inside one grid column with the chat thread',
  );
  assert.doesNotMatch(styles, /\.ls-conversation-workspace__slot\s*\{[^}]*display:\s*contents;/s);
  assert.match(
    chat,
    /data-testid="conversation-chat-thread" className="[^"]*h-full[^"]*min-h-0[^"]*overflow-hidden[^"]*"/,
  );
  assert.match(
    styles,
    /\.ls-conversation-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(196px,\s*232px\)\s*minmax\(360px,\s*1fr\)\s*minmax\(224px,\s*248px\)/s,
    'desktop customer rail should stay compact so the conversation remains primary',
  );
  assert.match(
    styles,
    /\.ls-conversation-workspace\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;/s,
    'conversation workspace should not render an outer framed card',
  );
  assert.doesNotMatch(page, /本地模拟 · 外贸客户全流程/, 'local mock copy should not occupy a permanent page banner');
  assert.doesNotMatch(page, /aria-label="客户快捷操作"/, 'customer rail should not show share, profile, notification, or search shortcut buttons');
  assert.doesNotMatch(page, /\{customer\.isMock \? '模拟客户|模拟发送|真实客户 ·/, 'customer-facing conversation UI should not expose environment labels');
  assert.match(presentation, /function customerDisplayName[\s\S]{0,220}replace\(\/模拟客户\/g, '客户'\)/, 'stored customer names should also hide legacy simulation wording');
  assert.match(list, /const lastMessagePreview = \(lastMessage\?\.translatedBody \|\| lastMessage\?\.body/, 'customer rows should derive the latest message preview');
  assert.match(list, /line-clamp-2[^>]*title=\{lastMessagePreview\}>\{lastMessagePreview\}<\/p>/, 'customer rows should show the latest message preview below the customer name');
  assert.doesNotMatch(page, /data-lingshu-guide="customer-workbench"[^>]*bg-ink|data-lingshu-guide="customer-workbench"[^>]*lg:p-3/,
    'conversation workspace should use the page edge directly without an outer padded frame');
});

test('mobile conversation workspace keeps a constrained flex height chain', () => {
  assert.match(
    styles,
    /@container \(max-width:\s*699px\)[\s\S]*?\.ls-conversation-workspace\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/,
  );
});

test('conversation columns respond to the space left after the application sidebar', () => {
  assert.match(styles, /\.ls-conversation-container\s*\{[^}]*container-type:\s*inline-size;/s);
  assert.match(styles, /@container \(max-width:\s*999px\)[\s\S]*?grid-template-columns:\s*minmax\(196px,\s*224px\)\s*minmax\(340px,\s*1fr\)/);
  assert.match(styles, /@container \(max-width:\s*699px\)[\s\S]*?\.ls-conversation-workspace-nav\s*\{[^}]*display:\s*grid;/);
  assert.match(page, /ls-conversation-workspace__slot[^`]*\$\{mobilePanel === 'chat' \? ' is-active' : ''\}/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('./ConversionPage.tsx', import.meta.url), 'utf8');
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
    page,
    /data-testid="conversation-chat-thread" className="[^"]*h-full[^"]*min-h-0[^"]*overflow-hidden[^"]*"/,
  );
});

test('mobile conversation workspace keeps a constrained flex height chain', () => {
  assert.match(
    styles,
    /@media \(max-width:\s*767px\)[\s\S]*?\.ls-conversation-workspace\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/,
  );
});

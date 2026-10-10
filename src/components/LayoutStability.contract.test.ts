import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(new URL('./Layout.tsx', import.meta.url), 'utf8');
const transition = readFileSync(new URL('./ui/LsPageTransition.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

test('application shell keeps one shared mobile breakpoint', () => {
  assert.doesNotMatch(layout, /max-width:\s*760px/);
  assert.equal((layout.match(/max-width:\s*767px/g) || []).length, 2);
});

test('sidebar width is constrained while the main content remains shrinkable', () => {
  assert.match(layout, /animate=\{\{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth \}\}/);
  assert.match(layout, /app-main[^"\n]*min-w-0[^"\n]*flex-1[^"\n]*basis-0/);
  assert.match(transition, /data-app-content-stack[^>]*min-w-0[^>]*w-full/);
});

test('shared CSS contains zoom-safe flex, media and long-text rules', () => {
  assert.match(styles, /\.app-shell :where\(\.flex, \.inline-flex, \.grid\) > \*[\s\S]*?min-width: 0/);
  assert.match(styles, /\.app-shell :where\(img, video, canvas, iframe\)[\s\S]*?max-width: 100%/);
  assert.match(styles, /\[data-layout-scroll-x\][\s\S]*?overflow-x: auto/);
  assert.doesNotMatch(styles, /(?:html|body|#root)[^{]*\{[^}]*\bzoom\s*:/);
});

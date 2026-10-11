import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderDesignTokens, syncDesignTokens } from './generate-design-tokens.mjs';
const tokens = JSON.parse(readFileSync(new URL('../shared/design/tokens.json',import.meta.url),'utf8'));
test('committed web and native artifacts match the canonical design source', () => syncDesignTokens(true));
test('changing a semantic color updates both consumers without changing status meanings', () => {
  const changed = structuredClone(tokens); changed.colors.primary = '#123456';
  const outputs = renderDesignTokens(changed);
  assert.match(outputs['src/lib/designTokens.generated.ts'], /"primary": "#123456"/);
  assert.match(outputs['apps/shooting-miniapp/styles/tokens.wxss'], /--ls-primary: #123456/);
  assert.match(outputs['apps/shooting-miniapp/styles/tokens.wxss'], new RegExp(`--ls-success: ${tokens.colors.success}`));
});
test('native dimensions preserve responsive units, time units and all reduced-motion overrides', () => {
  const wxss = renderDesignTokens(tokens)['apps/shooting-miniapp/styles/tokens.wxss'];
  assert.match(wxss,/--ls-radius-panel: 16rpx/);
  assert.match(wxss,/--ls-control-touch: 88rpx/);
  assert.match(wxss,/--ls-type-body-medium-size: 28rpx/);
  assert.match(wxss,/--ls-motion-enter: 250ms/);
  for (const role of Object.keys(tokens.motion.duration)) assert.ok(wxss.includes(`--ls-motion-${role}: 0ms`));
  const components = readFileSync(new URL('../apps/shooting-miniapp/styles/components.wxss',import.meta.url),'utf8');
  assert.match(components,/min-height: max\(44px, var\(--ls-control-touch\)\)/);
});

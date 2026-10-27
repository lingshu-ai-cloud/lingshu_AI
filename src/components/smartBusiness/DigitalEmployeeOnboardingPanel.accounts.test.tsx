import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OnboardingPanel } from './DigitalEmployeeOnboardingPanel';
import { EMPTY_CONFIG } from './digitalEmployeeConfigRules';

test('account configuration opens the existing publishing platform and account editor', () => {
  const html = renderToStaticMarkup(createElement(OnboardingPanel, {
    initial: EMPTY_CONFIG, readiness: [], busy: false, mode: 'rules', initialSettingsOpen: true,
    onSave: () => {}, onOpenReadiness: () => {},
  }));
  assert.match(html, /周草稿、发布平台与具体账号/);
  assert.match(html, /aria-label="Agent 设置"/);
  assert.match(html, /关闭 Agent 设置/);
});

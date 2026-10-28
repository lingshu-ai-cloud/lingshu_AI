import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OnboardingPanel } from './DigitalEmployeeOnboardingPanel';
import { EMPTY_CONFIG } from './digitalEmployeeConfigRules';
import fs from 'node:fs';
import { normalizeEnterpriseOnboardingDraft } from '../../../shared/contracts/enterpriseOnboarding';

test('account configuration opens the existing publishing platform and account editor', () => {
  const html = renderToStaticMarkup(createElement(OnboardingPanel, {
    initial: EMPTY_CONFIG, readiness: [], busy: false, mode: 'rules', initialSettingsOpen: true,
    onSave: () => {}, onOpenReadiness: () => {},
  }));
  assert.match(html, /周草稿、发布平台与具体账号/);
  assert.match(html, /aria-label="Agent 设置"/);
  assert.match(html, /关闭 Agent 设置/);
});

test('the market step completes three-step onboarding without a main-platform field', () => {
  const steps = fs.readFileSync(new URL('./DigitalEmployeeOnboardingSteps.tsx', import.meta.url), 'utf8');
  const panel = fs.readFileSync(new URL('./DigitalEmployeeOnboardingPanel.tsx', import.meta.url), 'utf8');
  assert.match(steps, /第 \{step\} 步，共 3 步/);
  assert.doesNotMatch(steps, /label="主平台"|综合确认|step=\{4\}/);
  assert.match(steps, /primaryLabel="确认并完成新手引导"/);
  assert.match(panel, /onBack=\{\(\) => setGuideStep\(2\)\} onConfirm=\{\(\) => void completeMinimalOnboarding\(\)\}/);
  assert.match(panel, /saveEnterpriseOnboardingDraft\(buildOnboardingDraft\(3\), draftRevision\)/);
  assert.equal(normalizeEnterpriseOnboardingDraft({ schemaVersion: 'enterprise-onboarding.v1', confirmationId: 'onboarding:legacy', currentStep: 4 })?.currentStep, 3);
});

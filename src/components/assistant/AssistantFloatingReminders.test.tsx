import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import AssistantFloatingReminders from './AssistantFloatingReminders';

const noOp = () => {};
const base: ComponentProps<typeof AssistantFloatingReminders> = {
  page: 'enterprise', mode: 'breathing', launcherRetracted: false, reduceMotion: false,
  viewportWidth: 1440, performance: null, performanceHidden: false,
  performanceMessage: '任务正在处理中', onHidePerformance: noOp,
  speechBubble: null, weeklyPlanKickoffAvailable: false,
  weeklyPlanPromptDismissed: false, onDismissWeeklyPlanPrompt: noOp,
  onOpenWeeklyPlan: noOp, featureGuide: null, onDismissFeatureGuide: noOp,
  onOpenFeatureGuide: noOp, enterpriseGuideSeen: false,
  onOpenCurrentPageAgent: noOp,
};
const render = (overrides: Partial<typeof base>) =>
  renderToStaticMarkup(<AssistantFloatingReminders {...base} {...overrides} />);

test('floating reminder priority stays performance, speech, weekly plan, guide, enterprise', () => {
  const performance = { phase: 'render', reason: 'approval_required' as const };
  const speechBubble = { id: 1, message: '一条短消息' };
  const featureGuide = { id: 'guide-a', title: '功能提示', message: '这里可操作', agent: 'strategy' as const };
  const all = { performance, speechBubble, weeklyPlanKickoffAvailable: true, featureGuide,
    enterpriseGuideSeen: true };
  assert.match(render(all), /data-lingshu-assistant-performance="render"/);
  assert.doesNotMatch(render(all), /data-lingshu-assistant-speech|data-lingshu-weekly-plan-prompt|data-lingshu-guide-bubble/);
  assert.match(render({ ...all, performanceHidden: true }), /data-lingshu-assistant-speech="true"/);
  assert.match(render({ ...all, performanceHidden: true, speechBubble: null }), /data-lingshu-weekly-plan-prompt="true"/);
  assert.match(render({ ...all, performanceHidden: true, speechBubble: null,
    weeklyPlanPromptDismissed: true }), /data-lingshu-guide-bubble="guide-a"/);
  assert.match(render({ performanceHidden: true, enterpriseGuideSeen: true }), /要补资料？点我/);
});

test('retracted launcher and open conversation render no lateral reminder', () => {
  const state = { performance: { phase: 'render', reason: 'failed' as const },
    speechBubble: { id: 1, message: '短消息' }, weeklyPlanKickoffAvailable: true };
  assert.doesNotMatch(render({ ...state, launcherRetracted: true }), /data-assistant-surface="floating-reminder"/);
  assert.doesNotMatch(render({ ...state, mode: 'chat' }), /data-assistant-surface="floating-reminder"/);
});

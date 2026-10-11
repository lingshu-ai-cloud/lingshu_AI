import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import WeeklyProductionTimeline from './WeeklyProductionTimeline';
import type { WeeklyContentProgressStage, WeeklyContentProgressStageKey } from '../../lib/weeklyContentProgress';

const source = readFileSync(new URL('./WeeklyProductionTimeline.tsx', import.meta.url), 'utf8');

test('production nodes render shared Ant Timeline cards from actual stage states and evidence', () => {
  assert.match(source, /aria-label="制作节点"/);
  assert.match(source, /<Timeline orientation="vertical" items=\{stages.map/);
  for (const field of ['stage.status', 'stage.label', 'stage.statusLabel', 'stage.detail', 'stage.evidence']) assert.ok(source.includes(field));
  assert.match(source, /stage.status === 'completed'/);
  assert.match(source, /theme.useToken\(\)/);
  assert.match(source, /执行角色：/);
  assert.doesNotMatch(source, /\bindex\s*[<>]|percent=|estimatedMinutes|约.*分钟|[0-9]+%|Math.random|setTimeout|animate-pulse/);
});

test('all seven timeline nodes retain their individual receipts without marking earlier nodes complete', () => {
  const keys: WeeklyContentProgressStageKey[] = ['benchmark', 'script', 'materials', 'voice', 'presenter', 'render', 'quality'];
  const stages: WeeklyContentProgressStage[] = keys.map(key => ({
    key, label: `真实阶段 ${key}`, status: key === 'quality' ? 'running' : key === 'presenter' ? 'blocked' : 'pending',
    statusLabel: key === 'presenter' ? '待补充数字人' : '真实状态', detail: `实际详情 ${key}`, evidence: [`真实回执 ${key}`],
  }));
  const html = renderToStaticMarkup(React.createElement(WeeklyProductionTimeline, { stages }));
  for (const key of keys) {
    assert.ok(html.includes(`data-production-stage="${key}"`));
    assert.ok(html.includes(`真实回执 ${key}`));
  }
  assert.match(html, /data-production-stage="quality" data-stage-status="running"/);
  assert.match(html, /data-production-stage="benchmark" data-stage-status="pending"/);
  assert.match(html, /待补充数字人/);
  assert.doesNotMatch(html, /data-stage-status="completed"|17%|4 小时|预计时长/);
});

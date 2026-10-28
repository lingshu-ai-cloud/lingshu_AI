import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssistantWaitingProgress, startWaitingProgress, thinkingActivity } from './AssistantWaitingProgress';
import { AssistantAnalysisWork } from './AssistantAnalysisWork';

test('waiting indicator adds a neutral update every two seconds and stops on cleanup', () => {
  let callback: (() => void) | undefined;
  let period = 0;
  let stopped = false;
  let updates = 0;
  const timer = {} as ReturnType<typeof setInterval>;
  const schedule = ((fn: () => void, milliseconds: number) => { callback = fn; period = milliseconds; return timer; }) as typeof setInterval;
  const cancel = ((value: ReturnType<typeof setInterval>) => { assert.equal(value, timer); stopped = true; callback = undefined; }) as typeof clearInterval;
  const stop = startWaitingProgress(() => updates++, schedule, cancel);
  assert.equal(period, 2000);
  callback?.(); callback?.();
  assert.equal(updates, 2);
  stop();
  assert.equal(stopped, true);
  assert.equal(callback, undefined);
});

test('thinking process includes real progress without elapsed seconds or extra spinners', () => {
  const html = renderToStaticMarkup(<AssistantWaitingProgress events={[{id:'one',label:'真实来源进度',detail:'已收到回执',status:'completed'}]}/>);
  assert.match(html, /思考过程/);
  assert.match(html, /思考中/);
  assert.match(html, /真实来源进度/);
  assert.doesNotMatch(html, /秒|animate-spin|正在等待回复/);
  assert.equal((html.match(/aria-hidden="true">…/gu) || []).length, 1);
});

test('old running events stop displaying when the response ends or fails', () => {
  const events = [{ id: 'verification', label: '正在核验', detail: '读取资料', status: 'running' as const }];
  const active = renderToStaticMarkup(<AssistantAnalysisWork events={events} active/>);
  assert.match(active, /正在核验/);
  for (const complete of [true, false]) {
    const html = renderToStaticMarkup(<AssistantAnalysisWork events={events} complete={complete}/>);
    assert.doesNotMatch(html, /正在核验|正在分析业务资料/);
  }
});

test('activity descriptions stay within the actual running task and never invent network activity', () => {
  const event = (detail: string, status: 'running' | 'completed' = 'running') => [{ id: 'company-report', label: '整理企业报告', detail, status }];
  assert.match(thinkingActivity(event('分析关键变化')), /分析/);
  assert.match(thinkingActivity(event('核验结论引用')), /核验/);
  assert.match(thinkingActivity(event('计算并核对同比')), /数据/);
  for (let index = 0; index < 9; index++) assert.doesNotMatch(thinkingActivity(event('分析关键变化'), index), /联网|搜索|检索/);
  assert.match(thinkingActivity([{ id: 'sources', label: '检索并核验公开来源', detail: '查找原文', status: 'running' }]), /联网/);
  assert.equal(thinkingActivity(event('分析关键变化', 'completed')), '思考中');
  assert.equal(thinkingActivity([]), '思考中');
});

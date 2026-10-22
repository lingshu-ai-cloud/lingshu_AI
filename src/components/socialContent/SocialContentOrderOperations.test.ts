import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('operations are mounted on actual task and weekly production workspaces with explicit server authority', () => {
  const source = readFileSync(new URL('./SocialContentOrderOperations.tsx', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('./SocialContentWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /taskId=\{weeklyTarget.contentTaskId\}/);
  assert.match(workspace, /taskId=\{task.taskId\}/);
  const studio = readFileSync(new URL('../AiCreateStudio.tsx', import.meta.url), 'utf8');
  assert.match(studio, /<SocialContentOrderOperations key=\{socialContentTaskId\} taskId=\{socialContentTaskId\}/);
  const traffic = readFileSync(new URL('../TrafficWorkspacePage.tsx', import.meta.url), 'utf8');
  assert.match(traffic, /<SocialContentOrderOperations key=\{weeklyTarget.contentTaskId\} taskId=\{weeklyTarget.contentTaskId\}/);
  assert.match(source, /snapshot\?\.replacementTasks/);
  assert.match(source, /snapshot\?\.cancelable/);
  assert.match(source, /expectedVersion: snapshot.cancelTarget\?\.taskVersion \|\| snapshot.taskVersion/);
  assert.match(source, /expectedRevision: snapshot.planning.revision/);
  assert.match(source, /pending.current\?\.values/);
  assert.match(source, /cause.status === 409/);
  assert.match(source, /历史运行、交付凭据和费用不会删除或清零/);
  assert.doesNotMatch(source, /startTask|localStorage\.setItem|mock/i);
  assert.match(source, /closable=\{!busy && !pending.current\}/);
  assert.match(source, /keyboard=\{!busy && !pending.current\}/);
  assert.match(source, /disabled: busy \|\| !!pending.current/);
  assert.match(source, /maxLength=\{500\}/);
  assert.match(source, /max=\{100\}/);
  assert.match(source, /retainedReasons.map\(retainedOrderReason\)/);
});

test('group cancellation freezes the target and group fence and renders honest per-task outcomes', () => {
  const source = readFileSync(new URL('./SocialContentOrderOperations.tsx', import.meta.url), 'utf8');
  assert.match(source, /expectedGroupHash: snapshot.cancelTarget.groupHash/);
  assert.match(source, /pending.current.cancellation!/);
  assert.match(source, /api.cancel\(request.taskId, request.input, commandId\)/);
  assert.match(source, /取消原任务及修订/);
  assert.match(source, /snapshot.cancelTarget.participants.map/);
  assert.match(source, /snapshot.cancellation.participants.map/);
  assert.match(source, /历史状态保留/);
  assert.match(source, /不代表外部请求已取消/);
  assert.match(source, /后续执行已停止/);
  assert.doesNotMatch(source, /外部取消成功|\{participant.taskId\}<|\{participant.jobIds\}/);
});

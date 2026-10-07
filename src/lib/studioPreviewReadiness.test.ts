import assert from 'node:assert/strict';
import { test } from 'node:test';
import { studioPreviewRenderBlockers } from './studioPreviewReadiness';
const ready = { busy: false, ready: true, canGenerateVoiceover: false, readinessIssues: [], subtitleReason: '', alignmentReason: '', renderableVersions: 1, needsVoiceover: false, timingBlocked: false };
test('reports every active safety gate, including shot detail', () => {
  assert.deepEqual(studioPreviewRenderBlockers({ ...ready, ready: false, readinessIssues: ['分镜 17 素材需调整'], subtitleReason: '缺源片时间码', alignmentReason: '配音需要对齐', timingBlocked: true, preparationError: '源片分析失败' }), ['分镜 17 素材需调整', '缺源片时间码', '配音需要对齐', '源片分析失败']);
});
test('automatic voice generation defers only gates deferred by render action', () => {
  assert.deepEqual(studioPreviewRenderBlockers({ ...ready, ready: false, canGenerateVoiceover: true, needsVoiceover: true, renderableVersions: 0, readinessIssues: ['缺配音'], subtitleReason: '缺源片时间码', alignmentReason: '配音需要对齐' }), ['配音需要对齐']);
});
test('ready configuration is not a generated artifact', () => {
  assert.deepEqual(studioPreviewRenderBlockers(ready), []);
  assert.deepEqual(studioPreviewRenderBlockers({ ...ready, renderableVersions: 0 }), ['当前没有可渲染的语言版本，请检查口播与分镜素材。']);
});

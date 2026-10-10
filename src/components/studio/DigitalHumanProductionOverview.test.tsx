import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import DigitalHumanProductionOverview from './DigitalHumanProductionOverview.js';

test('production overview summarizes per-shot progress, failures, costs and assembly versions', () => {
  const execution = (patch: any) => ({
    id: 'e1', planId: 'p1', jobId: 'j1', projectId: 'project', assemblyId: 'a1', shotId: 's1', fingerprint: 'f1', tool: 'runway_act_two', provider: 'runway_act_two', model: null,
    presenterAssetVersion: 1, state: 'completed', externalTaskId: 'remote-1', materialId: 'm1', estimatedCostCny: 6, actualCostCny: 5.5, costStatus: 'reconciled', costSourceRef: 'invoice-1', error: '',
    quality: { state: 'accepted', updatedAt: '', checks: [] }, routeSteps: [], createdAt: '', updatedAt: '2026-01-01T00:00:00Z', ...patch,
  });
  const html = renderToStaticMarkup(<DigitalHumanProductionOverview onOpenShot={() => {}} shots={[
    { shotId: 'story-1', title: '分镜 1', executions: [execution({ adoption: { candidateId: 'c1', materialId: 'm1', assemblyVersion: 'assembly-v1', adoptedAt: '' } })] },
    { shotId: 'story-2', title: '分镜 2', executions: [execution({ id: 'e2', shotId: 's2', state: 'failed', error: '供应商生成失败', actualCostCny: null, costStatus: 'estimated', quality: { state: 'failed', reviewNote: '人物动作需要调整', updatedAt: '', checks: [] } })] },
  ]} />);
  for (const label of ['数字人制作进度 · 1/2 已填入 · 1 项需处理', '当前视频预计费用 ¥12.00', '已对账 ¥5.50', '分镜 1 · 已填入分镜', '分镜 2 · 质检未通过', '供应商生成失败', '修改意见：人物动作需要调整', '装配 assembly-v1', '打开分镜处理']) assert.match(html, new RegExp(label));
});

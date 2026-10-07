import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import BenchmarkAnalysisSections from './BenchmarkAnalysisSections.js';
import { buildBenchmarkAnalysis } from '../../../shared/benchmarkAnalysis.js';
import { benchmarkVideoFixture } from '../../../tests/fixtures/benchmarkVideo.js';
test('top sections distinguish source evidence, classification and counts without fake frames', () => {
  const analysis = buildBenchmarkAnalysis({ analysis: benchmarkVideoFixture(), videoId: 'video-fixture', duration: 9, evidenceRevision: 'test' });
  const html = renderToStaticMarkup(<BenchmarkAnalysisSections analysis={analysis} />);
  assert.ok(!html.includes('钩子分析'));
  assert.ok(html.includes('钩子'));
  assert.ok(html.includes('<details open=""'));
  for (const label of ['已拆解 9 个镜头', '3 个口播段', '消费者使用与效果演示', '首帧未取得', '按口播段查看']) assert.ok(html.includes(label), label);
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('可制作成片'));
});
test('empty, pending, legacy and failed evidence remains readable', () => {
  const empty = buildBenchmarkAnalysis({ analysis: {} });
  const pending = renderToStaticMarkup(<BenchmarkAnalysisSections analysis={empty} pending />);
  assert.ok(pending.includes('编导 Agent 分析中')); assert.ok(!pending.includes('分析字段齐全'));
  const legacy = renderToStaticMarkup(<BenchmarkAnalysisSections analysis={empty} />);
  assert.ok(legacy.includes('尚无逐镜数据')); assert.ok(!legacy.includes('结构化钩子'));
  const failed = buildBenchmarkAnalysis({ analysis: { analysisError: 'timeout' } });
  assert.ok(renderToStaticMarkup(<BenchmarkAnalysisSections analysis={failed} />).includes('分析需要重试'));
});

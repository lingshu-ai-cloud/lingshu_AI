import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('performance summary discloses report coverage, UTC boundaries and budget semantics', () => {
  const source = readFileSync(new URL('./AdPerformanceOverview.tsx', import.meta.url), 'utf8');
  assert.match(source, /data\.stale \? '含历史快照 · 非实时'/);
  assert.match(source, /!data\.complete \? '数据覆盖不完整'/);
  assert.match(source, /所选周期没有可核验的日数据/);
  assert.match(source, /日期筛选按 UTC/);
  assert.match(source, /已返回 \{data\.usable\.length\}\/\{tasks\.filter/);
  assert.match(source, /\{missing\} 个尚无报告/);
  assert.match(source, /缺失日期不补零/);
  assert.match(source, /不会自动补采历史/);
  assert.match(source, /reduce\(\(n, t\) => n \+ \(Number\(t\.budget\) \|\| 0\), 0\)/);
  assert.match(source, /计划预算合计，非剩余预算/);
});

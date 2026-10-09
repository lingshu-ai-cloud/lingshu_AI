import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import type { LsDataChartProps } from './LsDataChart';
import { lsFonts, lsMotion, lsTypography } from '../../lib/designTokens';

// Execute the complete TSX component with deterministic hook/DOM/Chart.js adapters.
// Assertions inspect rendered component props, actual chart configs and downloaded bytes.
const compiled = ts.transpileModule(fs.readFileSync('src/components/ui/LsDataChart.tsx', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
type RenderNode = { type: unknown; props: Record<string, any> };
type Cell = { value?: any; deps?: readonly unknown[]; cleanup?: () => void };
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function harness(initial: LsDataChartProps, options: { importFailure?: boolean; reducedMotion?: boolean } = {}) {
  let props = initial;
  let cursor = 0;
  let tree: RenderNode;
  let imports = 0;
  let destroyed = 0;
  let stopped = 0;
  const cells: Cell[] = [];
  const effects: Array<() => void> = [];
  const configs: any[] = [];
  const updates: string[] = [];
  const canvasElement = { tagName: 'CANVAS' };
  const downloads: Array<{ blob: Blob; href: string; filename: string }> = [];
  const revoked: string[] = [];
  const timers: Array<() => void> = [];
  const blobs = new Map<string, Blob>();
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const changed = (before: readonly unknown[] | undefined, after: readonly unknown[]) => !before || before.length !== after.length || before.some((value, i) => !Object.is(value, after[i]));
  const Empty = Object.assign(function Empty() {}, { PRESENTED_IMAGE_SIMPLE: 'empty-image' });
  const components = { Alert: 'Alert', Button: 'Button', Collapse: 'Collapse', Empty, Skeleton: 'Skeleton', Table: 'Table', Tag: 'Tag' };
  const hooks = {
    useRef(value: unknown) { const entry = cell(); return entry.value ?? (entry.value = { current: value }); },
    useId() { const entry = cell(); return entry.value ?? (entry.value = `chart-${cursor}`); },
    useState(value: unknown) { const entry = cell(); if (!('value' in entry)) entry.value = value; return [entry.value, (next: unknown) => { entry.value = next; }]; },
    useMemo(read: () => unknown, deps: readonly unknown[]) { const entry = cell(); if (changed(entry.deps, deps)) { entry.value = read(); entry.deps = deps; } return entry.value; },
    useEffect(run: () => (() => void) | undefined, deps: readonly unknown[]) {
      const entry = cell();
      if (changed(entry.deps, deps)) { entry.deps = deps; effects.push(() => { entry.cleanup?.(); entry.cleanup = run(); }); }
    },
  };
  const jsx = (type: unknown, attributes: Record<string, any>) => {
    const node = { type, props: attributes || {} };
    if (type === 'canvas' && attributes.ref) attributes.ref.current = canvasElement;
    return node;
  };
  class FakeChart {
    static register() {}
    data: any;
    options: any;
    constructor(_canvas: unknown, private config: any) { this.data = config.data; this.options = config.options; configs.push(config); }
    destroy() { destroyed += 1; }
    stop() { stopped += 1; }
    update(mode: string) { this.config.data = this.data; this.config.options = this.options; updates.push(mode); }
  }
  const exports: Record<string, any> = {};
  vm.runInNewContext(compiled, {
    exports, module: { exports }, Blob,
    require(name: string) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === 'antd') return components;
      if (name === 'lucide-react') return { Download: 'Download' };
      if (name === '../../lib/designTokens') return { lsFonts, lsMotion, lsTypography };
      if (name === '../../lib/usePrefersReducedMotion') return { usePrefersReducedMotion: () => Boolean(options.reducedMotion) };
      if (name === 'chart.js') { imports += 1; if (options.importFailure) throw new Error('simulated chart import failure'); return { Chart: FakeChart }; }
      throw new Error(`Unexpected dependency: ${name}`);
    },
    window: { matchMedia: () => ({ matches: Boolean(options.reducedMotion) }) },
    URL: {
      createObjectURL(blob: Blob) { const url = `blob:chart-${blobs.size}`; blobs.set(url, blob); return url; },
      revokeObjectURL(url: string) { revoked.push(url); },
    },
    document: { createElement(tag: string) {
      assert.equal(tag, 'a');
      return { href: '', download: '', click() { const blob = blobs.get(this.href); assert.ok(blob); downloads.push({ blob, href: this.href, filename: this.download }); } };
    } },
    setTimeout(run: () => void) { timers.push(run); return timers.length; },
  });
  const render = (next = props) => { props = next; cursor = 0; tree = exports.LsDataChart(props); return tree; };
  const runEffects = () => { for (const effect of effects.splice(0)) effect(); };
  const settle = () => new Promise<void>(resolve => setImmediate(resolve));
  return {
    configs, updates, downloads, revoked,
    render, runEffects,
    async mount() { render(); runEffects(); await settle(); return tree; },
    async update(next: LsDataChartProps) { render(next); runEffects(); await settle(); return tree; },
    async settle() { await settle(); },
    cleanup() { cells.forEach(entry => entry.cleanup?.()); },
    runTimers() { timers.splice(0).forEach(run => run()); },
    setReducedMotion(value: boolean) { options.reducedMotion = value; },
    get imports() { return imports; }, get destroyed() { return destroyed; }, get stopped() { return stopped; }, get tree() { return tree; },
  };
}

function allNodes(value: unknown): RenderNode[] {
  if (Array.isArray(value)) return value.flatMap(allNodes);
  if (!value || typeof value !== 'object' || !('type' in value)) return [];
  const node = value as RenderNode;
  return [node, ...allNodes(node.props.children), ...(node.props.items || []).flatMap((item: any) => allNodes(item.children))];
}
const name = (node: RenderNode) => typeof node.type === 'string' ? node.type : (node.type as { name?: string })?.name;
function find(tree: RenderNode, type: string) { const node = allNodes(tree).find(item => name(item) === type); assert.ok(node, `${type} should be rendered`); return node; }
const text = (value: any): string => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' && 'props' in value ? text(value.props.children) : value == null || value === false ? '' : String(value);
function csvRows(body: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false;
  const source = body.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"') { if (quoted && source[i + 1] === '"') { value += '"'; i += 1; } else quoted = !quoted; }
    else if (!quoted && char === ',') { row.push(value); value = ''; }
    else if (!quoted && (char === '\n' || char === '\r')) { row.push(value); rows.push(row); row = []; value = ''; if (char === '\r' && source[i + 1] === '\n') i += 1; }
    else value += char;
  }
  row.push(value); rows.push(row); return rows;
}
const base: LsDataChartProps = { title: '指标趋势', kind: 'line', labels: ['甲'], series: [{ label: '浏览量', values: [1] }] };
async function download(h: ReturnType<typeof harness>) {
  find(h.tree, 'Button').props.onClick();
  assert.equal(h.downloads.length, 1);
  return csvRows(await h.downloads[0].blob.text());
}

test('empty, non-finite and out-of-label values show Empty without initializing Chart.js', async () => {
  for (const props of [
    { ...base, labels: [] },
    { ...base, labels: ['甲', '乙', '丙'], series: [{ label: '无数据', values: [null, NaN, Infinity] }] },
    { ...base, series: [{ label: '越界数据', values: [null, 99] }] },
    { ...base, kind: 'scatter' as const, xValues: [Infinity] },
    { ...base, kind: 'scatter' as const, xValues: [10], series: [{ label: '专属 X 缺失', xValues: [null], values: [1] }] },
  ]) {
    const h = harness(props); await h.mount();
    assert.equal(find(h.tree, 'Empty').props.description, '暂无可展示的数据');
    assert.equal(allNodes(h.tree).some(node => name(node) === 'canvas'), false);
    assert.equal(h.imports, 0); assert.equal(h.configs.length, 0);
  }
});

test('loading uses Skeleton and error retains the exportable snapshot with an alert', async () => {
  const loading = harness({ ...base, loading: true }); await loading.mount();
  find(loading.tree, 'Skeleton'); assert.equal(loading.imports, 0);
  const error = harness({ ...base, error: '本次刷新失败，保留上次数据' }); await error.mount();
  assert.equal(find(error.tree, 'Alert').props.title, '本次刷新失败，保留上次数据');
  assert.equal(find(error.tree, 'Table').props.dataSource[0].value0, 1);
  assert.equal(error.configs.length, 1);
});

test('line chart preserves zero and missing-value gaps in graph, table and CSV', async () => {
  const h = harness({ ...base, unit: '次', labels: ['一', '二', '三', '四', '五', '六'], series: [{ label: '浏览', values: [0, null, NaN, Infinity, -Infinity, 12.345, 999] }] }, { reducedMotion: true });
  await h.mount();
  const dataset = h.configs[0].data.datasets[0];
  assert.deepEqual(plain(dataset.data), [0, null, null, null, null, 12.345]);
  assert.equal(dataset.spanGaps, false); assert.equal(h.configs[0].options.animation, false);
  const table = find(h.tree, 'Table').props;
  assert.deepEqual(plain(table.dataSource.map((row: any) => row.value0)), [0, null, null, null, null, 12.345]);
  assert.equal(table.columns[1].render(null), '—'); assert.equal(table.columns[1].render(0), '0次');
  assert.equal(table.columns[1].render(12.345), '12.35次');
  const csv = await download(h);
  assert.equal(csv.length, 7); assert.deepEqual(csv.slice(1).map(row => row[1]), ['0次', '—', '—', '—', '—', '12.35次']);
  h.cleanup(); assert.equal(h.destroyed, 1, 'unmount destroys the chart instance');
});

test('demonstration data is labeled in the view, accessible canvas and downloaded CSV', async () => {
  const h = harness({ ...base, demo: true }); await h.mount();
  assert.equal(text(find(h.tree, 'Tag')), '演示数据');
  assert.ok(find(h.tree, 'canvas').props['aria-label'].startsWith('演示数据。'));
  assert.equal(text(find(h.tree, 'Button')), '下载 CSV（演示数据）');
  const csv = await download(h);
  assert.equal(csv[0][0], '演示数据 · 日期/对象'); assert.equal(h.downloads[0].filename, '演示数据-指标趋势.csv');
  assert.deepEqual(Array.from(new Uint8Array(await h.downloads[0].blob.arrayBuffer()).slice(0, 3)), [239, 187, 191], 'Chinese CSV keeps its UTF-8 BOM');
  assert.equal(h.downloads[0].blob.type, 'text/csv;charset=utf-8');
  h.runTimers(); assert.deepEqual(h.revoked, [h.downloads[0].href], 'object URL is released after download');
});

test('bar charts cap plotting at ten rows and five series without truncating table or CSV', async () => {
  const labels = Array.from({ length: 12 }, (_, i) => `账号 ${i + 1}`);
  const series = Array.from({ length: 7 }, (_, i) => ({ label: `序列 ${i + 1}`, values: labels.map((_, j) => i * 100 + j) }));
  const h = harness({ ...base, kind: 'bar', labels, series, horizontal: true, stacked: true }); await h.mount();
  const config = h.configs[0];
  assert.equal(config.data.labels.length, 10); assert.equal(config.data.datasets.length, 5);
  assert.ok(config.data.datasets.every((dataset: any) => dataset.data.length === 10));
  assert.equal(config.options.indexAxis, 'y'); assert.equal(config.options.scales.x.stacked, true);
  const table = find(h.tree, 'Table').props;
  assert.equal(table.dataSource.length, 12); assert.equal(table.columns.length, 8); assert.equal(table.pagination.pageSize, 10);
  assert.ok(allNodes(h.tree).some(node => name(node) === 'p' && text(node).includes('图中展示前 10 项、最多 5 个序列')));
  const csv = await download(h);
  assert.equal(csv.length, 13); assert.equal(csv[12].length, 8); assert.equal(csv[12][7], '611');
});

test('scatter graph, table and CSV share effective X/Y; explicit series gaps never use global X', async () => {
  const h = harness({ ...base, kind: 'scatter', labels: ['甲', '乙', '丙', '丁'], xUnit: '美元', unit: '次', xValues: [10, 20, 30, 40], series: [
    { label: '局部', xValues: [1, null, Infinity, 4], values: [100, 200, 300, null] },
    { label: '共享', values: [8, 9, null, 0] },
    { label: '短序列', xValues: [7], values: [1, 2, 3, 4] },
  ] }); await h.mount();
  const datasets = h.configs[0].data.datasets;
  assert.deepEqual(plain(datasets.map((dataset: any) => dataset.data)), [[{ x: 1, y: 100 }], [{ x: 10, y: 8 }, { x: 20, y: 9 }, { x: 40, y: 0 }], [{ x: 7, y: 1 }]]);
  const table = find(h.tree, 'Table').props;
  assert.deepEqual(plain(table.columns.map((column: any) => column.dataIndex)), ['label', 'x0', 'value0', 'x1', 'value1', 'x2', 'value2']);
  assert.equal(table.dataSource[1].x0, null); assert.equal(table.dataSource[1].x1, 20); assert.equal(table.dataSource[1].x2, null);
  assert.equal(table.columns[1].render(table.dataSource[1].x0), '—');
  assert.equal(table.columns[3].render(table.dataSource[1].x1), '20美元');
  const csv = await download(h);
  assert.deepEqual(csv[0], ['日期/对象', '局部 · X (美元)', '局部 · Y (次)', '共享 · X (美元)', '共享 · Y (次)', '短序列 · X (美元)', '短序列 · Y (次)']);
  assert.deepEqual(csv[2], ['乙', '—', '200', '20', '9', '—', '2']);
  assert.equal(h.configs[0].options.plugins.tooltip.callbacks.label({ dataset: { label: '共享' }, parsed: { x: 20, y: 9 } }), '共享: 20美元 / 9次');
});

test('doughnut limits visible categories to five and keeps the complete accessible snapshot', async () => {
  const labels = ['甲', '乙', '丙', '丁', '戊', '己'];
  const h = harness({ ...base, kind: 'doughnut', labels, series: [{ label: '占比', values: [10, 20, 30, 5, 15, 20] }], percent: true }); await h.mount();
  assert.deepEqual(plain(h.configs[0].data.labels), labels.slice(0, 5));
  assert.deepEqual(plain(h.configs[0].data.datasets[0].data), [10, 20, 30, 5, 15]);
  assert.deepEqual(plain(h.configs[0].options.scales), {});
  assert.equal(find(h.tree, 'Table').props.dataSource.length, 6);
  assert.equal((await download(h))[6][1], '20%');
});

test('percent values, tooltip and table use the same unit and zero-based percent axis', async () => {
  const h = harness({ ...base, kind: 'bar', percent: true, labels: ['甲', '乙'], series: [{ label: '完成率', values: [0, 25] }] }); await h.mount();
  const config = h.configs[0];
  assert.equal(config.options.scales.y.beginAtZero, true); assert.equal(config.options.scales.y.max, 100);
  assert.equal(config.options.plugins.tooltip.callbacks.label({ dataset: { label: '完成率' }, raw: 25 }), '完成率: 25%');
  assert.equal(find(h.tree, 'Table').props.columns[1].render(25), '25%');
  assert.deepEqual((await download(h)).slice(1).map(row => row[1]), ['0%', '25%']);
});

test('CSV neutralizes user-controlled formulas including whitespace/control prefixes and quotes safely', async () => {
  const labels = ['=SUM(1,2)', ' +1', '\t@SUM(A1)', '\r\n-1', '"quoted",\nline', '普通文字'];
  const h = harness({ ...base, labels, series: [{ label: '\t=HYPERLINK("https://example.invalid")', values: [1, 2, 3, 4, 5, 6] }] }); await h.mount();
  const csv = await download(h);
  assert.equal(csv[0][1], '\'\t=HYPERLINK("https://example.invalid")');
  assert.deepEqual(csv.slice(1).map(row => row[0]), ["'=SUM(1,2)", "' +1", "'\t@SUM(A1)", "'\r\n-1", '"quoted",\nline', '普通文字']);
  assert.deepEqual(csv.slice(1).map(row => row[1]), ['1', '2', '3', '4', '5', '6']);
});

test('failed chart imports expose table fallback and canceled mounts never instantiate Chart.js', async () => {
  const failed = harness(base, { importFailure: true }); await failed.mount(); failed.render();
  assert.equal(find(failed.tree, 'Alert').props.title, '图表暂时无法显示，可在下方数据表查看完整数据。');
  assert.equal(find(failed.tree, 'Table').props.dataSource.length, 1);
  assert.equal(failed.configs.length, 0); assert.equal((await download(failed))[1][1], '1');
  await failed.update({ ...base, loading: true }); failed.render();
  find(failed.tree, 'Skeleton');
  assert.equal(allNodes(failed.tree).some(node => name(node) === 'Alert'), false, 'a new loading snapshot must not keep a stale chart-render error');
  const canceled = harness(base); canceled.render(); canceled.runEffects(); canceled.cleanup(); await canceled.settle();
  assert.equal(canceled.configs.length, 0);
});

test('query refresh updates the same graph without replaying its entrance and keeps the table in sync', async () => {
  const h = harness(base); await h.mount();
  assert.equal(h.configs[0].options.animation.duration, lsMotion.duration.enter);
  await h.update({ ...base, labels: ['新日期'], series: [{ label: '新指标', values: [20] }] });
  assert.equal(h.destroyed, 0); assert.equal(h.configs.length, 1);
  assert.deepEqual(h.updates, ['none']);
  assert.equal(h.configs[0].options.animation, false);
  assert.deepEqual(plain(h.configs[0].data.labels), ['新日期']);
  assert.deepEqual(plain(h.configs[0].data.datasets[0].data), [20]);
  assert.equal(find(h.tree, 'Table').props.dataSource[0].label, '新日期');
  assert.equal(find(h.tree, 'Table').props.dataSource[0].value0, 20);
  await h.update({ ...base, labels: [] });
  find(h.tree, 'Empty'); assert.equal(h.destroyed, 1); assert.equal(h.configs.length, 1, 'clearing a query snapshot destroys the previous graph without drawing a false zero');
});

test('changing reduced motion stops the active chart immediately without recreating it', async () => {
  const h = harness(base); await h.mount();
  h.setReducedMotion(true);
  h.render(); h.runEffects();
  assert.equal(h.stopped, 1, 'the current animation stops before the async Chart.js module resolves');
  assert.equal(h.configs[0].options.animation, false);
  await h.settle();
  assert.equal(h.configs.length, 1); assert.equal(h.destroyed, 0);
  assert.ok(h.updates.every(mode => mode === 'none'));
  h.setReducedMotion(false); await h.update(base);
  assert.equal(h.configs[0].options.animation, false, 'restoring motion does not replay an existing chart');
  await h.update({ ...base, loading: true });
  assert.equal(find(h.tree, 'Skeleton').props.active, true);
  h.setReducedMotion(true); await h.update({ ...base, loading: true });
  assert.equal(find(h.tree, 'Skeleton').props.active, false);
});

test('changing chart type releases the previous instance and charts inherit the shared type scale', async () => {
  const h = harness(base); await h.mount();
  await h.update({ ...base, kind: 'bar' });
  assert.equal(h.destroyed, 1); assert.equal(h.configs.length, 2);
  const font = h.configs[1].options.font;
  assert.equal(font.family, lsFonts.sans);
  assert.equal(font.size, lsTypography['body-small'].size);
  assert.equal(font.lineHeight, lsTypography['body-small'].line / lsTypography['body-small'].size);
  h.cleanup(); assert.equal(h.destroyed, 2);
});

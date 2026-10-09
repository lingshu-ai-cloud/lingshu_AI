import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/components/ui/LsCalendar.tsx', 'utf8');
const css = fs.readFileSync('src/components/ui/calendar.css', 'utf8');
const file = ts.createSourceFile('LsCalendar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const attributes = new Map<string, ts.JsxAttribute>();
function visit(node: ts.Node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'FullCalendar') {
    for (const property of node.attributes.properties) if (ts.isJsxAttribute(property)) attributes.set(property.name.getText(file), property);
  }
  ts.forEachChild(node, visit);
}
visit(file);
function expression(name: string) {
  const initializer = attributes.get(name)?.initializer;
  assert.ok(initializer && ts.isJsxExpression(initializer) && initializer.expression, `${name} should be an expression`);
  return initializer.expression.getText(file);
}
function evaluate(code: string, bindings: Record<string, unknown>) {
  const compiled = ts.transpileModule(`globalThis.value = (${code});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const context = vm.createContext(bindings);
  vm.runInContext(compiled, context);
  return context.value;
}

assert.equal(attributes.has('height'), false, 'a height=auto override would disable the time scroller even with bounded contentHeight');
for (const view of ['timeGridDay', 'timeGridWeek']) {
  assert.equal(evaluate(expression('contentHeight'), { view, timeGridHeight: 'clamp(320px, 65dvh, 720px)' }), 'clamp(320px, 65dvh, 720px)');
}
for (const view of ['dayGridMonth', 'listWeek', 'multiMonthYear']) {
  assert.equal(evaluate(expression('contentHeight'), { view, timeGridHeight: 'clamp(320px, 65dvh, 720px)' }), 'auto', 'non-time views retain natural content height');
}
assert.equal(attributes.get('scrollTime')?.initializer?.getText(file), '"08:00:00"');
assert.equal(attributes.get('slotMinTime')?.initializer?.getText(file), '"08:00:00"');
assert.equal(attributes.get('slotMaxTime')?.initializer?.getText(file), '"22:00:00"');
assert.ok(attributes.has('scrollTimeReset'));
assert.equal(evaluate(expression('allDaySlot'), { inputs: [{ allDay: false }] }), false, 'the empty all-day lane must not create a nested-looking calendar layer');
assert.equal(evaluate(expression('allDaySlot'), { inputs: [{ allDay: true }] }), true, 'real all-day events retain their lane');
assert.equal(attributes.has('dayMinWidth'), false, 'dayMinWidth requires scrollgrid at runtime and must not enter the Standard-only calendar');
assert.doesNotMatch(source, /import.*scrollgrid|import.*resource-time|import.*resource-day/);
assert.equal(evaluate(expression('eventMinHeight'), {}), 24);
assert.equal(evaluate(expression('eventShortHeight'), {}), 68);

type RenderNode = { type: unknown; props: Record<string, unknown> | null; children: any[] };
const render = evaluate(expression('eventContent'), {
  React: { createElement: (type: unknown, props: Record<string, unknown> | null, ...children: any[]): RenderNode => ({ type, props, children }) },
  CalendarThumbnail: 'CalendarThumbnail', SocialPlatformIcon: 'SocialPlatformIcon', calendarStatusLabels: { planned: '待执行' }, eventCardMode: 'media',
});
function nodes(node: RenderNode): RenderNode[] {
  return [node, ...node.children.filter(item => item && typeof item === 'object').flatMap(nodes)];
}
const event = { allDay: false, extendedProps: { item: { title: '新品短视频发布', start: '2026-10-09T08:00:00+08:00', status: 'planned', thumbnailUrl: '/thumbnail.jpg', platform: 'tiktok', accountName: '品牌账号' } } };
{
  const result = render({ event, view: { type: 'timeGridWeek' }, isShort: true, timeText: '08:00 - 08:30' }) as RenderNode;
  assert.match(String(result.props?.className), /is-short/);
  assert.ok(nodes(result).some(node => node.type === 'CalendarThumbnail'), 'short events retain a compact visual preview');
  assert.ok(nodes(result).some(node => node.type === 'strong'), 'short events retain the title');
}
{
  const result = render({ event, view: { type: 'timeGridDay' }, isShort: false, timeText: '08:00 - 09:00' }) as RenderNode;
  assert.ok(nodes(result).some(node => node.type === 'CalendarThumbnail'), 'sufficiently tall time events retain the thumbnail');
  assert.ok(nodes(result).some(node => node.type === 'SocialPlatformIcon'), 'sufficiently tall time events retain the platform');
  assert.ok(nodes(result).some(node => node.type === 'span' && node.children[0] === '品牌账号'));
  assert.equal(nodes(result).find(node => node.props?.className === 'ls-calendar-event-time')?.children[0], '08:00 - 09:00');
}
{
  const result = render({ event, view: { type: 'listWeek' }, isShort: false, timeText: '08:00' }) as RenderNode;
  assert.ok(nodes(result).some(node => node.type === 'CalendarThumbnail'), 'list events retain media previews');
}
assert.match(css, /\.ls-calendar-surface\s*\{[^}]*min-width: 0;[^}]*max-width: 100%/);
assert.match(css, /\.ls-calendar-event-content-timed[^}]*overflow: hidden/);
assert.match(css, /white-space: nowrap; text-overflow: ellipsis; line-height: var\(--ls-type-body-small-line\)/);
assert.match(css, /@container ls-calendar-slot \(max-height: 32px\)/, 'the smallest rendered segments suppress secondary time text instead of cropping the title');
assert.match(css, /\.ls-calendar-event-content-all-day[^}]*max-height: 44px/, 'all-day rows must remain compact even when a legacy event has a long title');
assert.match(css, /\.fc-timegrid-slot\s*\{[^}]*height:\s*48px/, 'hourly rows must be tall enough to make the day timeline readable');
assert.match(source, /<Drawer title="排期详情"/);
console.log('Calendar bounded time-grid height, 08:00 scrolling and compact event layout tests passed');

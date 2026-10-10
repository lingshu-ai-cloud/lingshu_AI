import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/components/ui/LsCalendar.tsx', 'utf8');
const css = fs.readFileSync('src/components/ui/calendar.css', 'utf8');
const file = ts.createSourceFile('LsCalendar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const attributes = new Map<string, ts.JsxAttribute>();
let inputsInitializer = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'inputs' && node.initializer) {
    inputsInitializer = node.initializer.getText(file);
  }
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
  assert.equal(evaluate(expression('contentHeight'), { view, fixedHeight: undefined, timeGridHeight: 'clamp(320px, 65dvh, 720px)' }), 'clamp(320px, 65dvh, 720px)');
}
for (const view of ['dayGridMonth', 'dayGridWeek', 'dayGridDay', 'listWeek', 'multiMonthYear']) {
  assert.equal(evaluate(expression('contentHeight'), { view, fixedHeight: undefined, timeGridHeight: 'clamp(320px, 65dvh, 720px)' }), 'auto', 'non-time views retain natural content height');
}
assert.equal(evaluate(expression('contentHeight'), { view: 'dayGridWeek', fixedHeight: 640, timeGridHeight: 520 }), 640, 'a composed calendar may opt into a stable workspace height');
assert.equal(attributes.get('scrollTime')?.initializer?.getText(file), '"08:00:00"');
assert.equal(attributes.get('slotMinTime')?.initializer?.getText(file), '"08:00:00"');
assert.equal(attributes.get('slotMaxTime')?.initializer?.getText(file), '"22:00:00"');
assert.ok(attributes.has('scrollTimeReset'));
assert.equal(evaluate(expression('allDaySlot'), { eventCardMode: 'compact', inputs: [{ allDay: false }] }), false, 'the empty all-day lane must not create a nested-looking calendar layer');
assert.equal(evaluate(expression('allDaySlot'), { eventCardMode: 'compact', inputs: [{ allDay: true }] }), true, 'real all-day events retain their lane in time-based calendars');
assert.equal(evaluate(expression('allDaySlot'), { eventCardMode: 'media', inputs: [{ allDay: true }] }), false, 'the fixed weekly media-card window must not expose a separate all-day lane');
assert.equal(attributes.has('dayMinWidth'), false, 'dayMinWidth requires scrollgrid at runtime and must not enter the Standard-only calendar');
assert.doesNotMatch(source, /import.*scrollgrid|import.*resource-time|import.*resource-day/);
assert.equal(evaluate(expression('eventMinHeight'), {}), 24);
assert.equal(evaluate(expression('eventShortHeight'), {}), 68);
assert.equal(attributes.get('eventOrder')?.initializer?.getText(file), '"start,id"', 'FullCalendar owns a deterministic start-time and stable-id event order');
assert.ok(attributes.has('eventOrderStrict'), 'event-card order must not be rearranged to improve visual compaction');
assert.equal(evaluate(expression('slotEventOverlap'), {}), false, 'time-grid cards must never overlap');
assert.ok(inputsInitializer, 'calendar inputs should be derived inside the shared component');
{
  const originalEvents = [
    { id: 'later', title: 'later', start: '2026-10-03', status: 'planned' },
    { id: 'same-z', title: 'same z', start: '2026-10-01', status: 'planned' },
    { id: 'same-a', title: 'same a', start: '2026-10-01', status: 'planned' },
  ];
  const inputs = evaluate(inputsInitializer, {
    events: originalEvents,
    onMoveEvent: undefined,
    useMemo: (factory: () => unknown) => factory(),
  }) as Array<{ id: string }>;
  assert.equal(Array.from(inputs, item => item.id).join(','), 'same-a,same-z,later', 'event inputs stay ordered by start time and stable id');
  assert.deepEqual(originalEvents.map(item => item.id), ['later', 'same-z', 'same-a'], 'calendar ordering must not mutate its caller data');

  const fullWeek = Array.from({ length: 18 }, (_, index) => ({
    id: `weekly-${String(18 - index).padStart(2, '0')}`,
    title: `weekly ${index + 1}`,
    start: `2026-10-${String(1 + (index % 7)).padStart(2, '0')}`,
    status: 'planned',
  }));
  const fullWeekInputs = evaluate(inputsInitializer, {
    events: fullWeek,
    onMoveEvent: undefined,
    useMemo: (factory: () => unknown) => factory(),
  }) as Array<{ id: string }>;
  assert.equal(fullWeekInputs.length, 18, 'the fixed weekly calendar must retain all 18 scheduled cards');
  assert.equal(new Set(Array.from(fullWeekInputs, item => item.id)).size, 18, 'each scheduled card keeps its stable FullCalendar key');
}
assert.equal(evaluate(expression('dayMaxEvents'), { eventCardMode: 'media', view: 'dayGridWeek' }), false, 'the weekly media-card flow must keep every scheduled card visible');
assert.equal(evaluate(expression('dayMaxEvents'), { eventCardMode: 'compact', view: 'dayGridMonth' }), 3, 'compact month views retain their native overflow control');

type RenderNode = { type: unknown; props: Record<string, unknown> | null; children: any[] };
const renderBindings = {
  React: { createElement: (type: unknown, props: Record<string, unknown> | null, ...children: any[]): RenderNode => ({ type, props, children }) },
  CalendarThumbnail: 'CalendarThumbnail', SocialPlatformIcon: 'SocialPlatformIcon', calendarStatusLabels: { planned: '待执行' }, eventCardMode: 'media', compact: false,
};
const render = evaluate(expression('eventContent'), renderBindings);
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
{
  const result = render({ event: { ...event, allDay: true }, view: { type: 'dayGridWeek' }, isShort: false, timeText: '' }) as RenderNode;
  assert.equal(result.props?.className, 'ls-calendar-event-content ls-calendar-event-content-media');
  assert.ok(nodes(result).some(node => node.type === 'CalendarThumbnail'), 'the weekly content-card view renders the thumbnail in the day cell');
  assert.ok(nodes(result).some(node => node.type === 'SocialPlatformIcon'), 'the weekly card retains its platform identity');
}
{
  const renderCompact = evaluate(expression('eventContent'), { ...renderBindings, compact: true });
  const item = { ...event.extendedProps.item, description: '重复标题不占第二块卡片区域' };
  const result = renderCompact({ event: { ...event, allDay: true, extendedProps: { item } }, view: { type: 'dayGridWeek' }, timeText: '' }) as RenderNode;
  assert.ok(nodes(result).some(node => node.type === 'CalendarThumbnail'), 'dense weekly cards retain their original-ratio media preview');
  assert.equal(nodes(result).find(node => node.type === 'strong')?.props?.title, item.title, 'compact titles remain available in full');
  assert.equal(nodes(result).some(node => node.props?.className === 'ls-calendar-event-summary'), false, 'dense cards avoid a duplicate description row');
}
assert.match(css, /\.ls-calendar-surface\s*\{[^}]*min-width: 0;[^}]*max-width: 100%/);
assert.match(css, /\.ls-calendar-event-content-timed[^}]*overflow: hidden/);
assert.match(css, /white-space: nowrap; text-overflow: ellipsis; line-height: var\(--ls-type-body-small-line\)/);
assert.match(css, /@container ls-calendar-slot \(max-height: 32px\)/, 'the smallest rendered segments suppress secondary time text instead of cropping the title');
assert.match(css, /\.ls-calendar-event-content-all-day[^}]*max-height: 44px/, 'all-day rows must remain compact even when a legacy event has a long title');
assert.match(css, /\.fc-timegrid-slot\s*\{[^}]*height:\s*48px/, 'hourly rows must be tall enough to make the day timeline readable');
assert.match(css, /\.ls-calendar-media-cards \.fc-daygrid-day-frame\s*\{[^}]*min-height:\s*560px/, 'the weekly card calendar must remain a large, stable workspace');
assert.match(css, /\.ls-calendar-card-media\s*\{[^}]*aspect-ratio:\s*9\/16/, 'portrait video space must be reserved before media resolves so loading cannot reorder cards');
assert.match(css, /\.ls-calendar-card-media img\s*\{[^}]*object-fit:\s*contain/, 'calendar covers preserve their entire original image instead of cropping portrait videos to landscape');
assert.match(css, /\.ls-calendar-compact \.ls-calendar-event-content-media\s*\{[^}]*grid-template-columns:\s*48px minmax\(0, 1fr\)/, 'dense cards place the portrait cover beside the text so a complete daily schedule fits the calendar window');
assert.match(css, /@container ls-calendar-card \(max-width: 112px\)/, 'very narrow date columns must stack their preview instead of crushing readable text');
assert.match(css, /\.ls-calendar\.ls-calendar-flush\s*\{\s*padding:\s*0/, 'composed home calendars can use the full available width');
assert.match(css, /\.ls-calendar-compact \.ls-calendar-toolbar\s*\{[^}]*flex-wrap:\s*nowrap[^}]*overflow-x:\s*auto/, 'dense controls stay in one locally scrollable row without page overflow');
assert.match(source, /!compact && <div className="ls-calendar-meta"/, 'dense calendars do not retain a standalone metadata row');
assert.match(css, /\.ls-calendar \.fc-daygrid-day-events\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*4px/, 'every FullCalendar day cell uses one dense native card flow');
assert.match(css, /\.ls-calendar-media-cards \.fc-daygrid-day-events\s*\{[^}]*gap:\s*6px/, 'media-first weekly cards retain accessible separation inside the same native flow');
assert.doesNotMatch(source, /\bMasonry\b/, 'calendar surfaces must stay on the FullCalendar layout engine');
assert.doesNotMatch(css, /(?:^|[;{]\s*)(?:column-count|columns)\s*:/m, 'calendar event flow must not use CSS multi-column layout');
assert.match(source, /const protectedThumbnailCache = new Map<string, Promise<Blob \| null>>\(\)/, 'duplicate protected covers must share one request and cached result');
assert.match(source, /const THUMBNAIL_TIMEOUT_MS = 4_000/, 'protected cover requests must use a short bounded timeout');
assert.match(source, /fetch\(src, \{ headers: authHeader\(\), signal: controller\.signal \}\)/, 'same-origin protected thumbnail routes must be normalized and fetched with the active tenant session');
assert.match(source, /if \(!blob\) protectedThumbnailCache\.delete\(src\)/, 'a transient protected-cover failure must not be cached permanently');
assert.match(source, /retryKey === 0[^]*?setRetryKey/, 'calendar cards must retry one cold thumbnail recovery automatically');
assert.match(source, /封面暂不可用/, 'cover failure copy must be neutral and truthful');
assert.match(source, /<Drawer title="排期详情"/);
console.log('Calendar bounded time-grid height, 08:00 scrolling and compact event layout tests passed');

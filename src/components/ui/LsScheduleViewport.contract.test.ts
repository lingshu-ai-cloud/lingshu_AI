import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/components/ui/LsScheduleViewport.tsx', 'utf8');
const css = fs.readFileSync('src/components/ui/scheduleViewport.css', 'utf8');
const publicationMatrix = fs.readFileSync('src/components/smartBusiness/MatrixPublicationSchedule.tsx', 'utf8');
const matrixEditor = fs.readFileSync('src/components/WeeklyMatrixEditor.tsx', 'utf8');

assert.match(source, /seenIdsRef = useRef\(new Set<string>\(\)\)/, 'stable schedule ids must not replay their entrance after rerender');
assert.match(source, /new IntersectionObserver\([\s\S]*\{ root, threshold: 0\.08 \}/, 'retained schedule matrices must reveal against their own scroll viewport');
assert.match(source, /usePrefersReducedMotion\(\)/, 'schedule reveal must follow the live operating-system motion preference');
assert.match(source, /new MutationObserver\(register\)/, 'new schedule cards must join the shared reveal behavior without remounting the page');
assert.match(css, /max-block-size:\s*clamp\(320px, calc\(100dvh - 280px\), 720px\)/, 'matrix schedules must stay inside one viewport-sized frame');
assert.match(css, /overflow:\s*auto/, 'matrix schedules own their horizontal and vertical overflow');
assert.match(css, /\.ls-schedule-sticky-header\s*\{[^}]*position:\s*sticky[^}]*inset-block-start:\s*0/s, 'matrix date headers remain visible while the schedule scrolls');
assert.match(css, /\.ls-schedule-reveal\s*\{[^}]*translateY\(8px\)[^}]*--ls-motion-enter[^}]*--ls-ease-enter/s, 'matrix cards use the same restrained enter motion as FullCalendar events');
assert.match(css, /prefers-reduced-motion: reduce[\s\S]*transition:\s*none !important/, 'reduced motion must make every matrix row immediately visible');
assert.doesNotMatch(css, /transition-delay/, 'matrix schedules must not stagger cards');
assert.match(publicationMatrix, /<LsScheduleViewport label="账号发布排期矩阵"/);
assert.match(publicationMatrix, /data-schedule-reveal-id=\{revealId\}/, 'publication rows use a stable account/content identity');
assert.match(matrixEditor, /<LsScheduleViewport label="账号与日期内容排期"/);
assert.match(matrixEditor, /data-schedule-reveal-id=\{row\.accountId\}/, 'editor rows use the stable account identity');

console.log('Bounded schedule viewport and one-time reveal contract passed');


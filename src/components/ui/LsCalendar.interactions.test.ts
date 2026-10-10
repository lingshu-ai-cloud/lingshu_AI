import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { calendarDayKey, type LsCalendarEvent } from '../../lib/calendarModel';

// Exercise the real async move handler without a browser or a CSS test loader.
const source = fs.readFileSync('src/components/ui/LsCalendar.tsx', 'utf8');
const start = source.indexOf('  const move = async ');
const end = source.indexOf('\n  return <div className=', start);
assert.ok(start >= 0 && end > start);
const script = ts.transpileModule(`${source.slice(start, end)}\nglobalThis.move = move;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function harness(confirm = true, rejectSave = false) {
  const saved: Array<{ id: string; start: string }> = [];
  const confirmations: Array<{ content: string; zIndex: number }> = [];
  const context: any = {
    Date, calendarDayKey,
    moveRef: { current: async (event: LsCalendarEvent, start: string) => {
      if (rejectSave) throw new Error('server_rejected');
      saved.push({ id: event.id, start });
    } },
    modal: { confirm: (options: { content: string; zIndex: number; onOk: () => void; onCancel: () => void }) => { confirmations.push(options); if (confirm) options.onOk(); else options.onCancel(); } },
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  return { saved, confirmations, move: (event: LsCalendarEvent, date: string): Promise<void> => context.move(event, date) };
}
const event: LsCalendarEvent = { id: 'post-1', title: '新品介绍', start: '2026-10-09T10:00:00+08:00', timeZone: 'Asia/Shanghai', status: 'planned', eventType: 'publish', editable: true };
{
  const h = harness();
  await h.move(event, '2026-10-09T11:30:00+08:00');
  assert.equal(h.confirmations.length, 0, 'same-day changes need no redundant confirmation');
  assert.deepEqual(h.saved, [{ id: 'post-1', start: '2026-10-09T03:30:00.000Z' }]);
}
{
  const h = harness(false);
  await assert.rejects(h.move(event, '2026-10-10T10:00:00+08:00'), /已取消/);
  assert.equal(h.confirmations.length, 1);
  assert.equal(h.saved.length, 0, 'canceling a cross-day move must never persist');
  assert.ok(h.confirmations[0].zIndex > 1000, 'confirmation must appear above the event details Drawer');
}
{
  const h = harness();
  await h.move({ ...event, status: 'working' }, '2026-10-09T11:30:00+08:00');
  assert.equal(h.confirmations.length, 1, 'moving an executing event requires confirmation even on the same day');
}
{
  const h = harness();
  await assert.rejects(h.move({ ...event, editable: false }, '2026-10-10T10:00:00+08:00'), /不允许/);
  await assert.rejects(h.move(event, 'invalid'), /有效时间/);
  assert.equal(h.saved.length, 0);
}
{
  const h = harness(true, true);
  await assert.rejects(h.move(event, '2026-10-10T10:00:00+08:00'), /server_rejected/);
  assert.equal(h.saved.length, 0, 'failed saves propagate so the authoritative original event remains visible');
}
console.log('Calendar move confirmation and failure-boundary tests passed');

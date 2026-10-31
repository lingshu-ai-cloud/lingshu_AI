import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAdReportPeriod, resolveAdReportWindow } from './adReportPeriod.js';

test('report period accepts valid presets or one account-local date', () => {
  assert.equal(parseAdReportPeriod({}), 7);
  assert.equal(parseAdReportPeriod({ days: '30' }), 30);
  assert.deepEqual(resolveAdReportWindow(parseAdReportPeriod({ date: '2026-10-27' }), '2026-10-30'), { since: '2026-10-27', until: '2026-10-27' });
  for (const query of [{ date: '2026-02-30' }, { date: '2026-10-27', days: '7' }, { days: ['7'] }, { extra: 'x' }]) assert.throws(() => parseAdReportPeriod(query));
  assert.throws(() => resolveAdReportWindow('2026-10-31', '2026-10-30'));
});

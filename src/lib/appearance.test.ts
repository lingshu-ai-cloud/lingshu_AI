import assert from 'node:assert/strict';
import { isShanghaiNight, readAppearancePreference, resolveAppearance, writeAppearancePreference } from './appearance';

assert.equal(isShanghaiNight(new Date('2026-10-22T11:59:59Z')), false);
assert.equal(isShanghaiNight(new Date('2026-10-22T12:00:00Z')), true);
assert.equal(isShanghaiNight(new Date('2026-10-22T23:59:59Z')), true);
assert.equal(isShanghaiNight(new Date('2026-10-23T00:00:00Z')), false);
assert.equal(resolveAppearance('auto', new Date('2026-10-22T12:00:00Z')), 'dark');
assert.equal(resolveAppearance('light', new Date('2026-10-22T12:00:00Z')), 'light');
assert.equal(resolveAppearance('dark', new Date('2026-10-23T00:00:00Z')), 'dark');

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
};
assert.equal(readAppearancePreference(storage), 'auto');
writeAppearancePreference('light', storage);
assert.equal(readAppearancePreference(storage), 'light');
values.set('lingshu:appearance', 'unknown');
assert.equal(readAppearancePreference(storage), 'auto');
console.log('Appearance schedule and preference contracts passed');

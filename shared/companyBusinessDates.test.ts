import test from 'node:test';
import assert from 'node:assert/strict';
import { companyEventDateSupported } from './companyBusinessDates.js';
test('event date uses an explicit original day while publication stays separate and missing dates cannot be guessed', () => {
 const source = { publishedAt: '2026-08-26', excerpt: '8月25日，PSTC创新科技大会在上海举行。' };
 assert.equal(companyEventDateSupported('2026-08-25', source), true);
 assert.equal(companyEventDateSupported('2026-08-26', source), true);
 assert.equal(companyEventDateSupported('2026-08-24', source), false);
 assert.equal(companyEventDateSupported('2026-08-25', { ...source, excerpt: '去年8月25日举行，近期再次报道。' }), false);
 assert.equal(companyEventDateSupported('2026-08-25', { ...source, excerpt: '计划明年8月25日举行。' }), false);
 assert.equal(companyEventDateSupported('2026-08-25', { ...source, excerpt: '2025年8月25日举行。' }), false);
 assert.equal(companyEventDateSupported('2025-08-25', { ...source, excerpt: '2025年8月25日举行。' }), true);
 assert.equal(companyEventDateSupported('2026-02-30', { ...source, excerpt: '2月30日' }), false);
 assert.equal(companyEventDateSupported('2026-08-25', { ...source, excerpt: '2026-08-25正式举行。' }), true);
});

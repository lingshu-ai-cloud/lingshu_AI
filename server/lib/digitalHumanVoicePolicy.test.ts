import assert from 'node:assert/strict';
import { resolveDigitalHumanVoicePolicy } from './digitalHumanVoicePolicy.js';

const base = { allShotsUseSamePerson: true, mixedWithLocalMaterial: false, personVoiceAvailable: true, personVoiceAuthorized: true, brandVoiceAvailable: true };
assert.equal(resolveDigitalHumanVoicePolicy({ ...base, requested: 'smart' }).resolved, 'person');
assert.equal(resolveDigitalHumanVoicePolicy({ ...base, requested: 'smart', mixedWithLocalMaterial: true }).resolved, 'brand');
assert.equal(resolveDigitalHumanVoicePolicy({ ...base, requested: 'brand' }).reason, 'user_selected_brand_voice');
const fallback = resolveDigitalHumanVoicePolicy({ ...base, requested: 'person', personVoiceAuthorized: false });
assert.deepEqual([fallback.resolved, fallback.fallback], ['brand', true]);
assert.throws(() => resolveDigitalHumanVoicePolicy({ ...base, requested: 'person', personVoiceAvailable: false, brandVoiceAvailable: false }), /不可用/);
console.log('digitalHumanVoicePolicy tests passed');

const assert = require('node:assert/strict');
const { cuesToAss } = require('./render.cjs');
const ass = cuesToAss([{ text: '口播', start: 0, end: 3 }, { text: '护理展示测试', start: 2, end: 4, kind: 'screen' }], 1080, 1920);
assert.match(ass, /Dialogue: 0,/);
assert.match(ass, /Dialogue: 1,0:00:02.00,0:00:04.00/);
assert.ok(ass.includes('{\\an8\\pos(540,230)}护理展示测试'));
assert.ok(!cuesToAss([{ text: '{\\pos(1,2)}恶意覆盖', start: 0, end: 1 }], 1080, 1920).includes('{\\pos(1,2)}'));
console.log('independent screen captions tests passed');

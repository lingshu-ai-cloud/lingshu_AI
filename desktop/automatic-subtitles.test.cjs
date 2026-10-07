const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { automaticSubtitleText, verifySubtitleFonts } = require('./automatic-subtitles.cjs');
const { fontsDirectory } = require('./automatic-subtitles.cjs');
const { cuesToAss, ffmpegPath } = require('./render.cjs');
const plain = text => text.replace(/\{[^}]*\}/g, '');
for (const text of ['保温十二小时，容量500毫升。', 'Lasts 12 hours with 500 ml capacity.', '产品介绍\\N保温12小时', '普通正文，没有参数。']) {
  const output = automaticSubtitleText(text);
  assert.equal(plain(output), text, 'styling must preserve spoken copy and line breaks');
  assert.ok((output.match(/5555FF/g) || []).length <= 1);
}
assert.match(automaticSubtitleText('保温十二小时'), /5555FF/);
assert.doesNotMatch(automaticSubtitleText('一款优秀产品'), /5555FF/);
assert.doesNotMatch(automaticSubtitleText('保温12小时', { autoEmphasis: false }), /5555FF/);
assert.doesNotMatch(automaticSubtitleText('{\\pos(1,2)}正文'), /\\pos/);
const cues = [{ start: 1, end: 3, text: '保温12小时' }, { start: 1, end: 3, text: '产品信息', kind: 'screen' }];
verifySubtitleFonts();
const ass = cuesToAss(cues, 1080, 1920);
assert.match(ass, /Dialogue: 0,0:00:01.00,0:00:03.00/);
assert.match(ass, /5555FF/);
assert.match(ass, /\\pos\(540,230\)\}产品信息/);
assert.doesNotMatch(cuesToAss(cues, 1080, 1920, '', 0, { autoEmphasis: false }), /5555FF/);
const styled = cuesToAss(cues, 1080, 1920, '', 0, { font: 'impact', color: '#facc15', outlineColor: '#111827', outlineWidth: 4, fontScale: 1.2, bottomRatio: .3, autoEmphasis: false });
assert.match(styled, /Style: Default,ZCOOL QingKe HuangYou,86,&H0015CCFA&,&H0015CCFA&,&H00271811&/);
assert.match(styled, /,4,1,2,92,92,576,1/);
assert.match(automaticSubtitleText('介绍冰川杯，保温12小时', { productNames: ['冰川杯'] }), /fnSmiley Sans/);
assert.doesNotMatch(automaticSubtitleText('介绍冰川杯，保温12小时', { productNames: ['冰川杯'] }), /5555FF/);
assert.match(automaticSubtitleText('介绍冰川\\N杯', { productNames: ['冰川杯'] }), /fnSmiley Sans/);
assert.equal(plain(automaticSubtitleText('介绍冰川\\N杯', { productNames: ['冰川杯'] })), '介绍冰川\\N杯');
assert.doesNotMatch(automaticSubtitleText('Coil', { productNames: ['oil'] }), /fnSmiley Sans/);
assert.match(automaticSubtitleText('Try Oil today', { productNames: ['oil'] }), /fnSmiley Sans/);
assert.match(ass, /fnZCOOL QingKe HuangYou/);
// A config name alone does not prove libass loaded the intended font.
// Exercise the real renderer to prevent silent platform font substitution.
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-font-test-'));
try {
  const subtitleFile = path.join(temporaryRoot, 'fonts.ass');
  fs.writeFileSync(subtitleFile, cuesToAss([
    { start: 0, end: 1, text: '正文。' },
    { start: 1, end: 2, text: '保温12小时。' },
    { start: 2, end: 3, text: '冰川杯。' },
  ], 1080, 1920, '', 3, { productNames: ['冰川杯'] }));
  const escape = value => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
  const render = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'verbose', '-f', 'lavfi', '-i',
    'color=s=1080x1920:r=1:d=3', '-vf', `subtitles='${escape(subtitleFile)}':fontsdir='${escape(fontsDirectory)}'`, '-f', 'null', '-'], { encoding: 'utf8' });
  assert.equal(render.status, 0, render.stderr);
  for (const face of ['SourceHanSansSC-Regular', 'ZCOOLQingKeHuangYou-Regular', 'SmileySans-Oblique'])
    assert.ok(render.stderr.split('\n').some(line => line.includes('fontselect:') && line.split(' -> ')[1]?.includes(face)), `renderer must select ${face}`);
} finally { fs.rmSync(temporaryRoot, { recursive: true, force: true }); }
console.log('automatic subtitle styling tests passed');

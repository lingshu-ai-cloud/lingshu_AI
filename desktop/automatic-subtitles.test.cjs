const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { automaticSubtitleText, verifySubtitleFonts } = require('./automatic-subtitles.cjs');
const { fontsDirectory } = require('./automatic-subtitles.cjs');
const { cuesToAss, ffmpegPath, subtitlePages, normalizeSubtitleCues } = require('./render.cjs');
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
assert.match(styled, /Style: Default,ZCOOL QingKe HuangYou,72,&H0015CCFA&,&H0015CCFA&,&H00271811&/);
assert.match(styled, /,4,1,2,92,92,576,1/);
assert.match(automaticSubtitleText('介绍冰川杯，保温12小时', { productNames: ['冰川杯'] }), /fnSmiley Sans/);
assert.doesNotMatch(automaticSubtitleText('介绍冰川杯，保温12小时', { productNames: ['冰川杯'] }), /5555FF/);
assert.match(automaticSubtitleText('介绍冰川\\N杯', { productNames: ['冰川杯'] }), /fnSmiley Sans/);
assert.equal(plain(automaticSubtitleText('介绍冰川\\N杯', { productNames: ['冰川杯'] })), '介绍冰川\\N杯');
assert.doesNotMatch(automaticSubtitleText('Coil', { productNames: ['oil'] }), /fnSmiley Sans/);
assert.match(automaticSubtitleText('Try Oil today', { productNames: ['oil'] }), /fnSmiley Sans/);
assert.match(ass, /fnZCOOL QingKe HuangYou/);
const frenchKaraoke = cuesToAss([{ start: 1, end: 3.4, text: 'Bonjour, tout le monde !', words: [
  { text: 'Bonjour', startMs: 1000, endMs: 1550 },
  { text: 'tout', startMs: 1600, endMs: 1950 },
  { text: 'le', startMs: 1980, endMs: 2150 },
  { text: 'monde', startMs: 2200, endMs: 3100 },
] }], 1080, 1920, '', 0, { autoEmphasis: false });
const frenchDialogue = frenchKaraoke.split('\n').find(line => line.startsWith('Dialogue: 0,'));
const frenchHighlights = frenchKaraoke.split('\n').filter(line => /^Dialogue: 1,[^,]+,[^,]+,WordHighlight,,/.test(line));
assert.match(frenchDialogue, /,Default,,/);
assert.doesNotMatch(frenchDialogue, /\\c&H66DFFF&/, 'the timed base sentence keeps the configured neutral color');
assert.doesNotMatch(frenchKaraoke, /\\kf|\\ko|\\K/, 'word emphasis never uses letter-sweep karaoke tags');
assert.equal(frenchHighlights.length, 4, 'every spoken French word receives one whole-word event');
assert.match(frenchHighlights[0], /\{\\alpha&H00&\}Bonjour,\{\\alpha&HFF&\}/, 'punctuation stays attached to the whole highlighted word');
assert.equal((frenchKaraoke.match(/^Dialogue: 0,/gm) || []).length, 1, 'word highlighting does not duplicate the sentence');
const germanKaraoke = cuesToAss([{ start: 0, end: 1.8, text: 'Sehr gute Qualität.', words: [
  { text: 'Sehr', start: 0, end: .35 }, { text: 'gute', start: .4, end: .85 }, { text: 'Qualität', start: .9, end: 1.6 },
] }], 1080, 1920, '', 0, { autoEmphasis: false });
assert.equal((germanKaraoke.match(/,WordHighlight,,/g) || []).length, 3, 'second-based alignment remains compatible');
const legacyDialogue = cuesToAss([{ start: 0, end: 1, text: 'Keine Zeitmarken.' }], 1080, 1920, '', 0,
  { autoEmphasis: false }).split('\n').find(line => line.startsWith('Dialogue: 0,'));
assert.match(legacyDialogue, /,Default,,/);
assert.doesNotMatch(legacyDialogue, /WordHighlight|\\kf/, 'legacy cues do not invent strong word timing');
const boxedKaraoke = cuesToAss([{ start: 0, end: 1, text: 'Clean subtitle', words: [
  { text: 'Clean', start: 0, end: .5 }, { text: 'subtitle', start: .5, end: 1 },
] }], 1080, 1920, '', 0, { boxed: true, outlineWidth: 8 });
assert.match(boxedKaraoke, /Style: WordHighlight,[^\n]*,1,2,0,2,/, 'the active word never inherits the base caption background plate');
const longChinese = '这款面膜采用独立包装，可以用于日常护肤，打开后按照说明均匀涂抹即可。';
const pages = subtitlePages(longChinese);
assert.ok(pages.length >= 3);
assert.equal(pages.flat().join(''), longChinese, 'semantic pagination preserves the exact spoken copy');
assert.ok(pages.every(page => page.length <= 2));
assert.ok(pages.every(page => page.join('').length <= 16), 'each Chinese screen stays within 8–16 glyphs');
const paged = normalizeSubtitleCues([{ start: 0, end: 8, text: longChinese }, { start: 0, end: 8, text: longChinese }]);
assert.equal(paged.map(cue => cue.text.replace(/\\N/g, '')).join(''), longChinese, 'identical source cues are rendered once');
assert.equal(paged[0].start, 0);
assert.equal(paged.at(-1).end, 8);
const semanticAss = cuesToAss([{ start: 0, end: 8, text: longChinese }], 1080, 1920);
assert.equal((semanticAss.match(/^Dialogue: 0,/gm) || []).length, pages.length);
assert.ok(semanticAss.split('\n').filter(line => line.startsWith('Dialogue: 0,')).every(line => (line.match(/\\N/g) || []).length <= 1));
const verticalDefault = cuesToAss([{ start: 0, end: 1, text: '普通字幕' }], 1080, 1920);
const horizontalDefault = cuesToAss([{ start: 0, end: 1, text: '普通字幕' }], 1920, 1080);
assert.match(verticalDefault, /Style: Default,[^,]+,60,/);
assert.match(horizontalDefault, /Style: Default,[^,]+,60,/);
for (const type of ['hook', 'reveal']) {
  const emphasizedAss = cuesToAss([{ start: 0, end: 2, text: '面膜采用独立包装' }], 1080, 1920, '', 2, {}, {
    profile: 'product_showcase', events: [{ id: type, type, startMs: 0, endMs: 2_000, text: '面膜采用独立包装',
      importance: 3, confidence: 1, source: 'transcript' }],
  });
  const spokenLines = emphasizedAss.split('\n').filter(line => line.startsWith('Dialogue: 0,'));
  assert.equal(spokenLines.length, 1, `${type} must not duplicate the spoken subtitle`);
  assert.match(spokenLines[0], /\\b1/, `${type} may use weight and color for emphasis`);
  assert.doesNotMatch(spokenLines[0], /\\fs|\\fsc[xy]/, `${type} keeps the ordinary subtitle size`);
}
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

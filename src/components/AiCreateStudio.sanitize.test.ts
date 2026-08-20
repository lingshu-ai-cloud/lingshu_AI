import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeStoryboardScript } from './AiCreateStudio.js';

const fiveSilentScenes = Array.from({ length: 5 }, (_, index) => `[${index * 4}-${(index + 1) * 4}s]
环境：测试环境${index + 1}
台词：无
字幕：无`).join('\n');

const sanitizedSilentScenes = sanitizeStoryboardScript(fiveSilentScenes, '');
assert.equal((sanitizedSilentScenes.match(/^台词：无$/gm) || []).length, 5);
assert.equal((sanitizedSilentScenes.match(/^字幕：无$/gm) || []).length, 5);

const englishSilentMarkers = sanitizeStoryboardScript(`[0-4s]
Voiceover: none
Subtitle: none
[4-8s]
Voiceover: no voiceover
Subtitle: no voiceover`, '');
assert.equal((englishSilentMarkers.match(/^Voiceover: (?:none|no voiceover)$/gm) || []).length, 2);
assert.equal((englishSilentMarkers.match(/^Subtitle: (?:none|no voiceover)$/gm) || []).length, 2);

const repeatedNarration = sanitizeStoryboardScript(`[0-4s]
台词：普通重复台词。
字幕：普通重复台词。
[4-8s]
台词：普通重复台词。
字幕：普通重复台词。`, '');
assert.equal((repeatedNarration.match(/^台词：普通重复台词。$/gm) || []).length, 1);

const studioSource = readFileSync(new URL('./AiCreateStudio.tsx', import.meta.url), 'utf8');
assert.match(studioSource, /application\/x-lingshu-material-id/, '素材拖放必须使用专用传输类型');
assert.match(studioSource, /activeFormalPreviewUrl[\s\S]*正式成片 · 连续 MP4/, '正式成片必须直接预览连续 MP4');
assert.doesNotMatch(studioSource, /方向不一致，已阻止加入/, '不同画幅素材应自动裁切，不应被硬拦截');
assert.doesNotMatch(studioSource, /当前草稿不能进入配音、选材或成片/, '人工审核流程不应保留旧硬拦截文案');
assert.match(studioSource, /qualityStatus: 'warning',[\s\S]*内容已手动修改，等待人工审核/, '人工修改后必须转入待审核状态');

console.log('AiCreateStudio storyboard sanitizer tests passed');

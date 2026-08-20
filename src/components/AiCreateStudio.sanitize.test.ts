import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveTranslatedVoiceover, sanitizeStoryboardScript } from './AiCreateStudio.js';

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

const englishVoiceover = `[0-3s] Buyers, how do you judge this risk?
[3-7s] Review the visible product before bulk order.`;
assert.equal(resolveTranslatedVoiceover(englishVoiceover, englishVoiceover, 'ar'), '', 'wrong-language Arabic result must be rejected');
assert.equal(resolveTranslatedVoiceover(englishVoiceover, `[0-3s] أيها المشترون، كيف تقيّمون هذه المخاطر؟
[3-7s] راجعوا المنتج الظاهر قبل الطلب بالجملة.`, 'ar').split('\n').length, 2);
assert.equal(resolveTranslatedVoiceover(englishVoiceover, `[0-3s] Compradores, ¿cómo evalúan este riesgo?`, 'es'), '', 'partial language result must not be accepted');

const studioSource = readFileSync(new URL('./AiCreateStudio.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(studioSource, /下方是<strong>口播音轨的句级时间/, 'removed sentence-timing helper panel must stay removed');
assert.match(studioSource, /voiceoverMode === 'ai' && hasAnyRequestedVoiceover/, 'one successful preview audio must allow material matching');
assert.match(studioSource, /application\/x-lingshu-material-id/, 'material drag/drop must use a dedicated transfer type');
assert.match(studioSource, /activeFormalPreviewUrl[\s\S]*正式成片 · 连续 MP4/, 'formal render preview must play the continuous MP4 instead of the stitched draft player');
assert.doesNotMatch(studioSource, /方向不一致，已阻止加入/, 'opposite-orientation clips must be center-cropped instead of blocked');

console.log('AiCreateStudio storyboard sanitizer tests passed');

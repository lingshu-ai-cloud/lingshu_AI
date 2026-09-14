import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatVoiceoverWithTimestamps,
  normalizeTranslatedVoiceover,
  parseStoryboardSlots,
  pendingClaimLocations,
  sanitizeStoryboardScript,
  selectCompleteVoiceoverSource,
  voiceoverDraftCoversSource,
} from './AiCreateStudio.js';

const specificationRangeStoryboard = `[0-5.8s]
景别：中近景
台词：LX-Press 支持 0–50 kN 精确力控。
字幕：LX-Press 支持 0–50 kN 精确力控。

[5.8-12.5s]
景别：特写
台词：重复定位精度为 ±0.01 mm。
字幕：重复定位精度为 ±0.01 mm。`;
const specificationRangeSlots = parseStoryboardSlots(specificationRangeStoryboard, 20);
assert.equal(specificationRangeSlots.length, 2, '产品规格范围不得被识别为额外的时间段');
assert.deepEqual(
  specificationRangeSlots.map(slot => [slot.start, slot.end]),
  [[0, 5.8], [5.8, 12.5]],
);

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
assert.equal(
  (repeatedNarration.match(/^台词：普通重复台词。$/gm) || []).length,
  2,
  '相同台词出现在不同时间段时必须逐镜保留，不能跨镜头去重',
);

const fiveSceneIndustrialStoryboard = `[0-7.3s]
素材：Assembly line
环境：以已选素材实际环境为准
景别：全景
运镜：固定
构图：仅呈现已选素材中实际可见的主体
镜头功能：素材事实展示
画面：按已选素材观察呈现：已选素材中的实际可见画面
配乐：低频工业节奏音效（脉冲式，每一拍），不压人声
台词：Buyers, how do you judge this risk?
字幕：Buyers, how do you judge this risk?

[7.4-15s]
素材：待匹配素材
环境：按后续补充素材的实际环境
景别：中景
运镜：缓慢横移左至右
构图：仅使用后续补充素材中的实际可见内容
镜头功能：待补素材
画面：待匹配素材；需补充能够证明本段信息的实际画面
配乐：延续低频脉冲，音量略降
台词：Review the visible product.
字幕：Review the visible product.

[15.1-22s]
素材：待匹配素材
环境：按后续补充素材的实际环境
景别：特写
运镜：静帧
构图：仅使用后续补充素材中的实际可见内容
镜头功能：待补素材
画面：待匹配素材；需补充能够证明本段信息的实际画面
配乐：暂停
台词：Check the visible evidence.
字幕：Check the visible evidence.

[22.1-29s]
素材：待匹配素材
环境：按后续补充素材的实际环境
景别：全景
运镜：固定
构图：仅使用后续补充素材中的实际可见内容
镜头功能：待补素材
画面：待匹配素材；需补充能够证明本段信息的实际画面
配乐：低频脉冲恢复
台词：Review the visible product.
字幕：Review the visible product.

[29.1-35s]
素材：待匹配素材
环境：按后续补充素材的实际环境
景别：居中文字
运镜：无
构图：仅使用后续补充素材中的实际可见内容
镜头功能：CTA
画面：待匹配素材；需补充能够证明本段信息的实际画面
配乐：轻提示音（单次）
台词：发送工件、节拍、缺陷样本或现场布局，预约一次 30 分钟英文方案诊断
字幕：发送工件、节拍、缺陷样本或现场布局，预约一次 30 分钟英文方案诊断`;

const completeIndustrialVoiceover = formatVoiceoverWithTimestamps(fiveSceneIndustrialStoryboard);
assert.deepEqual(completeIndustrialVoiceover.split('\n'), [
  '[0-7.3s] Buyers, how do you judge this risk?',
  '[7.4-15s] Review the visible product.',
  '[15.1-22s] Check the visible evidence.',
  '[22.1-29s] Review the visible product.',
  '[29.1-35s] 发送工件、节拍、缺陷样本或现场布局，预约一次 30 分钟英文方案诊断',
]);

const staleTwoLineVoiceover = `[0-7.3s] Buyers, how do you judge this risk?
[29.1-35s] 发送工件、节拍、缺陷样本或现场布局，预约一次 30 分钟英文方案诊断`;
assert.equal(voiceoverDraftCoversSource(completeIndustrialVoiceover, staleTwoLineVoiceover), false);
assert.equal(
  selectCompleteVoiceoverSource(fiveSceneIndustrialStoryboard, staleTwoLineVoiceover),
  completeIndustrialVoiceover,
  '旧的首尾两句草稿不得覆盖完整分镜口播',
);

const completeFrenchVoiceover = `[0-7.3s] Acheteurs, comment évaluez-vous ce risque ?
[7.4-15s] Examinez le produit visible.
[15.1-22s] Vérifiez les preuves visibles.
[22.1-29s] Examinez le produit visible.
[29.1-35s] Envoyez la pièce, le rythme, les défauts ou le plan du site, puis réservez un diagnostic de 30 minutes en anglais.`;
assert.equal(
  normalizeTranslatedVoiceover(completeIndustrialVoiceover, completeFrenchVoiceover, 'fr'),
  completeFrenchVoiceover,
  '同一源台词在不同镜头重复时，对应译文也应合法重复',
);

const productionDirections = `环境：仓库场景，绿色地面，纸箱印有“LX-VISION-EXPORT”和“CE”字样
构图：女子右臂抬起，设备 CE 标贴清晰可见
画面：包装上显示 1 set MOQ，镜头缓慢推进`;
assert.deepEqual(
  pendingClaimLocations(productionDirections, ''),
  [],
  '环境、构图和画面等制作描述不应被当作商业事实拦截',
);
assert.deepEqual(
  pendingClaimLocations('台词：设备通过 CE 认证，1 set MOQ。', '产品具备 CE 认证，支持 MOQ 1 set。'),
  [],
  '企业资料已经支持的口播声明应当通过',
);
assert.deepEqual(
  pendingClaimLocations('台词：产品已经获得 FDA 认证。', '产品具备 CE 认证。'),
  ['台词：产品已经获得 FDA 认证。'],
  '企业资料未支持的真实口播声明仍应被拦截',
);

const studioSource = readFileSync(new URL('./AiCreateStudio.tsx', import.meta.url), 'utf8');
const assistantSource = readFileSync(new URL('./GlobalAssistant.tsx', import.meta.url), 'utf8');
assert.match(studioSource, /application\/x-lingshu-material-id/, '素材拖放必须使用专用传输类型');
assert.match(studioSource, /activeFormalPreviewUrl[\s\S]*正式成片 · 连续 MP4/, '正式成片必须直接预览连续 MP4');
assert.doesNotMatch(studioSource, /方向不一致，已阻止加入/, '不同画幅素材应自动裁切，不应被硬拦截');
assert.doesNotMatch(studioSource, /当前草稿不能进入配音、选材或成片/, '人工审核流程不应保留旧硬拦截文案');
assert.doesNotMatch(studioSource, /Factory-direct home essentials|tiktokmademebuyit|You NEED this in 2026/, '发布文案和封面不得残留无关的家居演示默认值');
assert.match(
  studioSource,
  /qualityStatus: 'unreviewed',[\s\S]*内容已手动修改，等待基于企业中心资料重新审核/,
  '人工修改后必须失效旧质量结论并转入待审核状态',
);
assert.match(studioSource, /当前测试账号素材太少啦，换个创作模式再试试！/, '分镜校验失败时必须使用指定的灵小枢提示');
assert.match(studioSource, /announceRejectedStoryboard\(response\)/, 'AI 分镜返回后必须检查是否需要触发灵小枢提示');
assert.match(assistantSource, /lingshu-assistant-say/, '全局灵小枢必须监听一次性说话事件');
assert.match(assistantSource, /data-lingshu-assistant-speech="true"/, '灵小枢提示必须使用右侧统一气泡展示');

console.log('AiCreateStudio storyboard sanitizer tests passed');

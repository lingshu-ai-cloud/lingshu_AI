import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configuredEnterpriseLanguageCodes, pendingClaimLocations, sanitizeStoryboardScript } from './AiCreateStudio.js';

assert.deepEqual(
  configuredEnterpriseLanguageCodes({
    brand: { preferredLanguages: '英语、西班牙语、阿拉伯语、中文' },
    company: { primaryLanguages: '英语、俄语' },
  }),
  ['en', 'es', 'ar', 'zh', 'ru'],
  '内容创作必须合并首选输出语言和主要业务语言，不能因首选语言已有值而丢掉俄语',
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
assert.equal((repeatedNarration.match(/^台词：普通重复台词。$/gm) || []).length, 1);

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
assert.match(studioSource, /qualityStatus: 'warning',[\s\S]*内容已手动修改，等待人工审核/, '人工修改后必须转入待审核状态');
assert.match(studioSource, /当前测试账号素材太少啦，换个创作模式再试试！/, '分镜校验失败时必须使用指定的灵小枢提示');
assert.match(studioSource, /announceRejectedStoryboard\(response\)/, 'AI 分镜返回后必须检查是否需要触发灵小枢提示');
assert.match(studioSource, /可任意添加或删除/, '口播语种必须支持用户自由增删');
assert.match(studioSource, /lingshu:enterprise-profile-updated/, '内容创作必须实时接收企业中心语言更新');
assert.match(assistantSource, /lingshu-assistant-say/, '全局灵小枢必须监听一次性说话事件');
assert.match(assistantSource, /data-lingshu-assistant-speech="true"/, '灵小枢提示必须使用右侧统一气泡展示');

console.log('AiCreateStudio storyboard sanitizer tests passed');

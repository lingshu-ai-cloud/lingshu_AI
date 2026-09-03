import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const studio = readFileSync(new URL('./AiCreateStudio.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../lib/studioApi.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../../server/routes/studio.ts', import.meta.url), 'utf8');
const providerPayload = readFileSync(new URL('../../server/lib/digitalHumanJobPayload.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../../scripts/digital-human-local-worker.ts', import.meta.url), 'utf8');

function section(source: string, start: string, end: string, label: string) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `缺少${label}起始标记`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `缺少${label}结束标记`);
  return source.slice(startIndex, endIndex);
}

const batchRecoveryEffect = section(
  studio,
  "  useEffect(() => {\n    if (digitalHumanCapabilities?.available !== true) return;",
  "  useEffect(() => {\n    if (step !== 'preview') return;",
  '数字人批次恢复',
);
const autoRenderEffect = section(
  studio,
  "  useEffect(() => {\n    if (step !== 'preview') return;",
  "  useEffect(() => {\n    let cancelled = false;\n    void studioApi.digitalHumanCapabilities()",
  '数字人自动成片',
);
const activePollingEffect = section(
  studio,
  "  useEffect(() => {\n    const active = Object.entries(shotDigitalHumanBindings)",
  "  useEffect(() => {\n    let changed = false;",
  '数字人任务轮询',
);
const restoredCompletedOutputs = section(
  studio,
  '      const completedResults = await Promise.allSettled',
  '    return () => { cancelled = true; };\n  }, [projectId]);',
  '已完成数字人任务恢复',
);
const automaticMaterialPool = section(
  studio,
  '      const allVisuals = materials.filter(item => (',
  '      const compatiblePool = allVisuals.filter',
  '普通素材自动匹配池',
);
const activeMaterialCandidates = section(
  studio,
  '  const activeMaterialCandidates = useMemo(() => {',
  '  const assignWorkbenchMaterial = (clip: Clip) => {',
  '当前分镜普通素材推荐池',
);
const avatarLibrary = section(
  studio,
  '  const digitalHumanAvatars = materials.filter(item => (',
  '  const activeDigitalHumanAvatar = digitalHumanAvatars.find',
  '人物 IP 资产库',
);
const currentVoiceDraftLayout = section(
  studio,
  "            {step === 'script' && scriptStageTab !== 'theme' && (",
  "                {scriptStageTab === 'audio' && <section",
  '当前口播与翻译布局',
);
const digitalHumanBatchRoute = section(
  route,
  "studioRouter.post('/digital-human/job-batches'",
  "studioRouter.post('/digital-human/jobs'",
  '数字人多语言原子批次路由',
);

assert.match(studio, /await generateDigitalHumanBatchForShot\(slot, avatar\.id, readyLanguages\)/, '点击数字人分镜必须一次提交所有就绪语言');
assert.match(studio, /const selectedScriptLanguage = lang \|\| enterpriseScriptLanguage \|\| 'zh'/, '创作设置明确选择的输出语言必须优先于企业默认语言');
assert.match(studio, /adjustment\?: 'natural' \| 'expressive' \| 'alternate'/, '调整表现必须提交不同的生成语义');
assert.match(studio, /adjustment \? previousBinding\?\.motionClipIds/, '调整表现必须避免复用刚刚生成的动作');
assert.match(studio, /adjacentMotionClipIds[\s\S]{0,640}\.slice\(-1\)/, '相邻分镜只应避开上一镜最后一个动作，不能因多语种多句误选 CTA 动作');
assert.match(studio, /variationSeed: performanceRevision/, '表现调整版本必须进入表演计划和幂等签名');
assert.match(studio, /setStoryboardAssignments\(current => \(\{ \.\.\.current, \[digitalHumanLanguageKey\(slotId, language \|\| job\.language\)\]: resolution\.assignmentMaterialId! \}\)\)/, '合格输出必须按语言自动回填原分镜');
assert.match(studio, /status: 'stale'.+分镜口播、配音或时间区间已变化/s, '输入变化必须使旧输出失效');
assert.match(studio, /mediaModes\[slotId\] === 'digital'[\s\S]*assignments\[digitalHumanLanguageKey\(slotId, language\)\]/, '数字人分镜必须严格读取当前语言输出');
assert.match(studio, /const voiceAlignedEditForSlot[\s\S]{0,2200}resolveShotDigitalHumanSpeechSegment\([\s\S]{0,700}speech\.alignmentSource !== 'tts_cues'/, '含数字人的最终时间线必须跟随当前语言真实 TTS cue');
assert.match(studio, /voiceAlignedEditForSlot\(clip, slot, activeVoiceLang\)/, '当前语言预览时间线必须使用语音对齐分镜时长');
assert.match(studio, /voiceAlignedEditForSlot\(clip, slot, language\)/, '批量多语言成片必须分别使用各语言语音对齐分镜时长');
assert.doesNotMatch(studio, /assignments\[digitalHumanLanguageKey\(slotId, language\)\]\s*\|\|\s*assignments\[slotId\]/, '数字人未完成时不得回退普通素材');
assert.match(studio, /shotMediaModes\[slot\.id\] !== 'digital' && !lockedAssignments\[slot\.id\]/, '自动匹配不得把普通素材填入数字人分镜');
assert.match(studio, /const assignments = \{ \.\.\.storyboardAssignments, \.\.\.lockedAssignments, \.\.\.matchedAssignments \}/, '自动匹配必须保留多语言数字人输出');
assert.match(studio, /preset: binding\.performancePreset \|\| 'commerce'/, '完成任务的签名校验必须保留表现预设');
assert.match(studio, /variationSeed: binding\.performanceRevision \|\| 0/, '完成任务的签名校验必须保留表现修订版本');
assert.match(studio, /if \(!outputOnly\) \{\s*setStepIdx/, '后台批量合成不得强制跳转预览页');
assert.match(studio, /existing\.inputSignature === combination\.inputSignature/, '旧成片只能在完整输入签名一致时复用');
assert.match(studio, /人物口播 · 数字人/, '入口应位于现有素材匹配区域');
assert.doesNotMatch(studio, /新增数字人创作步骤/, '不得增加新的创作步骤');

// 浏览器只创建服务端批次；全部语言子任务先持久化，GPU Worker 再串行领取。
assert.match(studio, /studioApi\.createDigitalHumanShotBatch\(\{[\s\S]*?variants: prepared\.map\(item => item\.request\)/, '前端必须一次把全部语言变体发给服务端');
assert.match(studio, /setShotDigitalHumanBindings\(current => \{[\s\S]*?for \(const item of prepared\)[\s\S]*?status: 'submitting'/, '请求前必须原子标记全部语言正在提交');
assert.match(batchRecoveryEffect, /readyLanguages\.some\(language => \{[\s\S]*?return !binding \|\| binding\.status === 'stale'/, '刷新恢复必须发现未提交或过期语言');
assert.match(batchRecoveryEffect, /generateDigitalHumanBatchForShot\(pendingSlot, avatar\.id, readyLanguages\)/, '恢复路径也必须整分镜批量提交');
assert.doesNotMatch(batchRecoveryEffect, /generateDigitalHumanForShot\(/, '批次恢复不得再依赖逐语言浏览器串行创建');
assert.doesNotMatch(studio, /Promise\.all\(\s*renderScriptLanguages\(\)\.map\(code => generateDigitalHumanForShot/, '人物切换等三语入口不得使用 Promise.all 并发 GPU 任务');

// 成功回填只重算业务源指纹；不得在刷新/轮询时用默认 planner 覆盖显式 profile。
assert.match(activePollingEffect, /digitalHumanBindingFreshness\(slot, effectiveLanguage, binding\)/, '轮询完成输出时必须计算当前业务源指纹');
assert.match(activePollingEffect, /resolveShotDigitalHumanResult\(\{[\s\S]*?currentSourceFingerprint:[\s\S]*?jobInputSignature:[\s\S]*?jobSourceFingerprint:/, '轮询必须同时校验业务源与服务端规范任务签名');
assert.match(activePollingEffect, /if \(resolution\.assignmentMaterialId\)/, '只能回填门禁返回的当前输出');
assert.match(restoredCompletedOutputs, /currentSourceFingerprint/, '恢复历史 completed 任务时也必须计算当前业务源指纹');
assert.match(restoredCompletedOutputs, /jobInputSignature: job\.inputSignature[\s\S]*?jobSourceFingerprint: job\.sourceFingerprint/, '恢复路径不得盲目接受陈旧输出');
assert.match(studio, /if \(binding\.sourceFingerprint\) return \{ speech, currentSourceFingerprint \};[\s\S]*?const legacyPlan = planDigitalHumanPerformance/, '只有无源指纹的 P0 旧 binding 可执行默认 planner 兼容校验');
assert.match(studio, /inputSignature: result\.job!\.inputSignature![\s\S]*?sourceFingerprint,[\s\S]*?performanceSignature: result\.job!\.performanceSignature/, '新 binding 必须保存服务端规签名及双层审计签名');
assert.match(studio, /const jobsByLanguage = new Map/, '批次响应不得再把服务端规范签名当成客户端相关 ID');

// 自动成片只在 preview 阶段启动，且所有目标语言的所有数字人分镜都必须就绪。
assert.match(autoRenderEffect, /if \(step !== 'preview'\) return;/, '后台自动成片不得在 preview 之前启动');
assert.match(autoRenderEffect, /languages\.every\(code => digitalSlotIds\.every/, '自动成片必须等待所有语言的所有数字人分镜');
assert.match(autoRenderEffect, /status === 'completed'[\s\S]*?storyboardAssignments\[digitalHumanLanguageKey\(slotId, code\)\]/, '每个语言分镜必须完成并已按语言回填');
assert.match(studio, /const primaryGeneratesVideo = contentMode === 'video' && step === 'preview'/, '手动成片主操作也只能在 preview 阶段生效');

// 失败、待复核和输入已变更的任务必须在当前语言上显示可见重试入口。
assert.match(studio, /\['failed', 'review', 'stale', 'cancelled'\]\.includes\(activeShotDigitalHuman\.status\)[\s\S]*?重新生成当前语言/, '异常或陈旧的当前语言任务必须可见重试');

// 主脚本更新后，当前布局必须能只同步当前语种，不要强迫重跑全部翻译。
assert.match(currentVoiceDraftLayout, /voiceDraftStaleLangs\.includes\(activeVoiceLang\)[\s\S]{0,1200}retryVoiceDraft\(activeVoiceLang\)/, '过期语种必须复用现有的单语种重试逻辑');
assert.match(currentVoiceDraftLayout, /disabled=\{voiceDraftPendingLangs\.includes\(activeVoiceLang\)\}/, '单语种同步期间必须禁止重复提交');

// 普通选材池与分镜推荐池都不得混入人物母片、动作片或数字人生成结果。
for (const [pool, variable, label] of [
  [automaticMaterialPool, 'item', '普通素材自动匹配池'],
  [activeMaterialCandidates, 'clip', '当前分镜普通素材推荐池'],
] as const) {
  assert.match(pool, new RegExp(`${variable}\\.folder !== 'presenter'`), `${label}必须排除人物库`);
  assert.match(pool, new RegExp(`${variable}\\.assetRole !== 'avatar_master'`), `${label}必须排除人物母片`);
  assert.match(pool, new RegExp(`${variable}\\.assetRole !== 'avatar_motion_clip'`), `${label}必须排除人物动作片`);
  assert.match(pool, new RegExp(`${variable}\\.assetRole !== 'generated_clip'`), `${label}必须排除数字人生成结果`);
}

// 人物库是生产资产库：未明确 productionReady=true 或授权不合格的项目均不可见。
assert.match(avatarLibrary, /item\.assetRole === 'avatar_master'/, '人物库只能显示人物母片');
assert.match(avatarLibrary, /item\.productionReady === true/, '人物库只能显示明确完成生产准备的资产');
assert.doesNotMatch(avatarLibrary, /item\.productionReady !== false/, 'productionReady 缺失不能被当作生产就绪');
assert.match(avatarLibrary, /item\.rightsStatus === 'commercial_cleared'/, '人物库只能显示商用授权已清算资产');
assert.match(avatarLibrary, /avatarIdsWithMotionPack\.has\(item\.id\)/, '人物库只能显示表演包完整的资产');

assert.match(api, /storyboardSlotId\?: string/, 'API必须支持分镜任务');
assert.match(api, /createDigitalHumanShotBatch:[\s\S]{0,500}digital-human\/job-batches/, 'API 必须提供逐分镜多语言批次提交');
assert.match(route, /post\('\/digital-human\/job-batches'/, '服务端必须提供原子批次端点');
assert.match(route, /if \(createdJobs\.length \|\| migratedReusableJob\) persistDigitalHumanJobs\(\[\.\.\.persistedJobs, \.\.\.createdJobs\]\)/, '全部子任务与可证明的旧签名迁移必须在一次文件替换中持久化');
assert.match(route, /batchId, tenantId, projectId, storyboardSlotId/, '子任务必须保留 batch\/project\/slot 恢复键');
assert.match(route, /storyboardSlotId = String\(req\.query\.storyboardSlotId/, '列表接口必须支持按分镜恢复');
assert.equal((digitalHumanBatchRoute.match(/persistDigitalHumanJobs\(/g) || []).length, 1, '批次路由只能有一个持久化边界');
const atomicPersistIndex = digitalHumanBatchRoute.indexOf('persistDigitalHumanJobs(');
for (const validationMarker of ['digitalHumanAssetSupportsUsage(avatar, usagePurpose)', 'validDigitalHumanVoiceoverUrl(', 'motionMaterials.some(item => !item)']) {
  assert.ok(digitalHumanBatchRoute.indexOf(validationMarker) > -1 && digitalHumanBatchRoute.indexOf(validationMarker) < atomicPersistIndex, `${validationMarker} 必须在原子持久化前完成`);
}
assert.doesNotMatch(digitalHumanBatchRoute, /active\.length >= 2/, '批次不得被旧的两个在途任务限制拆断');
assert.match(digitalHumanBatchRoute, /for \(const job of createdJobs\) void refreshDigitalHumanJob\(job\.id, req\)/, 'direct provider 也必须在持久化后由服务端启动所有子任务');
assert.match(route, /maxConcurrentJobs: config\.pullWorkerEnabled \? 1 : 2/, '8GB Pull Worker 的能力接口必须明确单 GPU 串行');
assert.match(route, /pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION/, '能力接口必须公开当前P1缓存边界');
assert.match(providerPayload, /audioSegment: \{ startSeconds: job\.audioStartSeconds, endSeconds: job\.audioEndSeconds \}/, '灵枢必须把分镜音频区间传给Worker');
assert.match(route, /commercialDigitalHumanGate\(providerQuality \|\| \{\}, job\.mode, job\.provider, \{[\s\S]{0,320}validationScope:[\s\S]{0,180}expectedDurationSeconds:/, '灵枢必须按模型族和分镜范围执行商业二次门禁');
assert.match(worker, /const trimArgs = segment \? \['-ss'/, 'Worker必须截取分镜音频');
assert.match(worker, /jobs\.find\(item => item\.externalJobId === externalJobId\)/, 'Worker必须支持幂等提交');
assert.match(route, /item\.avatarId === \(avatar\.avatarId \|\| avatar\.id\)/, '动作素材必须属于所选人物');
assert.match(route, /item\.assetRole === 'avatar_motion_clip'[\s\S]{0,260}digitalHumanAssetSupportsUsage\(item, usagePurpose\)/, '动作素材必须同时通过生产准备和当前用途授权校验');
assert.match(route, /AVATAR_RIGHTS_NOT_CLEARED/, '人物母片授权不完整时必须阻止生产');
assert.match(route, /avatar\.productionReady !== true[\s\S]{0,220}AVATAR_NOT_PRODUCTION_READY/, '未明确标记为生产就绪的人物母片必须在创建任务时被拒绝');
assert.match(route, /AVATAR_USAGE_NOT_CLEARED/, '人物授权范围不覆盖请求用途时必须阻止生产');
assert.match(route, /digital-human\/avatars\/preferred[\s\S]{0,1000}digitalHumanAssetSupportsUsage\(preferred, 'internal_preview'\)/, '首选人物不得绕过严格生产和内部预览授权门禁');
assert.match(studio, /usagePurpose: 'internal_preview'/, '现有创作界面必须明确标记本轮为内部预览');
assert.match(route, /item\.assetRole !== 'avatar_motion_clip'/, '人物资产列表不得把动作片段误当成独立人物');
assert.ok((studio.match(/pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION/g) || []).length >= 5,
  '前端创建、源指纹和旧 binding 兼容必须共用P1版本常量');
assert.doesNotMatch(studio, /digital-human-v2-p0/, '前端不得继续生成P0缓存身份');
assert.match(route, /parseDigitalHumanPipelineVersion\(raw\?\.pipelineVersion\)[\s\S]{0,300}UNSUPPORTED_PIPELINE_VERSION/,
  '批量路由必须在持久化前拒绝旧pipeline版本');

console.log('shot digital human workflow contract tests passed');

import { newDigitalHumanRequirements } from '../lib/digitalHumanPlan';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import ShotProductionPanel from './ShotProductionPanel.js';
import { newShotProduction, EMPTY_DEFAULTS, shotFingerprint } from '../lib/shotProduction.js';

const props = {
  context: '', title: '第一镜', defaults: EMPTY_DEFAULTS, materials: [], products: [], jobs: [],
  reason: '优先真实素材', error: '', busy: false, configured: false, costPerSecond: null,
  onChange: () => {}, onClose: () => {}, onNarration: () => {}, onDefaults: async () => {}, onApplyDefaultsToUnlocked: () => {}, onGenerate: () => {},
  onSavePlan: () => {}, onAi: () => {}, onShoot: () => {}, onMaterial: () => {}, onAdopt: () => {}, onRefresh: () => {},
};
test('failed media verification is not presented as a usable completed candidate', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} shot={{ ...newShotProduction(), source: 'avatar' }} jobs={[{ id: 'j1', projectId: 'p1', shotId: 's1', assemblyId: 'a1', fingerprint: 'f1', status: 'pending', error: '供应商已生成，但下载或技术检查未通过：缺少音轨', createdAt: '', updatedAt: '' }]} />);
  assert.match(html, /已生成 · 待入库核验/);
  assert.match(html, /下载或技术检查未通过/);
  assert.doesNotMatch(html, /候选已就绪/);
});
test('AI storyboard candidate can be adopted only after its own quality review', () => {
  const base = { ...newShotProduction('产品放在桌面，镜头轻推'), source: 'ai' as const, contentType: 'product' as const };
  const shot = { ...base, candidates: [{ id: 'ai-v1', materialId: 'generated-1', source: 'ai' as const,
    fingerprint: shotFingerprint(base, '', 'shot-1'), createdAt: '2026-10-03T00:00:00Z' }] };
  const pending = renderToStaticMarkup(<ShotProductionPanel {...props} shotId="shot-1" shot={shot} aiCandidateApproved={() => false} />);
  assert.match(pending, /创意画面.*待人工验收/);
  assert.match(pending, /disabled=""[^>]*>采用 \/ 恢复/);
  const approved = renderToStaticMarkup(<ShotProductionPanel {...props} shotId="shot-1" shot={shot} aiCandidateApproved={id => id === 'generated-1'} />);
  assert.doesNotMatch(approved, /创意画面.*待人工验收/);
  assert.match(approved, /<button type="button" class="text-accent disabled:opacity-40">采用 \/ 恢复<\/button>/);
});
test('unconfigured enterprise presenter cannot be billed and keeps only presenter-appropriate routes', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} capabilityReason="服务端未配置 HEYGEN_API_KEY" shot={{ ...newShotProduction('hello'), source: 'avatar' }} />);
  for (const label of ['人物表达 · 企业人物口播', '企业人物生成', '使用已有企业人物视频', '安排真人拍摄', '连续旁白', '使用镜头原声', '此镜无声', '人物与产品分屏', '产品主画面', '用一句话编辑当前镜头']) assert.ok(html.includes(label));
  assert.match(html, /仅规划 · HeyGen 人物口播/);
  assert.match(html, /未配置或未启用/);
  assert.match(html, /服务端未配置 HEYGEN_API_KEY/);
  assert.match(html, /提交结果未知时只核对原任务，不自动再次生成/);
  assert.match(html, /预算预占是调用准入控制，不等于供应商最终账单/);
  assert.match(html, /未配置单价，费用以供应商账单为准/);
  assert.match(html, /请生成并采用当前数字人镜头候选/);
  assert.match(html, /<form class="my-3 flex flex-wrap gap-2"/);
  assert.doesNotMatch(html, /<form class="[^"]*\bhidden\b/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>生成新候选/);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /全片数字人默认设置/);
  assert.match(html, /人物授权、供应商映射和参考资产可在当前内容制作页完成/);
  assert.doesNotMatch(html, /人物参考素材ID|HeyGen人物\/Look ID|保存人物资产|\+新增人物/);
});

test('missing presenter can be completed inside the current shot and returns to the same shot', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} defaults={{ ...EMPTY_DEFAULTS, presenters: [] }} onCreatePresenter={async () => ({ id:'new-person',name:'New',avatarId:'',voiceId:'',authorized:true,supportsAlpha:false })} shot={{ ...newShotProduction('口播'), source:'avatar', contentType:'enterprise_presenter' }} />);
  assert.match(html, /在当前分镜添加人物/);
  assert.match(html, /保存后会自动回填本镜头/);
  assert.match(html, /企业知识库仅用于后续集中管理/);
  assert.doesNotMatch(html, /请先到企业设置/);
});

test('existing presenter can reuse its uploaded photo in the Ark enrollment flow', () => {
  const presenter = { id:'person-1',name:'销售',avatarId:'',voiceId:'',authorized:true,supportsAlpha:false,referenceMaterialIds:['portrait-1'],authorizationConfirmation:{subjectAdultConfirmed:true,arkProcessingAuthorized:true} };
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} onEnrollArkPresenter={async()=>({id:'e1',presenterId:'person-1',state:'needs_verification',verificationUrl:'',error:'',assetUri:''})} defaults={{...EMPTY_DEFAULTS,presenters:[presenter]}} materials={[{id:'portrait-1',name:'销售正脸',type:'image',url:'/photo.jpg'}]} shot={{...newShotProduction('请联系我'),source:'avatar',presenterId:'person-1',digitalHuman:{workflow:'viral_replication',method:'reenact',contentConfirmed:false,action:'挥手',scene:'工厂',preserve:'人物身份'}}} />);
  assert.match(html,/销售正脸/);
  assert.match(html,/选择已有本人人物照片/);
  assert.match(html,/提交人物资料并开始认证/);
  assert.doesNotMatch(html,/方舟图片 Asset ID/);
  assert.match(html,/人物图片尚未完成方舟 Active 认证/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>生成新候选/);
});

test('new reenact presenter starts with one video, one photo and explicit Ark consent', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} onEnrollArkPresenter={async()=>({id:'e1',presenterId:'person-1',state:'needs_verification',verificationUrl:'',error:'',assetUri:''})} shot={{...newShotProduction('请联系我'),source:'avatar',digitalHuman:{workflow:'viral_replication',method:'reenact',contentConfirmed:false,action:'挥手',scene:'工厂',preserve:'人物身份'}}} />);
  assert.match(html,/人物认证视频/);
  assert.match(html,/人物认证照片/);
  assert.match(html,/方舟进行真人验证/);
  assert.doesNotMatch(html,/方舟图片 Asset ID/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>提交人物资料并开始认证/);
});

test('UGC and product shots expose their own routes without enterprise digital-human controls', () => {
  const ugc = renderToStaticMarkup(<ShotProductionPanel {...props} shot={{ ...newShotProduction('以前这一步全靠人工'), contentType: 'ugc', source: 'ai', ugcRole: '工厂采购人员', ugcScenario: '工厂走道手持自拍', ugcExpression: '近景手持、自然轻晃' }} />);
  for (const label of ['人物表达 · 素人 UGC／行业角色', 'AI 行业角色', '已授权达人／泛素材', '角色设定', '工厂采购人员', '参考视频只用于提取镜头节奏']) assert.match(ugc, new RegExp(label));
  assert.doesNotMatch(ugc, /数字人镜头要求|选择企业人物|生成透明人物层/);

  const product = renderToStaticMarkup(<ShotProductionPanel {...props} shot={{ ...newShotProduction(), contentType: 'product', source: 'material' }} />);
  for (const label of ['产品特写', '企业素材／可用参考片段', 'AI 补镜', '本镜头不需要人物出镜']) assert.match(product, new RegExp(label));
  assert.doesNotMatch(product, /数字人镜头要求|选择企业人物|AI 行业角色/);
});
test('capability errors remain visible even when avatar generation is not configured', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} error="能力检查失败，请稍后重试" shot={{ ...newShotProduction('hello'), source: 'avatar' }} />);
  assert.match(html, /role="alert"[^>]*>能力检查失败，请稍后重试/);
});
test('locked shot disables editing and changed candidates cannot be adopted', () => {
  const shot = { ...newShotProduction(), locked: true, candidates: [{ id: 'old', materialId: 'm', source: 'material' as const, fingerprint: 'old', createdAt: '' }] };
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} shot={shot} />);
  assert.match(html, /<fieldset disabled=""/);
  assert.match(html, /要求已变化/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>采用 \/ 恢复/);
});

test('renders sentence-aligned opening middle and ending video frames', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} shot={newShotProduction('真实口播')} shotDuration={4}
    preview={{ id: 'v1', name: '候选视频', type: 'video', url: '/candidate.mp4', duration: 4 }}
    keyframeCues={[{ start: 0, end: 4, text: '真实口播', frames: [{ position: '开头', time: 0.08 }, { position: '中间', time: 2 }, { position: '结尾', time: 3.92 }] }]} />);
  assert.match(html, /逐句关键帧检查/);
  for (const label of ['句 1 开头', '句 1 中间', '句 1 结尾', '真实口播']) assert.match(html, new RegExp(label));
});

test('reference replication stays in the same shot panel and cannot submit a talking generation', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} configured shot={{ ...newShotProduction('目标口播'), source: 'avatar', digitalHuman: {
    workflow: 'viral_replication', method: 'replace', contentConfirmed: true, action: '挥手', scene: '展厅', preserve: '产品与背景',
    reference: { videoUrl: '/reference.mp4', start: 1, end: 5, originalText: '原片口播', derivativeAuthorized: true, derivativeAuthorizationEvidence: '企业自有拍摄 AUTH-1' },
  } }} />);
  for (const label of ['素材加工', '爆款裂变', '原片对照', '原片口播', '目标口播', '必须保留的内容', '请先补齐资料']) assert.ok(html.includes(label));
  assert.match(html, /源视频派生授权依据/);
  assert.match(html, /当前方案暂不可执行，请按上方提示补齐并确认镜头要求/);
  assert.equal((html.match(/请选择已授权的企业人物/g) || []).length, 1);
  assert.match(html, /<button[^>]*disabled=""[^>]*>生成新候选/);
});

test('reference candidate review shows source and candidate side by side with sentence seeking', () => {
  const base = { ...newShotProduction('本片口播'), source: 'avatar' as const, digitalHuman: {
    workflow: 'viral_replication' as const, method: 'replace' as const, contentConfirmed: true, action: '挥手', scene: '展厅', preserve: '产品与背景',
    reference: { videoUrl: '/reference.mp4', start: 1, end: 5, originalText: '原片口播', derivativeAuthorized: true, derivativeAuthorizationEvidence: '企业自有拍摄 AUTH-1',
      cues: [{ id: 'cue-1', start: 1, end: 2.5, originalText: '原片第一句', targetText: '本片第一句', shotIds: ['s1'] }] },
  } };
  const shot = { ...base, candidates: [{ id: 'candidate-1', materialId: 'candidate-video', source: 'avatar' as const, fingerprint: shotFingerprint(base, ''), jobId: 'execution-1', createdAt: '' }] };
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} shot={shot} materials={[{ id: 'candidate-video', name: '候选一', type: 'video', url: '/candidate.mp4' }]} />);
  for (const label of ['原片与候选对照', '原片参考片段', '数字人候选片段', '原片 · 1.0–5.0 秒', '定位句 1', '原片第一句', '本片第一句']) assert.match(html, new RegExp(label));
});

test('reenact keeps external reference in analysis-only mode until model-input authorization exists', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} shot={{ ...newShotProduction('重新演绎口播'), source: 'avatar', digitalHuman: {
    workflow: 'viral_replication', method: 'reenact', replicationMode: 'direct_reference', contentConfirmed: true, action: '参考动作', scene: '重新生成场景', preserve: '信息作用',
    reference: { videoUrl: '/reference.mp4', start: 0, end: 4, originalText: '参考口播', derivativeAuthorized: false },
  } }} />);
  assert.match(html, /允许将源视频直接提交给生成模型/);
  assert.match(html, /当前仅用于结构分析与方案预览/);
  assert.doesNotMatch(html, /源视频模型输入授权依据/);
});

test('viral reenact defaults to sentence first-frame reconstruction without source-video model authorization', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} shot={{ ...newShotProduction('本片逐句口播'), source: 'avatar', digitalHuman: {
    workflow: 'viral_replication', method: 'reenact', contentConfirmed: true, action: '复用动作意图', scene: '重建画面', preserve: '节奏与镜头功能',
    reference: { videoUrl: '/reference.mp4', start: 0, end: 4, originalText: '原片口播', derivativeAuthorized: false,
      cues: [{ id: 'cue-1', start: 0, end: 2, originalText: '原片第一句', targetText: '本片第一句', shotIds: ['s1'] }] },
  } }} />);
  assert.match(html, /逐句首帧重建 · 默认/);
  assert.match(html, /爆款原视频不会直接提交给视频生成模型/);
  assert.match(html, /首帧 0\.00 秒 · 待重建目标人物首帧/);
  for (const step of ['按口播逐句切分原片并提取首帧', '将每句首帧重建为目标企业人物', '按目标口播逐句生成短视频', '按实际片长拼接并自动检测']) assert.match(html, new RegExp(step));
  assert.doesNotMatch(html, /允许将源视频直接提交给生成模型/);
});

test('sentence replication exposes per-cue evidence and failed-only repair', () => {
  const shot = { ...newShotProduction('本片逐句口播'), source: 'avatar' as const, digitalHuman: {
    workflow: 'viral_replication' as const, method: 'reenact' as const, replicationMode: 'sentence_first_frame' as const,
    contentConfirmed: true, action: '复用动作意图', scene: '重建画面', preserve: '节奏与镜头功能',
    reference: { videoUrl: '/reference.mp4', start: 0, end: 4, originalText: '原片口播', derivativeAuthorized: false,
      cues: [{ id: 'cue-1', start: 0, end: 2, originalText: '原片第一句', targetText: '本片第一句', shotIds: ['s1'], personShot: true, sourceFirstFrame: { time: 0, materialId: 'frame-1' } }] },
  } };
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} shot={shot} sentenceResult={{ cues: shot.digitalHuman.reference.cues, materialId: 'joined-1', sentenceJobId: 'job-1', state: 'completed', failedCueIds: ['cue-1'], cueQuality: [{ cueId: 'cue-1', kind: 'person_generated', state: 'failed', checks: [
    { key: 'media', status: 'passed', evidence: '720x1280' }, { key: 'identity', status: 'pending', evidence: '等待独立身份模型' },
    { key: 'motion', status: 'failed', evidence: '停帧差异 30%' }, { key: 'product_brand_text', status: 'pending', evidence: '等待产品检测' },
    { key: 'background', status: 'passed', evidence: 'SSIM 0.92' }, { key: 'audio_sync', status: 'pending', evidence: '等待口型确认' },
    { key: 'reuse_risk', status: 'passed', evidence: '相似度 0.7' },
  ] }] }} />);
  for (const label of ['逐镜自动检测', '自动检测未通过会标记失败', '停帧差异 30%', '等待独立身份模型', '只重做失败镜头']) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /identity验收结果|验收证据|保存该镜头验收/);
  assert.match(html, /返工将复用其他已通过镜头/);
});

test('sentence reconstruction offers an optional Qwen draft only after source frames and billing confirmation', () => {
  const shot = { ...newShotProduction('本片逐句口播', 'person-1'), source: 'avatar' as const, digitalHuman: {
    workflow: 'viral_replication' as const, method: 'reenact' as const, replicationMode: 'sentence_first_frame' as const,
    contentConfirmed: true, action: '复用动作意图', scene: '重建画面', preserve: '节奏与镜头功能',
    reference: { videoUrl: '/reference.mp4', start: 0, end: 2, originalText: '原片口播', derivativeAuthorized: false,
      cues: [{ id: 'cue-1', start: 0, end: 2, originalText: '原片第一句', targetText: '本片第一句', shotIds: ['s1'], personShot: true, sourceFirstFrame: { time: 0, materialId: 'frame-1' }, draftFirstFrame: { provider: 'qwen' as const, materialId: 'draft-1', imageUrl: '/draft.jpg', state: 'ready' as const, estimatedCostCny: .22 } }] },
  } };
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} onGenerateSentenceDrafts={() => {}} shot={shot} />);
  assert.match(html, /生成千问构图草稿（可选）/);
  assert.match(html, /千问草稿已生成 · 预计 ¥0\.22/);
  assert.match(html, /仅供构图比较，最终 Seedance 输入仍由 Seedream 生成/);
});

test('digital-human plan is saved inside the storyboard shot instead of becoming a content entry', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} configured savedPlan={{
    id: 'plan-1', projectId: 'p1', assemblyId: 'a1', shotId: 's1', fingerprint: 'f1',
    pipeline: 'pipeline_1',
    workflow: 'material_processing', method: 'talking', presenterId: 'person-1', presenterAssetVersion: 2,
    candidateTools: ['heygen'], estimatedCostCny: 1.25, state: 'ready', executable: true, provider: 'heygen', reasons: [], steps: [],
    routeDecision: { targetDurationSeconds: 6, budgetLimitCny: 8, requiredPreservation: ['identity', 'product'], selectedTool: 'runway_act_two', evaluations: [
      { tool: 'runway_kling_motion', compatible: false, reasons: ['不能保证保留：product'], qualityInspection: false, estimatedCostCny: 3 },
      { tool: 'runway_act_two', compatible: true, reasons: [], qualityInspection: true, estimatedCostCny: 6 },
    ] },
    createdAt: '', updatedAt: '',
  }} shot={{ ...newShotProduction('目标口播'), source: 'avatar' }} />);
  assert.match(html, /数字人分镜/);
  assert.match(html, /保存制作方案/);
  assert.match(html, /方案已保存 · 人物资产 V2 · 可制作 · 预计 ¥1\.25/);
  for (const label of ['选路依据', '目标 6 秒', '预算上限 ¥8.00', '必须保留：identity、product', '淘汰 · runway_kling_motion', '不能保证保留：product', '符合 · runway_act_two', '预计 ¥6.00']) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /创建数字人项目|数字人内容类型/);
});

test('content-agent suggestion is visible as an unexecuted per-shot route', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} sourcePlan={{
    sourceTaskId: 'task-1', sourceTaskVersion: '7', candidateTools: ['runway_seedance', 'runway_act_two'], executionState: 'preview_only',
  }} shot={{ ...newShotProduction('目标口播'), source: 'avatar', digitalHuman: {
    workflow: 'viral_replication', method: 'reenact', contentConfirmed: false, action: '开场挥手', scene: '展厅', preserve: '产品与节奏',
  } }} />);
  assert.match(html, /Content Agent 分镜建议/);
  assert.match(html, /来自任务版本 7/);
  assert.match(html, /runway_seedance、runway_act_two/);
  assert.match(html, /数字人生成模型/);
  for (const provider of ['Kling', 'SD', 'Runway', '自有模型']) assert.match(html, new RegExp(provider));
  assert.match(html, /该建议尚未执行/);
});

test('technical details distinguish executable talking from planning-only reference tools', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} configured toolCapabilities={[
    { id: 'heygen', label: 'HeyGen 人物口播', execution: true, reason: '服务端已配置' },
    { id: 'runway_seedance', label: 'Seedance 参考人物重演', execution: false, reason: '通用视频接口不支持人物保留约束', executionProfile: { maxDurationSeconds: 10, preserves: ['identity', 'background'], qualityInspection: true, estimatedCostCnyPerSecond: 0.8 } },
    { id: 'runway_kling_motion', label: 'Kling 参考动作生成', execution: false, reason: '仅规划', executionProfile: { maxDurationSeconds: 5, preserves: ['identity'], qualityInspection: false } },
  ]} shot={{ ...newShotProduction('目标口播'), source: 'avatar' }} />);
  assert.match(html, /可执行 · HeyGen 人物口播/);
  assert.match(html, /仅规划 · Seedance 参考人物重演/);
  assert.match(html, /通用视频接口不支持人物保留约束/);
  assert.match(html, /最长 10 秒 · 保留 identity、background · 含自动视觉代理检查 · 约 ¥0\.80\/秒/);
  assert.match(html, /最长 5 秒 · 保留 identity · 需人工视觉验收/);
  assert.match(html, /人物身份与产品仍按逐项质检结论准入/);
});

test('advanced settings expose full-video defaults and an explicit bulk apply action', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} shot={{ ...newShotProduction('目标口播'), source: 'avatar' }} />);
  assert.match(html, /新分镜默认声音/);
  assert.match(html, /新分镜默认布局/);
  assert.match(html, /应用到当前视频全部未锁定数字人分镜/);
});

test('execution record distinguishes estimated cost from reconciled supplier cost', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} toolCapabilities={[{ id: 'heygen', label: 'HeyGen 人物口播', execution: true, costReconciliation: true, reason: '已启用' }]} executions={[{
    id: 'execution-1', planId: 'plan-1', jobId: 'job-1', projectId: 'p1', assemblyId: 'a1', shotId: 's1', fingerprint: 'f1',
    tool: 'heygen', provider: 'heygen', model: null, presenterAssetVersion: 2, state: 'completed', externalTaskId: 'remote-1', materialId: 'material-1',
    candidateOutput: { materialId: 'material-1', objectKey: 'materials/tenant-a/candidate.mp4', contentSha256: 'b'.repeat(64), objectEtag: 'candidate-v1' },
    inputSnapshot: { narration: '目标口播', language: 'zh', ratio: '9:16', targetDurationSeconds: 3, sound: 'voiceover', presenterId: 'person-1', presenterAssetVersion: 2, presenterReferenceMaterialIds: [], presenterInput: { materialId: 'portrait-1', objectKey: 'tenant-a/portrait-1', type: 'image' as const, objectEtag: 'person-v2' }, voiceMapping: { avatarId: 'avatar-1', voiceId: 'voice-1' }, productId: '', productMaterialId: '', backgroundMaterialId: '', requirements: null, derivativeAuthorization: { evidence: '企业自有拍摄 AUTH-1', confirmedAt: '2026-09-24T08:00:00.000Z' }, modelInputAuthorization: { evidence: '企业自有拍摄 AUTH-1', confirmedAt: '2026-09-24T08:00:00.000Z' }, audioSegment: { segmentId: 'segment-1234567890', checksumSha256: 'abcdef1234567890', start: 0.5, duration: 2 } },
    estimatedCostCny: 1.2, actualCostCny: null, costStatus: 'awaiting_invoice', costSourceRef: null, error: '', createdAt: '', updatedAt: '',
    routeSteps: [{ id: 'source_alignment', label: '确认人物与口播输入', actor: 'system', tool: null, dependsOn: [], status: 'completed' }],
    quality: { state: 'manual_review', updatedAt: '', checks: [
      { key: 'media_import', label: '媒体入库', mode: 'automatic', status: 'passed', evidence: 'material:1' },
      { key: 'identity', label: '人物一致', mode: 'manual', status: 'pending', evidence: null },
    ] },
  }]} shot={{ ...newShotProduction('目标口播'), source: 'avatar' }} />);
  assert.match(html, /执行记录 · heygen · 已生成/);
  assert.match(html, /执行依赖/);
  assert.match(html, /已完成 · 确认人物与口播输入/);
  assert.match(html, /预计费用：¥1\.20 · 实际费用：待账单对账/);
  assert.match(html, /驱动音频 · 片段 segment-12 · 0\.50–2\.50 秒 · SHA-256 abcdef123456/);
  assert.match(html, /实际人物输入 · 图片 · 素材 portrait-1 · 对象 tenant-a\/portrait-1 · 版本 person-v2/);
  assert.match(html, /候选输出证据 · 对象 materials\/tenant-a\/candidate.mp4 · SHA-256 b{16} · 版本 candidate-v1/);
  assert.match(html, /原片派生与商业授权 · 企业自有拍摄 AUTH-1 · 服务端确认 2026-09-24T08:00:00.000Z/);
  assert.doesNotMatch(html, /原片模型输入授权/);
  assert.match(html, /核对供应商账单/);
  assert.doesNotMatch(html, /实际费用：¥1\.20/);
  assert.match(html, /已通过 · 媒体入库（系统）/);
  assert.match(html, /待检查 · 人物一致（人工）/);
  assert.match(html, /逐项人工验收/);
  assert.match(html, /aria-label="人物一致验收结果"/);
  assert.match(html, /<option value=""[^>]*>请选择<\/option><option value="passed">通过<\/option><option value="failed">不通过<\/option>/);
  assert.match(html, /aria-label="候选修改意见"/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>保存逐项人工验收/);
  assert.match(html, /当前要求与人物版本已使用 1\/3 次生成名额/);
});

test('reenact execution exposes its model-input authorization evidence', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} executions={[{
    id: 'execution-reenact', planId: 'plan-reenact', jobId: 'job-reenact', projectId: 'p1', assemblyId: 'a1', shotId: 's1', fingerprint: 'f1',
    tool: 'runway_seedance', provider: 'runway', model: 'seedance', presenterAssetVersion: 1, state: 'pending', externalTaskId: 'remote-reenact', materialId: null,
    inputSnapshot: { narration: '目标口播', language: 'zh', ratio: '9:16', targetDurationSeconds: 4, sound: 'voiceover', presenterId: 'person-1', presenterAssetVersion: 1, presenterReferenceMaterialIds: [], voiceMapping: null, productId: '', productMaterialId: '', backgroundMaterialId: '', requirements: null, modelInputAuthorization: { evidence: '素材合同 LIC-9', confirmedAt: '2026-09-24T09:00:00.000Z' } },
    estimatedCostCny: 2, actualCostCny: null, costStatus: 'estimated', costSourceRef: null, error: '', createdAt: '', updatedAt: '',
    quality: { state: 'pending', updatedAt: '', checks: [] },
  }]} shot={{ ...newShotProduction('目标口播'), source: 'avatar' }} />);
  assert.match(html, /原片模型输入授权 · 素材合同 LIC-9 · 服务端确认 2026-09-24T09:00:00.000Z/);
  assert.doesNotMatch(html, /原片派生与商业授权/);
});

test('per-shot attempt cap disables another paid candidate', () => {
  const execution = {
    id: 'execution-cap', planId: 'plan-cap', jobId: 'job-cap', projectId: 'p1', assemblyId: 'a1', shotId: 's1', fingerprint: 'f1',
    tool: 'heygen' as const, provider: 'heygen' as const, model: null, presenterAssetVersion: 1, state: 'failed' as const, externalTaskId: 'remote-cap', materialId: null,
    estimatedCostCny: 1, actualCostCny: null, costStatus: 'estimated' as const, costSourceRef: null, error: 'failed', createdAt: '', updatedAt: '',
    quality: { state: 'failed' as const, updatedAt: '', checks: [] },
  };
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} maxAttemptsPerShot={1} executions={[execution]} shot={{ ...newShotProduction('目标口播', 'person-1'), source: 'avatar' }} />);
  assert.match(html, /当前要求与人物版本已使用 1\/1 次生成名额/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>已达本镜头生成上限/);
  const rejectedHtml = renderToStaticMarkup(<ShotProductionPanel {...props} maxAttemptsPerShot={1} executions={[{ ...execution, externalTaskId: null, submissionOutcome: 'rejected' as const }]} shot={{ ...newShotProduction('目标口播', 'person-1'), source: 'avatar' }} />);
  assert.match(rejectedHtml, /当前要求与人物版本已使用 0\/1 次生成名额/);
  assert.match(rejectedHtml, /供应商未创建任务 · 本次不计入生成上限/);
  assert.doesNotMatch(rejectedHtml, />已达本镜头生成上限<\/button>/);
});

test('adopted execution shows its durable storyboard assembly version', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} executions={[{
    id: 'execution-adopted', planId: 'plan-1', jobId: 'job-1', projectId: 'p1', assemblyId: 'a1', shotId: 's1', fingerprint: 'f1',
    tool: 'heygen', provider: 'heygen', model: null, presenterAssetVersion: 1, state: 'completed', externalTaskId: 'remote-1', materialId: 'material-1',
    estimatedCostCny: null, actualCostCny: null, costStatus: 'awaiting_invoice', costSourceRef: null, error: '', createdAt: '', updatedAt: '',
    adoption: { candidateId: 'candidate-1', materialId: 'material-1', assemblyVersion: 'assembly-version-1', adoptedAt: '' },
    routeSteps: [{ id: 'assembly', label: '确认候选并填入分镜', actor: 'user', tool: null, dependsOn: ['manual_review'], status: 'completed' }],
    quality: { state: 'accepted', updatedAt: '', checks: [] },
  }]} shot={{ ...newShotProduction('目标口播'), source: 'avatar' }} />);
  assert.match(html, /已完成 · 确认候选并填入分镜/);
  assert.match(html, /已填入分镜 · 候选 candidate-1 · 装配版本 assembly-version-1/);
});

test('digital human modal offers only video twin and photo talking before mode selection', () => {
  const html = renderToStaticMarkup(<ShotProductionPanel {...props} salesConfiguration shot={{ ...newShotProduction('口播'), source: 'avatar', contentType: 'enterprise_presenter' }} />);
  assert.match(html, /视频分身/); assert.match(html, /照片口播/);
  assert.doesNotMatch(html, /人脸替换|人物替换|人物与场景重构|企业人物资产|创建并绑定/);
});

test('viral photo talking uses Seedream and HeyGen without Ark Assets binding', () => {
  const shot = { ...newShotProduction('口播'), digitalHuman: { ...newDigitalHumanRequirements(), presenterMode: 'photo_talking' as const, workflow: 'viral_replication' as const, method: 'reenact' as const } };
  const viral = renderToStaticMarkup(<ShotProductionPanel {...props} onCreatePresenter={async () => ({id:'test',name:'test',avatarId:'',voiceId:'',authorized:true,supportsAlpha:false})} salesConfiguration viralReplication shot={shot} />);
  assert.match(viral, /Seedream/); assert.match(viral, /上传企业人物照片/); assert.doesNotMatch(viral, /方舟人物认证|asset:\/\/asset-/);
  assert.match(viral, /创建或导入 HeyGen 照片形象/);
  assert.match(viral, /在这里管理企业人物资产/);
  const free = renderToStaticMarkup(<ShotProductionPanel {...props} salesConfiguration viralReplication={false} shot={shot} />);
  assert.match(free, /HeyGen/); assert.doesNotMatch(free, /上传照片并创建口播形象|创建并绑定/); assert.doesNotMatch(free, /方舟人物认证|Seedream/);
});

test('viral photo preview requires target frame, script, and an explicit cost limit',()=>{
  const shot={...newShotProduction('Hello','photo'),source:'avatar' as const,digitalHuman:{...newDigitalHumanRequirements(),presenterMode:'photo_talking' as const,workflow:'viral_replication' as const,method:'reenact' as const,contentConfirmed:true,reference:{videoUrl:'/source.mp4',start:0,end:2,originalText:'Hello',derivativeAuthorized:false,cues:[{id:'cue',start:0,end:2,originalText:'Hello',targetText:'Hello',shotIds:['s1'],personShot:true,targetFirstFrame:{materialId:'target',imageUrl:'/target.jpg',state:'ready' as const}}]}}};
  const defaults={...EMPTY_DEFAULTS,presenters:[{id:'photo',name:'Photo',avatarId:'',voiceId:'voice',authorized:true,supportsAlpha:false,authorizationConfirmation:{subjectAdultConfirmed:true,heygenProcessingAuthorized:true},arkCertification:{projectName:'default',materialId:'portrait',assetUri:'asset://asset-test',assetType:'image' as const,status:'active' as const}}]};
  const before=renderToStaticMarkup(<ShotProductionPanel {...props} defaults={defaults} shot={shot} salesConfiguration viralReplication />);
  assert.match(before,/alt="目标人物首帧"/);assert.match(before,/<button[^>]*disabled=""[^>]*>自动生成照片口播素材/);assert.match(before,/照片口播费用上限/);
  const after=renderToStaticMarkup(<ShotProductionPanel {...props} defaults={defaults} shot={{...shot,digitalHuman:{...shot.digitalHuman,targetFramesConfirmed:true}}} salesConfiguration viralReplication />);
  assert.match(after,/<button[^>]*disabled=""[^>]*>自动生成照片口播素材/);
  const withoutArk = renderToStaticMarkup(<ShotProductionPanel {...props} defaults={{...defaults,presenters:defaults.presenters.map(({arkCertification, ...item})=>item)}} shot={{...shot,digitalHuman:{...shot.digitalHuman,targetFramesConfirmed:true}}} salesConfiguration viralReplication />);
  assert.match(withoutArk,/照片口播费用上限/);assert.doesNotMatch(withoutArk,/方舟人物认证/);
  assert.doesNotMatch(withoutArk,/确认已获成年本人授权/);
});

test('uncertain photo talking shows original-task recovery and disables a fresh submission', () => {
  const shot={...newShotProduction('Hello','photo'),source:'avatar' as const,digitalHuman:{...newDigitalHumanRequirements(),presenterMode:'photo_talking' as const,workflow:'viral_replication' as const,method:'reenact' as const,contentConfirmed:true,targetFramesConfirmed:true,reference:{videoUrl:'/source.mp4',start:0,end:2,originalText:'Hello',derivativeAuthorized:false,cues:[{id:'cue',start:0,end:2,originalText:'Hello',targetText:'Hello',shotIds:['s1'],personShot:true,compositionClusterId:'front',sourceFirstFrame:{time:0,materialId:'source'},targetFirstFrame:{materialId:'target',imageUrl:'/target.jpg',state:'ready' as const}}]}}};
  const html=renderToStaticMarkup(<ShotProductionPanel {...props} shot={shot} viralReplication pendingPhotoSentenceJob />);
  assert.match(html,/查询原 HeyGen 任务并恢复拼接/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>生成 HeyGen 照片口播并拼接<\/button>/);
});

test('photo talking hides internal shot type and composition inputs', () => {
  const shot={...newShotProduction('Hello','photo'),source:'avatar' as const,digitalHuman:{...newDigitalHumanRequirements(),presenterMode:'photo_talking' as const,workflow:'viral_replication' as const,method:'reenact' as const,reference:{videoUrl:'/source.mp4',start:0,end:2,originalText:'Hello',derivativeAuthorized:false,cues:[{id:'cue',start:0,end:2,originalText:'Hello',targetText:'Hello',shotIds:['s1'],personShot:true,classificationSource:'analysis' as const,compositionClusterId:'女性正面讲话|产品陈列室'}]}}};
  const defaults={...EMPTY_DEFAULTS,presenters:[{id:'photo',name:'Photo',avatarId:'',voiceId:'voice',authorized:true,supportsAlpha:false}]};
  const html=renderToStaticMarkup(<ShotProductionPanel {...props} defaults={defaults} shot={{...shot,presenterId:'photo'}} salesConfiguration viralReplication />);
  assert.doesNotMatch(html,/原片镜头类型/);
  assert.doesNotMatch(html,/人物构图|原片分析 · 女性正面讲话/);
  for (const section of ['人物与声音', '口播内容', '授权与目标首帧', '费用与生成']) assert.match(html, new RegExp(section));
  assert.match(html,/本镜头口播文案/);
  assert.match(html,/待生成，可生成后预览/);
  assert.match(html,/高级设置 · 原片取帧范围/);
});


test('pipeline 3 uses automatic first-frame checks and has no human review controls', () => {
  const shot={...newShotProduction('Hello','photo'),source:'avatar' as const,digitalHuman:{...newDigitalHumanRequirements(),presenterMode:'photo_talking' as const,workflow:'viral_replication' as const,method:'reenact' as const,targetFramesConfirmed:false,reference:{videoUrl:'/source.mp4',start:0,end:4,originalText:'Hello',derivativeAuthorized:false,cues:[{id:'cue',start:0,end:4,originalText:'Hello',targetText:'Hello',shotIds:['s1'],personShot:true,targetFirstFrame:{materialId:'target',imageUrl:'/target.jpg',state:'ready' as const}}]}}};
  const html=renderToStaticMarkup(<ShotProductionPanel {...props} shot={shot} salesConfiguration viralReplication />);
  assert.match(html,/系统自动校验首帧人物版本与素材归属/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>自动生成照片口播素材/);
  assert.match(html,/修改影响与费用/);assert.match(html,/实测时间码/);
  assert.doesNotMatch(html,/复核首帧|保存该镜头验收|已复核口播文案/);
});

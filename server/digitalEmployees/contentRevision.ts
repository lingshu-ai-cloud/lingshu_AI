import { contentAcceptanceHash } from './contentAcceptance.js';
export type RevisionNode = 'voice' | 'shots' | 'subtitles' | 'music' | 'cover' | 'export';
export function reviseContent(spec: Record<string, any>, node: RevisionNode, values: Record<string, any>) {
  const next = { ...spec }, plan = { ...(spec.contentOrder?.videoPlan || {}) };
  let stage = plan.presenter === 'avatar' || plan.presenter === 'heygen' ? 'heygen' : 'render';
  if (node === 'voice') {
    if (!['v1', 'v2'].includes(values.voice) || !Number.isFinite(values.speed) || values.speed < .8 || values.speed > 1.2) throw Error('请选择有效音色，语速在0.8至1.2之间');
    plan.voice = values.voice; next.voice = values.voice; next.voiceStyle = { preset: 'authentic_review', speed: values.speed, emotion: String(values.emotion || '自然可信').slice(0, 50) };
    next.voiceSelection = { source: 'human' }; stage = 'voice_subtitles';
    next.voiceoverUrl = ''; next.voiceoverDur = 0; next.alignedCuesByLang = {}; next.digitalHumanJob = null;
  } else if (node === 'music') {
    if (typeof values.bgm !== 'string' || !Number.isFinite(values.volume) || values.volume < 0 || values.volume > 100) throw Error('配乐或音量无效');
    next.bgm = values.bgm; next.bgmVol = values.volume; next.bgmSelection = { source: 'human' };
  } else if (node === 'shots') {
    if (!Array.isArray(values.scenes) || values.scenes.length < 3 || values.scenes.length > 8) throw Error('请保持3至8个分镜');
    const allowed = new Set<string>(spec.automation?.routePlan?.assetIds || []);
    const prior = spec.sceneSourcePlan || [];
    if (values.scenes.length !== prior.length) throw Error('请保持原分镜数量');
    values.scenes.forEach((scene: any) => {
      if (!['avatar', 'material'].includes(scene.source)) throw Error('画面来源无效');
      if (scene.source === 'material' && !allowed.has(scene.materialId)) throw Error('素材必须来自当前产品的制作素材');
      if (scene.source === 'material' && (!Number.isFinite(scene.trimStart) || scene.trimStart < 0)) throw Error('素材起点无效');
    });
    if (plan.presenter === 'avatar' && values.scenes.some((s: any) => s.source !== 'avatar') || plan.presenter === 'material' && values.scenes.some((s: any) => s.source !== 'material')) throw Error('分镜来源与成片方式不同');
    if (plan.presenter === 'heygen' && (!values.scenes.some((s: any) => s.source === 'avatar') || !values.scenes.some((s: any) => s.source === 'material'))) throw Error('混剪需要同时包含数字人和素材');
    plan.scenePlan = values.scenes.map((s: any) => ({ source: s.source, materialId: s.materialId || '' }));
    plan.materialIds = [...allowed];
    next.sceneOverrides = values.scenes; next.productionDirection = spec.productionDirection || { source: 'human', reason: '人工确认分镜素材与起点' };
    stage = 'material_match';
  } else if (node === 'subtitles') {
    if (!Array.isArray(values.cues) || !values.cues.length || values.cues.length > 1000) throw Error('字幕不可为空');
    let end = 0;
    for (const cue of values.cues) {
      if (typeof cue.text !== 'string' || !cue.text.trim() || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < end || cue.end <= cue.start || cue.end > Number(spec.duration) + .1) throw Error('字幕时间轴必须连续有序，且不超出成片');
      end = cue.end;
    }
    const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (normalize(values.cues.map((c: any) => c.text).join('')) !== normalize((spec.alignedCuesByLang?.[spec.lang] || []).map((c: any) => c.text).join(''))) throw Error('字幕内容须与口播一致；修改口播请使用口播修改入口');
    next.alignedCuesByLang = { ...spec.alignedCuesByLang, [spec.lang]: values.cues };
    next.subtitleAlignmentSource = 'human_reviewed';
    next.subtitleStyle = { fontScale: Math.max(.7, Math.min(1.4, Number(values.fontScale) || 1)), bottomRatio: Math.max(.08, Math.min(.35, Number(values.bottomRatio) || .2)) };
  } else if (node === 'cover') {
    next.coverTitle = String(values.title || '').trim().slice(0, 100);
    const frame = Number(values.frameTime);
    if (!Number.isFinite(frame) || frame < 0 || frame >= Number(spec.duration)) throw Error('封面时间点应在成片范围内');
    next.coverFrameTime = frame; next.coverImagePath = ''; stage = 'quality';
  } else if (node === 'export') {
    if (!['9:16', '1:1', '16:9'].includes(values.ratio) || !['720p', '1080p'].includes(values.resolution)) throw Error('导出规格无效');
    next.ratio = values.ratio; next.exportSpec = { ratio: values.ratio, resolution: values.resolution, fps: 30 };
  } else throw Error('不支持的修改节点');
  next.contentOrder = { ...spec.contentOrder, videoPlan: plan };
  next.contentAcceptance = null;
  next.revisionHistory = [...(spec.revisionHistory || []), { node, values, snapshot: { script: spec.script, caption: spec.caption, lang: spec.lang, duration: spec.duration, alignedCuesByLang: spec.alignedCuesByLang, coverImagePath: spec.coverImagePath, exportSpec: spec.exportSpec, bgm: spec.bgm, bgmVol: spec.bgmVol }, reason: String(values.reason || '用户在生产现场修正').slice(0, 240), hash: contentAcceptanceHash(spec), version: spec.automation?.contentVersion || 1, renderOutputPath: spec.renderOutputPath, changedAt: new Date().toISOString() }].slice(-30);
  if (stage !== 'quality') { next.renderOutputPath = ''; next.languageRenderOutputs = {}; next.coverImagePath = ''; }
  next.automation = { ...spec.automation, stage, status: 'queued', blocker: '', retryAfter: '', quality: {}, renderedAt: '', completedAt: '', contentVersion: Number(spec.automation?.contentVersion || 1) + 1,
    ...(stage !== 'quality' ? { renderOutputPath: '' } : {}), ...(node === 'voice' ? { heygenJobId: '', voiceLocalPath: '', narrationReviewPassed: false } : {}) };
  return next;
}

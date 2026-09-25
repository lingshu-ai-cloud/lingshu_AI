// Development-only UI fixture. It never calls model or supplier APIs.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ShotProductionPanel from '../src/components/ShotProductionPanel';
import { newShotProduction, patchShot, type ProductionDefaults, type ShotProduction } from '../src/lib/shotProduction';
import { newDigitalHumanRequirements } from '../src/lib/digitalHumanPlan';
import '../src/index.css';

const defaults: ProductionDefaults = {
  preference: 'avatar', defaultPresenterId: 'speaker', defaultSound: 'source', defaultLayout: 'full', presenters: [
    { id: 'speaker', name: '企业讲解人', avatarId: 'fixture-avatar', voiceId: 'fixture-voice', authorized: true, supportsAlpha: false, nativeOrientation: 'portrait', assetVersion: 2, capabilities: ['talking'] },
    { id: 'reference', name: '品牌代言人', avatarId: '', voiceId: '', authorized: true, supportsAlpha: false, assetVersion: 3, referenceMaterialIds: ['fixture-photo', 'fixture-video'], capabilities: ['reference_image', 'reference_video'] },
  ],
};

function Fixture() {
  const scriptNarration = '涂完嘴唇还是容易干裂，关键不是反复补涂，而是先把保湿和封闭做好。';
  const materials = [
    { id: 'fixture-video', name: '爆款参考视频 · 4秒', folder: 'reference', type: 'video' as const, duration: 4, size: '1 MB', file: 'fixture-reference.mp4', url: '/fixtures/reference.mp4', scope: 'own' as const, usage: 'reference_only' as const },
    { id: 'fixture-photo', name: '品牌代言人正脸', folder: 'presenter', type: 'image' as const, duration: 0, size: '100 KB', file: 'fixture-person.jpg', url: '/fixtures/person.jpg', scope: 'own' as const, usage: 'reference_only' as const },
  ];
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  const [shot, setShot] = useState<ShotProduction>({ ...newShotProduction(scriptNarration, 'reference'), source: 'avatar', sound: 'source', digitalHuman: {
    ...newDigitalHumanRequirements(), workflow: 'viral_replication', method: 'reenact', replicationMode: 'sentence_first_frame', contentConfirmed: false,
    action: '按原片逐句动作意图重新演绎', scene: '按逐句首帧重建', preserve: '口播节奏与镜头功能',
    reference: { materialId: 'fixture-video', videoUrl: '/fixtures/reference.mp4', start: 0, end: 4, originalText: '原片第一句', derivativeAuthorized: false,
      cues: [{ id: 'cue-1', start: 0, end: 4, originalText: '原片第一句', targetText: scriptNarration, shotIds: ['shot-1'] }] },
  } });
  return <main className="h-screen bg-slate-100"><ShotProductionPanel
    shot={shot} scriptNarration={scriptNarration} shotDuration={4} keyframeCues={[{ start: 0, end: 4, text: scriptNarration, frames: [{ position: '开头', time: 0.08 }, { position: '中间', time: 2 }, { position: '结尾', time: 3.92 }] }]} context="fixture" title="分镜 1" defaults={defaults} materials={materials} products={[]} jobs={[]}
    reason="内容 Agent 根据本镜头人物、口播和参考要求安排制作" error={notice} busy={busy} configured costPerSecond={null}
    toolCapabilities={[
      { id: 'heygen', label: 'HeyGen 人物口播', execution: true, reason: '接口已启用' },
      { id: 'local_head_pipeline', label: '本地逐帧人物处理', execution: false, reason: '服务端未注册该参考人物执行适配器，仅支持方案规划' },
      { id: 'runway_seedance', label: 'Seedance 参考人物重演', execution: false, reason: '当前仅有通用 Seedance 视频生成，不能执行参考人物身份与逐句保留约束' },
      { id: 'runway_kling_motion', label: 'Kling 参考动作生成', execution: false, reason: '服务端未注册该参考人物执行适配器，仅支持方案规划' },
      { id: 'runway_act_two', label: 'Runway Act-Two 人物驱动', execution: false, reason: 'Runway Act-Two 尚不可执行，缺少：RUNWAYML_API_SECRET、对象存储、逐镜预算、月度预算' },
      { id: 'self_hosted_video', label: '自有数字人模型', execution: false, reason: '自有模型尚未注册真实执行适配器' },
    ]}
    onChange={change => setShot(current => patchShot(current, change))} onClose={() => undefined} onNarration={() => undefined}
    onDefaults={async () => undefined} onApplyDefaultsToUnlocked={() => undefined} onSavePlan={() => undefined} onPrepareSentenceFrames={() => { setBusy(true); window.setTimeout(() => { setShot(current => ({ ...current, digitalHuman: current.digitalHuman ? { ...current.digitalHuman,
      reference: current.digitalHuman.reference ? { ...current.digitalHuman.reference, cues: current.digitalHuman.reference.cues?.map(cue => ({ ...cue,
        sourceFirstFrame: { time: cue.start, materialId: 'sentence-frame-fixture', imageUrl: '/data/seedance-reference-2026-09-25/contact-sheet.jpg' }, targetFirstFrame: { state: 'pending' as const } })) } : undefined } : undefined })); setNotice('已通过真实按钮完成逐句首帧准备；生产服务测试使用真实 FFmpeg。'); setBusy(false); }, 250); }} onGenerate={() => undefined} onAi={() => undefined} onShoot={() => undefined}
    onRunSentenceReplication={() => { setBusy(true); window.setTimeout(() => { setShot(current => ({ ...current, digitalHuman: current.digitalHuman?.reference ? { ...current.digitalHuman,
      reference: { ...current.digitalHuman.reference, cues: current.digitalHuman.reference.cues?.map(cue => ({ ...cue, targetFirstFrame: { state: 'ready' as const, materialId: 'target-frame-fixture', imageUrl: '/data/seedance-reference-2026-09-25/contact-sheet.jpg' }, generatedClip: { state: 'ready' as const, materialId: 'sentence-video-fixture', videoUrl: '/fixtures/reference.mp4', duration: cue.end - cue.start } })) } } : current.digitalHuman })); setNotice('完整链路已完成：目标人物首帧、逐句视频与时间轴拼接候选均已生成。'); setBusy(false); }, 250); }}
    onMaterial={() => undefined} onAdopt={() => undefined} onRefresh={() => undefined}
  /></main>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);

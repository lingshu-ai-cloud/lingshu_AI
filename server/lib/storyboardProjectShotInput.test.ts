import assert from 'node:assert/strict';
import { storyboardProjectShotInput, storyboardProjectShotRequestIssue } from './storyboardProjectShotInput.js';

const base = {
  mode: 'clone', ratio: '9:16', activeAssemblyId: 'a',
  shootingSlots: [{ id: 'persisted-1', slotId: 'shot-1', detail: '手持产品', duration: 4, requirements: 'r1' },
    { id: 'persisted-2', slotId: 'shot-2', detail: '工厂', duration: 4, requirements: 'r2' }],
  storyboardSourcePlans: { 'shot-1': { mode: 'ai', productIds: ['p1'], actionStartState: '握持', actionBeats: '转动', firstFrameMaterialId: 'old' },
    'shot-2': { mode: 'ai' } },
  videoKickoff: { referenceAnalysis: { details: [{ shotId: 'shot-1', firstFrameRef: '/frame-1', visual: '近景' }] } },
};
const before = storyboardProjectShotInput(base, 'shot-1');
assert.ok(before);
assert.equal(before.fingerprint, storyboardProjectShotInput(base, 'persisted-1')?.fingerprint);
assert.equal(before.fingerprint, storyboardProjectShotInput({ ...base, storyboardSourcePlans: {
  ...base.storyboardSourcePlans, 'shot-1': { ...base.storyboardSourcePlans['shot-1'], firstFrameMaterialId: 'new', quality: { passed: true } },
} }, 'shot-1')?.fingerprint, 'candidate state must not invalidate source inputs');
assert.equal(before.fingerprint, storyboardProjectShotInput({ ...base, shootingSlots: [base.shootingSlots[0], { ...base.shootingSlots[1], detail: '新版工厂' }] }, 'shot-1')?.fingerprint,
  'another shot must not invalidate this shot');
assert.notEqual(before.fingerprint, storyboardProjectShotInput({ ...base, storyboardSourcePlans: {
  ...base.storyboardSourcePlans, 'shot-1': { ...base.storyboardSourcePlans['shot-1'], productIds: ['p2'] },
} }, 'shot-1')?.fingerprint);
const withEnvironment = { ...base, storyboardSourcePlans: { ...base.storyboardSourcePlans,
  'shot-1': { ...base.storyboardSourcePlans['shot-1'], environmentMaterialId: 'factory-image-1' } } };
assert.notEqual(before.fingerprint, storyboardProjectShotInput(withEnvironment, 'shot-1')?.fingerprint,
  'changing this shot environment image must stale its first frame');
assert.equal(before.fingerprint, storyboardProjectShotInput({ ...base, storyboardSourcePlans: { ...base.storyboardSourcePlans,
  'shot-2': { ...base.storyboardSourcePlans['shot-2'], environmentMaterialId: 'factory-image-2' } } }, 'shot-1')?.fingerprint,
  'another shot environment image must not stale this shot');
assert.notEqual(before.fingerprint, storyboardProjectShotInput({ ...base, videoKickoff: { referenceAnalysis: { details: [{ shotId: 'shot-1', firstFrameRef: '/frame-new' }] } } }, 'shot-1')?.fingerprint);
assert.equal(storyboardProjectShotInput(base, 'missing'), null);
const legacy = { ...base, videoKickoff: { referenceAnalysis: { details: [
  { time: '0-4s', firstFrameRef: '/legacy-frame-1' }, { time: '4-8s', firstFrameRef: '/legacy-frame-2' },
] } } };
assert.equal(storyboardProjectShotInput(legacy, 'shot-2')?.input.reference?.firstFrameRef, '/legacy-frame-2');
assert.equal(storyboardProjectShotInput({ ...legacy, videoKickoff: { referenceAnalysis: { details: [
  { time: '0-4s', firstFrameRef: '/legacy-frame-1' }, { time: '4.5-8.5s', firstFrameRef: '/wrong-frame' },
] } } }, 'shot-2')?.input.reference, null, 'legacy ordinal must not bind a mismatched time range');
const request = { projectSpec: base, shotId: 'shot-1', shotDescription: '0-4s 手持产品', mode: 'replication', ratio: '9:16',
  sceneType: 'product', productIds: ['p1'], targetDurationSeconds: 4, sourceFirstFrameUrl: '/frame-1',
  action: { startState: '握持', beats: ['转动'] } };
assert.equal(storyboardProjectShotRequestIssue(request), null);
assert.match(storyboardProjectShotRequestIssue({ ...request, environmentMaterialId: 'factory-image-1' }) || '', /环境参考图/);
assert.equal(storyboardProjectShotRequestIssue({ ...request, projectSpec: withEnvironment,
  environmentMaterialId: 'factory-image-1' }), null);
assert.match(storyboardProjectShotRequestIssue({ ...request, sourceFirstFrameUrl: '/frame-2' }) || '', /当前分镜/);
assert.match(storyboardProjectShotRequestIssue({ ...request, projectSpec: { ...base, videoKickoff: { referenceAnalysis: { details: [] } } } }) || '', /原片真实首帧/);
assert.match(storyboardProjectShotRequestIssue({ ...request, productIds: ['p2'] }) || '', /产品映射/);
assert.match(storyboardProjectShotRequestIssue({ ...request, shotDescription: '别的镜头' }) || '', /画面要求/);
assert.match(storyboardProjectShotRequestIssue({ ...request, action: { startState: '凭空添加动作', beats: ['转动'] } }) || '', /动作起点/);
assert.match(storyboardProjectShotRequestIssue({ ...request, action: { startState: '握持', beats: ['开盖'] } }) || '', /动作步骤/);
const observed = { ...base, storyboardSourcePlans: { ...base.storyboardSourcePlans,
  'shot-1': { ...base.storyboardSourcePlans['shot-1'], actionStartState: '', actionBeats: '' } },
  videoKickoff: { referenceAnalysis: { details: [{ shotId: 'shot-1', firstFrameRef: '/frame-1',
    startState: '产品在手中', endState: '产品已转向镜头', beats: [{ action: '缓慢转向镜头' }] }] } } };
assert.equal(storyboardProjectShotRequestIssue({ ...request, projectSpec: observed,
  action: { startState: '产品在手中', beats: ['缓慢转向镜头'], endState: '产品已转向镜头', evidence: 'confirmed_reference_analysis' } }), null);
assert.match(storyboardProjectShotRequestIssue({ ...request, projectSpec: observed,
  action: { startState: '产品在手中', beats: ['凭空开盖'], endState: '产品已转向镜头', evidence: 'confirmed_reference_analysis' } }) || '', /原片分镜分析/);
assert.match(storyboardProjectShotRequestIssue({ ...request, projectSpec: observed,
  action: { startState: '产品在手中', beats: ['缓慢转向镜头'], endState: '凭空完成安装', evidence: 'confirmed_reference_analysis' } }) || '', /原片分镜分析/);
const withKeyStates = { ...base, storyboardSourcePlans: { ...base.storyboardSourcePlans,
  'shot-1': { ...base.storyboardSourcePlans['shot-1'], actionKeyStates: '产品已转向镜头' } } };
assert.match(storyboardProjectShotRequestIssue({ ...request, projectSpec: withKeyStates,
  keyStates: [{ afterBeat: 1, description: '未经确认的中间状态', source: 'confirmed_storyboard' }] }) || '', /动作中间状态/);
assert.match(storyboardProjectShotRequestIssue({ ...request,
  keyStates: [{ afterBeat: 1, description: '未保存到分镜的中间状态', source: 'confirmed_storyboard' }] }) || '', /动作中间状态/);
assert.equal(storyboardProjectShotRequestIssue({ ...request, projectSpec: withKeyStates,
  keyStates: [{ afterBeat: 1, description: '产品已转向镜头', source: 'confirmed_storyboard' }] }), null);
const withPlacement = { ...base, storyboardSourcePlans: { ...base.storyboardSourcePlans,
  'shot-1': { ...base.storyboardSourcePlans['shot-1'], placementOverride: {
    contactScene: 'tabletop', productBox: { x: .3, y: .25, width: .4, height: .5 }, contactSurfaceY: .75,
  } } } };
assert.equal(storyboardProjectShotRequestIssue({ ...request, projectSpec: withPlacement,
  placement: { contactScene: 'tabletop', productBox: { x: .3, y: .25, width: .4, height: .5 }, contactSurfaceY: .75 } }), null);
assert.match(storyboardProjectShotRequestIssue({ ...request, projectSpec: withPlacement,
  placement: { contactScene: 'tabletop', productBox: { x: .4, y: .25, width: .4, height: .5 }, contactSurfaceY: .75 } }) || '', /产品位置/);
console.log('storyboardProjectShotInput tests passed');

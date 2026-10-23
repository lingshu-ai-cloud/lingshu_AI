import { readAiStudioApplicationSources } from '../../tests/fixtures/aiStudioApplicationSources.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyManagedPresenterProduction,
  confirmedNarrationForTimeRange,
  referencePersonShotForDetail,
} from './AiCreateStudio.js';
import { newShotProduction } from '../lib/shotProduction.js';
import { newDigitalHumanRequirements } from '../lib/digitalHumanPlan.js';

assert.equal(confirmedNarrationForTimeRange([
  { draft: '第一句确认口播', time: '0-3s' },
  { draft: '第二句确认口播', time: '3-6s' },
], { start: 0, end: 3 }), '第一句确认口播');

const rawPhoto = {
  ...newShotProduction('无', 'sales'),
  candidates: [{ id: 'keep', materialId: 'candidate-1', fingerprint: 'fp-1', source: 'avatar' as const, createdAt: '2026-10-16' }],
  revision: 7,
  digitalHuman: {
    ...newDigitalHumanRequirements(),
    presenterMode: 'photo_talking' as const,
    workflow: 'viral_replication' as const,
    method: 'reenact' as const,
  },
};
const managedTwin = {
  ...newShotProduction('第一句确认口播', 'sales'),
  digitalHuman: {
    ...newDigitalHumanRequirements(),
    presenterMode: 'video_twin' as const,
    workflow: 'material_processing' as const,
    method: 'talking' as const,
  },
};
const materializedTwin = applyManagedPresenterProduction(rawPhoto, managedTwin, {
  managedMode: 'one_click_managed',
  presenterConfirmed: true,
});
assert.equal(materializedTwin.digitalHuman?.presenterMode, 'video_twin');
assert.equal(materializedTwin.digitalHuman?.method, 'talking');
assert.equal(materializedTwin.sound, 'source', '视频分身直接使用已绑定音色，不要求先生成统一旁白');
assert.equal(materializedTwin.narration, '第一句确认口播');
assert.equal(materializedTwin.revision, 7);
assert.equal(materializedTwin.candidates[0]?.id, 'keep');
assert.equal(referencePersonShotForDetail({
  visual: '销售人员面对镜头口播',
  observedPresenterRole: 'background',
  personContinuityId: 'main-sales',
  salesPresenterConfirmed: true,
}), false, '背景人物证据不能被遗留确认标记提升为人物口播镜头');
assert.equal(referencePersonShotForDetail({
  visual: '销售人员面对镜头口播',
  observedPresenterRole: 'sales_presenter',
  personContinuityId: 'main-sales',
  salesPresenterConfirmed: true,
  needsReview: true,
}), undefined, '待复核的人物证据不能进入视频分身生产');
assert.equal(applyManagedPresenterProduction(rawPhoto, managedTwin, {
  managedMode: 'one_click_managed',
  presenterConfirmed: true,
  sourceChoice: 'material',
}).source, rawPhoto.source, '用户明确选择企业素材时不得被托管数字人覆盖');

const studioSource = readAiStudioApplicationSources();
assert.match(
  studioSource.slice(studioSource.indexOf('  const collectSpec ='), studioSource.indexOf('  const applySpec =')),
  /for \(const slot of storyboardSlots\)[\s\S]{0,180}savedShotProductions\[productionKey\(slot\.id\)\] = productionFor\(slot\)/,
  '保存批量制作 spec 前必须固化工作台实际使用的托管人物模式与确认口播',
);
const bindAvatarStart = studioSource.indexOf('  const bindHeygenAvatarToShot =');
const bindAvatarSource = studioSource.slice(bindAvatarStart, studioSource.indexOf('\n  useEffect(() => {', bindAvatarStart));
assert.doesNotMatch(bindAvatarSource, /authorizationRef\s*:|consentRef\s*:/,
  '客户端绑定人物只提交授权声明，不能自行伪造服务端权益凭证');
assert.match(bindAvatarSource, /authorizationConfirmation[\s\S]{0,180}subjectAdultConfirmed:\s*true[\s\S]{0,180}heygenProcessingAuthorized:\s*true/);
assert.match(studioSource, /const \[heygenBindingConsent, setHeygenBindingConsent\] = useState\(false\)/);
assert.match(studioSource, /setHeygenAvatarId\(event\.target\.value\); setHeygenBindingConsent\(false\)/);
assert.match(studioSource, /setHeygenAvatarOrientation[\s\S]{0,180}setHeygenBindingConsent\(false\)/);
assert.match(studioSource, /presenterEvidenceFor[\s\S]{0,700}needsReview:\s*presenterNeedsReviewBySlot/,
  '待复核证据必须进入统一人物判断，不能因遗留 confirmed 标记直通视频分身');
assert.match(studioSource, /mergeAutomatedPresenterReviewEvidence\(detail[\s\S]{0,260}needsReview:\s*row\.needsReview === true/,
  '后台人物复核必须通过统一合并策略，不能异步降级已保存的人工确认');
assert.match(studioSource, /salesPresenterConfirmed:\s*presenterConfirmationBySlot\[slot\.id\] \?\? persisted\?\.salesPresenterConfirmed/,
  '页面分析证据短暂缺失时必须沿用已保存的人物确认，避免加载过程闪回“没有人物”');

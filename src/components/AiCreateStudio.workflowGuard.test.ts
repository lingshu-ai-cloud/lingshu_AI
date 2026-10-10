import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  StudioRequestTimeoutError,
  enterpriseBuyerText,
  hasIncompleteReferenceAnalysis,
  isUnverifiedLegacyCoverTitle,
  validateStudioTimeline,
  scriptQualityFailure,
  withStudioTimeout,
} from './AiCreateStudio.js';

assert.equal(
  enterpriseBuyerText(['工厂厂长', ' 采购与供应链负责人 ', '']),
  '工厂厂长、采购与供应链负责人',
  '应仅使用当前企业路线的买家角色',
);

assert.deepEqual(validateStudioTimeline([{
  type: 'video', url: '/material.mp4', trimStart: 0, trimEnd: 10, speed: 1, targetDuration: 10,
}]), []);

const invalidTimeline = validateStudioTimeline([{
  type: 'video', url: '', trimStart: 0, trimEnd: 5, speed: 1, targetDuration: 8,
}]);
assert.ok(invalidTimeline.some(item => item.includes('缺少可播放')));
assert.ok(invalidTimeline.some(item => item.includes('仅可覆盖 5.0s')));

await assert.rejects(
  withStudioTimeout(new Promise(() => undefined), 5),
  (error: unknown) => error instanceof StudioRequestTimeoutError,
);

assert.equal(await withStudioTimeout(Promise.resolve('完成'), 100), '完成');
assert.equal(isUnverifiedLegacyCoverTitle('You NEED this in 2026'), true, '历史虚构封面标题必须被清理');
assert.equal(isUnverifiedLegacyCoverTitle('气动输送线'), false, '企业产品标题应保留');

const completeReference = {
  video: { duration: 10 },
  referenceAnalysis: { details: [{ time: '0-5' }, { time: '5-10' }] },
} as Parameters<typeof hasIncompleteReferenceAnalysis>[0];
assert.equal(hasIncompleteReferenceAnalysis(completeReference), false, '完整连续的原片切点应可用于创作');
assert.equal(hasIncompleteReferenceAnalysis({ ...completeReference!, video: { duration: 0 } } as Parameters<typeof hasIncompleteReferenceAnalysis>[0]), true, '缺少原片时长时不能声称已覆盖全片');
assert.equal(hasIncompleteReferenceAnalysis({ ...completeReference!, referenceAnalysis: { details: [{ time: '0-5' }, { time: '待确认' }] } } as Parameters<typeof hasIncompleteReferenceAnalysis>[0]), true, '缺少时间码的镜头不能被静默忽略');

const rejectionIssues = Array.from({ length: 6 }, (_, index) => `可操作问题${index + 1}`);
const rejection = scriptQualityFailure({ script: '', qualityStatus: 'rejected', validationIssues: rejectionIssues }, '失败');
for (const issue of rejectionIssues) assert.ok(rejection?.includes(issue), '质量阻断不得截断待处理问题');

const studioSource = readFileSync(fileURLToPath(new URL('./AiCreateStudio.tsx', import.meta.url)), 'utf8');
const workbenchSource = readFileSync(fileURLToPath(new URL('./studio/StudioWorkbenchFrame.tsx', import.meta.url)), 'utf8');
assert.match(studioSource, /usableDuration > 8[^]*?Math\.ceil\(usableDuration \/ 8\)[^]*?longer final slot[^]*?连续片段/, '单条长视频应拆成连续分镜并为唯一 CTA 留出足够时长');
assert.match(studioSource, /response\.validationIssues\?\.length[^]*?issueIndex \+ 1/, '脚本质量阻断应把全部可操作问题展示给用户');
assert.match(studioSource, /const slotsToMatch = storyboardSlots\.filter\(slot => \{\s*if \(lockedAssignments\[slot.id\]\) return false;/, '自动匹配必须保留已经选定的分镜素材');
assert.match(studioSource, /const assessment = assessMaterialMatch\(slot, clip, ratio\);[^]*?assessment\.level !== 'missing'[^]*?const assignments = \{ \.\.\.lockedAssignments, \.\.\.matchedAssignments \}/, '新匹配必须通过逐镜质量评估，不能因素材时长充足就覆盖全部镜头');
assert.doesNotMatch(studioSource, /function buildLocal(?:Product|Material|Clone)Script/, '脚本上游失败后不得生成可误认成正式结果的本地营销脚本');
assert.match(studioSource, /posterDraft\?\.ok[^]*?posterDraft\.provenance === 'ai'[^]*?posterDraft\.qualityStatus === 'passed'[^]*?posterDraft\.publishable === true/, '海报只有具备 AI 来源、质量通过和可发布标记时才可提交');
assert.match(studioSource, /provenance: 'manual_draft'[^]*?qualityStatus: 'unreviewed'[^]*?publishable: false/, '手动修改图文后必须降为待复核草稿并使旧图片失效');
assert.match(studioSource, /generationProvenance: 'manual_draft'[^]*?publishable: false[^]*?qualityStatus: 'unreviewed'/, '手动修改脚本后必须清除旧 AI 通过状态并降为待复核草稿');
assert.match(studioSource, /socialPosterArtifactReady = posterGenerationIsVerified/, '社媒任务不得自动提交模板、失败降级或待确认海报');
assert.doesNotMatch(studioSource, /qualityStatus: result\.qualityStatus \|\| \(result\.fieldsToConfirm\.length \? 'needs_confirmation' : 'passed'\)/, '缺失质量结论时不得自动标为通过');

console.log('AiCreateStudio workflow guard tests passed');

assert.match(studioSource, /const \{ message, notification \} = AntApp\.useApp\(\)/, '制作反馈必须使用 Ant Design 全局提示');
assert.match(studioSource, /message\.open\(\{[\s\S]{0,300}duration: 3/, '普通制作反馈必须自动消失且不占用工作台布局');
assert.match(studioSource, /notification\.warning\(\{[\s\S]{0,300}placement: 'top'[\s\S]{0,100}duration: 6/, '需要后续操作的制作反馈必须使用顶部临时通知');
assert.doesNotMatch(studioSource, /modeNotice &&\s*\(?\s*<div/, '制作提示不得再渲染为常驻方框');
assert.match(studioSource, /sceneNavigationError[\s\S]{0,500}notification\.error\(\{[\s\S]{0,500}btn:/, '分镜导航错误必须使用带返回操作的临时通知');
assert.match(studioSource, /referenceRecoveryMessage[\s\S]{0,500}notification\.warning\(\{[\s\S]{0,700}retryReferenceActionRef\.current/, '参考分析恢复必须在临时通知中保留重试操作');
for (const persistentRootNotice of [
  /sceneNavigationError && <div role="alert"/,
  /sceneNavigationReceipt && <div role="status"/,
  /localGateBypass && !socialViralTask && <div role="status"/,
  /referenceRecoveryMessage && <div role="alert"/,
  /projectId && <div className="shrink-0 border-b border-slate-200/,
  /!linkedProductionContext && managedProductionProjectRef\.current && <div role="status"/,
  /rawSceneTarget && !sceneNavigationReceipt && !sceneNavigationError && <p role="status"/,
]) assert.doesNotMatch(studioSource, persistentRootNotice, '工作台根布局不得保留顶部或底部常驻提示条');
assert.match(studioSource, /sceneReworkTask\?\.taskId[\s\S]{0,1200}<SocialSceneReworkPanel/, '分镜返工详情是功能面板，必须保留');
assert.match(studioSource, /linkedProductionContext && <details[\s\S]{0,300}<ProductionTaskScene/, '关联任务进度是功能面板，必须保留');
assert.match(studioSource, /managedProductionProjectRef\.current && projectId[\s\S]{0,500}<ProductionRevisionPanel/, '生产现场修订面板必须保留');
assert.match(workbenchSource, /studio-workbench-panel-layout[^"\n]*overflow-hidden/, '工作台面板必须约束在可用高度内');
assert.match(workbenchSource, /overflow-x-hidden overflow-y-auto overscroll-contain/, '中间制作内容必须可独立纵向滚动');
assert.doesNotMatch(workbenchSource, /<footer className="sticky bottom-0/, '底部操作栏必须占据正常 flex 布局，不得覆盖中间内容');
assert.match(studioSource, /index > 0 && socialViralTask && hasIncompleteReferenceAnalysis\(videoKickoff\)/, '参考视频缺少可用切点时不得进入后续制作步骤');
assert.match(studioSource, /const generateSetupScriptAndContinue = async[^]*?if \(socialViralTask\)[^]*?hasIncompleteReferenceAnalysis\(videoKickoff\)/, '自动口播交接同样必须拦截缺少完整切点的原片');
assert.match(studioSource, /ranges\.length !== details\.length/, '逐镜分析不能忽略缺少时间码的镜头');
assert.match(studioSource, /inherited \|\| selectedProductIds\[0\] \|\| ''/, '多个参考产品位应默认映射到同一企业产品');
assert.doesNotMatch(studioSource, /selectedProductOptions\.length !== referenceProducts\.length/, '产品位数量不能强迫用户选择同样数量的不同产品');
assert.match(studioSource, /blockReason: threeStepWorkflow && step === 'preview'/, '必须保留真实的主操作阻断原因');
assert.match(studioSource, /xl:hidden[^]*?返回生产现场/, '移动端必须保留返回数字员工生产现场的入口');
assert.match(studioSource, /本批计划上限[^]*?并非账户余额[^]*?不会自动提交/, '预算说明必须区分任务上限、账户余额与真实提交费用');
assert.match(studioSource, /coverMaterialVersions\.filter\(item => Boolean\(materialVersionCovers\[item.key\]\)\)\.length/, '封面计数只能统计当前有效版本');
assert.match(studioSource, /脚本已就绪 · 不配音 · 尚未配乐/, '不配音不能显示配音已生成');
assert.match(studioSource, /activeStepId: step, activeStoryboardSlotId, canvasView, scriptStageTab/, '草稿应保存工作位置');
assert.match(studioSource, /s.activeStepId \?\? s.workspaceStep[^]*?restoredSteps\.findIndex\(item => item.id === restoredStepId\)/, '重新打开草稿应回到保存的步骤');

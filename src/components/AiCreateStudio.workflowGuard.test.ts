import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  StudioRequestTimeoutError,
  enterpriseBuyerText,
  hasIncompleteReferenceAnalysis,
  isUnverifiedLegacyCoverTitle,
  studioReferenceAnalysisBlockers,
  validateStudioTimeline,
  scriptQualityFailure,
  withStudioTimeout,
} from './AiCreateStudio.js';
import { buildBenchmarkAnalysis, recordOf } from '../../shared/benchmarkAnalysis.js';
import { benchmarkVideoFixture } from '../../tests/fixtures/benchmarkVideo.js';

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
} as NonNullable<Parameters<typeof hasIncompleteReferenceAnalysis>[0]>;
assert.equal(hasIncompleteReferenceAnalysis(completeReference), false, '完整连续的原片切点应可用于创作');
assert.equal(hasIncompleteReferenceAnalysis({ ...completeReference!, video: { duration: 0 } } as Parameters<typeof hasIncompleteReferenceAnalysis>[0]), true, '缺少原片时长时不能声称已覆盖全片');
assert.equal(hasIncompleteReferenceAnalysis({ ...completeReference!, referenceAnalysis: { details: [{ time: '0-5' }, { time: '待确认' }] } } as Parameters<typeof hasIncompleteReferenceAnalysis>[0]), true, '缺少时间码的镜头不能被静默忽略');

const canonicalReadyReference = {
  ...completeReference,
  referenceAnalysis: {
    ...completeReference.referenceAnalysis,
    benchmarkAnalysis: buildBenchmarkAnalysis({ analysis: benchmarkVideoFixture(), videoId: 'reference', duration: 9, evidenceRevision: 'v1' }),
  },
} as Parameters<typeof studioReferenceAnalysisBlockers>[0];
assert.deepEqual(studioReferenceAnalysisBlockers(canonicalReadyReference), [], '生产准入应复用灵感中心的规范化逐镜证据');
const reviewFixture = benchmarkVideoFixture();
const reviewShots = recordOf(reviewFixture.gemini).scriptDetails15s;
assert.ok(Array.isArray(reviewShots));
(reviewShots as Record<string, unknown>[])[1]!.materialType = 'unknown';
(reviewShots as Record<string, unknown>[])[1]!.needsReview = true;
const canonicalBlockedReference = {
  ...completeReference,
  referenceAnalysis: {
    ...completeReference.referenceAnalysis,
    benchmarkAnalysis: buildBenchmarkAnalysis({ analysis: reviewFixture, videoId: 'reference', duration: 9, evidenceRevision: 'v1' }),
  },
} as Parameters<typeof studioReferenceAnalysisBlockers>[0];
assert.ok(
  studioReferenceAnalysisBlockers(canonicalBlockedReference).some(item => item.includes('第 2 镜') && item.includes('类型未确认')),
  '规范证据中的逐镜缺项必须原样成为可操作阻断原因',
);

const rejectionIssues = Array.from({ length: 6 }, (_, index) => `可操作问题${index + 1}`);
const rejection = scriptQualityFailure({ script: '', qualityStatus: 'rejected', validationIssues: rejectionIssues }, '失败');
for (const issue of rejectionIssues) assert.ok(rejection?.includes(issue), '质量阻断不得截断待处理问题');

const studioSource = readFileSync(fileURLToPath(new URL('./AiCreateStudio.tsx', import.meta.url)), 'utf8');
const referenceAdmissionSource = readFileSync(fileURLToPath(new URL('./studio/studioReferenceAdmission.ts', import.meta.url)), 'utf8');
const workbenchSource = readFileSync(fileURLToPath(new URL('./studio/StudioWorkbenchFrame.tsx', import.meta.url)), 'utf8');
const contentLibrarySource = readFileSync(fileURLToPath(new URL('./ContentLibrary.tsx', import.meta.url)), 'utf8');
const globalStyles = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');
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
assert.doesNotMatch(studioSource, /SocialSceneReworkPanel|原成片失败镜头 · 局部返工/, '原成片失败镜头与局部返工不得嵌入内容制作工作台顶部');
assert.doesNotMatch(studioSource, /actionTodos=|aria-label="生成待办"/, '内容制作底部不得注入分镜待办或黄色提示框');
assert.doesNotMatch(workbenchSource, /actionTodos|primaryAction\.blockReason\s*&&\s*\(\s*<p/, '共享底部操作区不得渲染待办或阻断提示');
for (const automaticEntryNotice of [
  /studio-social-task-context/,
  /studio-local-demo-mode/,
  /studio-manual-project/,
  /任务资料已带入统一制作工作台/,
  /本地演示模式：内容制作门禁已放行/,
  /当前作品未关联智能员工任务/,
  /已打开当前任务的内容项目/,
  /已恢复任务“\$\{project\.title\}”的上次制作进度/,
  /已打开历史创作“\$\{project\.title\}”/,
  /已载入当前复刻任务的参考分析/,
  /本地演示已从参考分析建立/,
]) assert.doesNotMatch(studioSource, automaticEntryNotice, '进入内容制作本身不得自动弹出说明性提示');
assert.doesNotMatch(studioSource, /DirectorTaskContext|ProductionTaskScene|ProductionRevisionPanel/, '内容制作页必须与自动周任务详情、任务进度和流程修订严格隔离');
assert.doesNotMatch(studioSource, /关联任务进度|生产现场：修改配置并继续原任务/, '内容制作页不得出现自动任务详情入口');
assert.doesNotMatch(contentLibrarySource, /ProductionRevisionPanel|查看与修改|Production workspace/, '成片列表不得以弹层嵌入自动任务修订工作区');
assert.match(contentLibrarySource, /onOpenProject\(item\.projectId\)[\s\S]{0,180}>进入制作台</, '成片必须通过项目身份进入三栏制作台');
assert.match(workbenchSource, /studio-workbench-panel-layout[^"\n]*overflow-hidden/, '工作台面板必须约束在可用高度内');
assert.match(workbenchSource, /overflow-x-hidden overflow-y-auto overscroll-contain/, '中间制作内容必须可独立纵向滚动');
assert.match(workbenchSource, /studio-workbench-object-toolbar/, '左栏原标题位置必须提供统一预览切换容器');
assert.match(workbenchSource, /studio-workbench-canvas-body/, '预览主体必须使用稳定画布容器');
assert.match(workbenchSource, /absolute right-3 top-3[\s\S]{0,300}<Popover/, '时间轴必须通过画布右上角的浮层按钮打开');
assert.doesNotMatch(workbenchSource, /replicationWorkflow && timelinePanel && <section className="shrink-0 border-t/, '复刻时间轴不得在画布底部单独占行');
assert.doesNotMatch(workbenchSource, /timelinePanel && !replicationWorkflow/, '其他制作路径也不得保留独占底部行的时间轴');
assert.match(globalStyles, /\.studio-workbench-canvas-body,\s*\.studio-workbench-preview-shell \{ container-type: size; \}/, '所有内容画布和共享预览壳都必须以可用宽高约束竖版预览');
assert.doesNotMatch(globalStyles, /\.replication-workbench \.studio-workbench-panel-layout > main > div \{ padding:/, '不得再用宽泛选择器同时挤压工具栏和预览主体');
assert.match(workbenchSource, /bg-surface p-2 md:hidden/, '三栏切换标签只允许在移动端显示');
assert.match(workbenchSource, /bg-surface md:flex md:border-r/, '平板和桌面宽度必须同时展示分镜栏');
assert.match(workbenchSource, /bg-surface-2 md:flex/, '平板和桌面宽度必须同时展示创作画布');
assert.match(workbenchSource, /bg-surface md:flex md:border-l/, '平板和桌面宽度必须同时展示步骤设置栏');
assert.match(globalStyles, /@media \(min-width: 768px\)[\s\S]{0,220}grid-template-columns: minmax\(156px, \.72fr\) minmax\(240px, 1\.55fr\) minmax\(184px, \.82fr\)/, '内容制作从统一桌面断点开始使用三栏网格');
assert.match(workbenchSource, /<ReplicationWorkbenchHeader[\s\S]{0,700}title=\{projectTitle \|\| projectTitlePlaceholder\}[\s\S]{0,700}actions=/, '所有内容制作阶段必须复用同一草稿名称与操作头部');
assert.doesNotMatch(workbenchSource, /StudioStepProgress|<Steps|内容创作步骤/, '工作台页头不得再次显示阶段步骤条');
assert.match(workbenchSource, /onTitleCommit=\{onProjectTitleCommit\}/, '名称失焦或回车保存必须与显式保存按钮解耦');
const alwaysVisibleBackAction = studioSource.indexOf('onClick={() => openCreationHome(false)}');
const desktopOnlyActionGroup = studioSource.indexOf('<div className="hidden items-center gap-1.5 xl:flex">', alwaysVisibleBackAction);
assert.ok(alwaysVisibleBackAction >= 0 && desktopOnlyActionGroup > alwaysVisibleBackAction, '返回创作列表必须位于桌面专属操作组之外并始终可见');
assert.match(studioSource, /<Button[\s\S]{0,180}openCreationHome\(false\)[\s\S]{0,180}min-h-11[\s\S]{0,180}text-xs[\s\S]{0,180}>返回创作列表<\/Button>/, '始终可见的返回动作必须使用 Ant Button 并满足移动触控与字号下限');
assert.match(contentLibrarySource, /const secondaryButton = ['"][^'"]*min-h-11[^'"]*text-xs/, '成片库新增项目入口必须满足 44px 触控高度和 12px 文字下限');
assert.doesNotMatch(workbenchSource, /<footer className="sticky bottom-0/, '底部操作栏必须占据正常 flex 布局，不得覆盖中间内容');
assert.match(studioSource, /index > 0 && socialViralTask && hasIncompleteReferenceAnalysis\(videoKickoff\)/, '参考视频缺少可用切点时不得进入后续制作步骤');
assert.match(studioSource, /const generateSetupScriptAndContinue = async[^]*?if \(socialViralTask\)[^]*?hasIncompleteReferenceAnalysis\(videoKickoff\)/, '自动口播交接同样必须拦截缺少完整切点的原片');
assert.match(studioSource, /from '.\/studio\/studioReferenceAdmission'/, '工作台必须复用独立的对标证据准入规则');
assert.match(referenceAdmissionSource, /ranges\.length !== details\.length/, '逐镜分析不能忽略缺少时间码的镜头');
assert.match(studioSource, /socialSourceShotIds\.length === slots\.length \? socialSourceShotIds : referenceShotIds/, '社媒任务应优先把正式制作 shot ID 写入 Studio 分镜身份');
assert.match(studioSource, /resolveStudioSocialShot\(storyboardSlots, \{ shotId, shotIndex \}\)/, '社媒任务的素材绑定必须通过稳定镜头身份解析');
assert.doesNotMatch(studioSource, /storyboardSlots\.find\(item => item\.id === shotId\) \|\| storyboardSlots\[shotIndex\]/, '现代任务不得在 shot ID 不匹配时静默回退到数组位置');
assert.match(studioSource, /inherited \|\| selectedProductIds\[0\] \|\| ''/, '多个参考产品位应默认映射到同一企业产品');
assert.doesNotMatch(studioSource, /selectedProductOptions\.length !== referenceProducts\.length/, '产品位数量不能强迫用户选择同样数量的不同产品');
assert.match(studioSource, /blockReason: frozenStudioSpecRef\.current[^\n]+threeStepWorkflow && step === 'preview' \? previewRenderBlockers\[0\][^\n]+primaryActionBlockedReason/, '必须保留真实的主操作阻断原因');
assert.match(studioSource, /<Button onClick=\{requestProductionBack\} className="min-h-11[^\"]*text-xs[^\"]*">返回生产现场<\/Button>/, '返回生产现场必须始终可见，并与返回创作列表使用同一按钮尺寸');
assert.doesNotMatch(studioSource, /replicationShowTaskIdentity|replicationStepLabels|onReplicationStepChange|replicationNavigationDisabled/, '各制作步骤不得保留会改变页头结构的旧步骤参数');
assert.match(studioSource, /canvasTitle=""/, '所有内容类型与制作步骤都不得重复显示通用画面标题');
assert.match(studioSource, /showPanelHeadings=\{!\(threeStepWorkflow && step === 'preview'\)\}/, '成片阶段不得重复显示三栏标题');
assert.match(studioSource, /showObjectHeading=\{false\}/, '所有内容制作步骤都不得重复显示左栏分镜标题文案');
assert.match(studioSource, /showPropertyHeading=\{step !== 'material'\}/, '分镜制作阶段不得重复显示右侧“分镜 N · 制作”标题');
assert.doesNotMatch(studioSource, /projectSubtitle=/, '内容制作页头不得显示“视频 · 平台 · 比例”解释性副标题');
assert.match(studioSource, /showHeaderSaveStatus=\{!\(threeStepWorkflow && step === 'preview'\)\}/, '成片阶段顶部不得显示等待保存状态');
assert.match(studioSource, /previewOnly=\{threeStepWorkflow && step === 'preview'\}/, '成片阶段左栏只显示口播和分镜预览');
assert.match(studioSource, /studio-workbench-preview-shell[\s\S]{0,300}studio-workbench-preview-stage[\s\S]{0,300}aspectRatio: ratioNumber\(ratio\)[\s\S]{0,180}cqh/, '所有工作台预览状态必须共用按目标画幅和可用高度约束的稳定比例框');
assert.match(studioSource, /objectToolbar=\{[\s\S]{0,600}爆款视频预览<\/button>[\s\S]{0,300}新建视频预览<\/button>/, '参考视频与新建视频切换必须移到左栏原标题位置');
assert.doesNotMatch(studioSource, /canvasToolbar=\{[\s\S]{0,500}爆款视频预览/, '中央画布不得再为预览切换保留顶部行');
assert.match(studioSource, /aria-pressed=\{canvasView === 'reference'\}[\s\S]{0,220}min-h-11[\s\S]{0,400}aria-pressed=\{canvasView === 'creation'\}[\s\S]{0,220}min-h-11/, '预览切换按钮必须满足 44px 触控高度且不得覆盖视频');
assert.doesNotMatch(studioSource, /SocialMvpHandoffPanel/, '真实 MVP 交接凭据不得在内容制作前端显示');
const presenterControls = studioSource.slice(studioSource.indexOf('{isPresenter ? <>'), studioSource.indexOf("selectedMode === 'local'", studioSource.indexOf('{isPresenter ? <>')));
assert.doesNotMatch(presenterControls, />改用企业素材<\/button>/, '数字人分镜不再显示“改用企业素材”快捷按钮');
assert.match(presenterControls, /w-full[^>]*>列入待拍<\/button>/, '删除快捷按钮后待拍操作应独占整行');
assert.doesNotMatch(workbenchSource, /生产信息|路线<\/dt>|成本<\/dt>/, '分镜列表不得显示路线、成本等生产信息');
assert.match(studioSource, /本批计划上限[^]*?并非账户余额[^]*?不会自动提交/, '预算说明必须区分任务上限、账户余额与真实提交费用');
assert.match(studioSource, /frameCandidates\.length \? frameCandidates\.map\(item => <option key=\{item\.id\} value=\{item\.id\}/, '当前封面底图只能从有效帧候选选择');
assert.match(studioSource, /coverRecommendationClips\.map\(\(item, index\)[\s\S]{0,650}cover === item\.id/, '推荐封面必须标识当前选中的真实素材');
assert.doesNotMatch(studioSource, /coverMaterialVersions\.filter/, '不可达旧面板的跨版本封面计数不应返回');
assert.match(studioSource, /voiceoverMode === 'none' \? '配置就绪：无配音' : '配置就绪，渲染后试听'/, '不配音不能显示配音已生成');
assert.match(studioSource, /activeStepId: step, activeStoryboardSlotId, canvasView, scriptStageTab/, '草稿应保存工作位置');
assert.match(studioSource, /s.activeStepId \?\? s.workspaceStep[^]*?restoredSteps\.findIndex\(item => item.id === restoredStepId\)/, '重新打开草稿应回到保存的步骤');

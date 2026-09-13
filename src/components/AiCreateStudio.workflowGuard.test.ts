import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  StudioRequestTimeoutError,
  enterpriseBuyerText,
  isUnverifiedLegacyCoverTitle,
  validateStudioTimeline,
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

const studioSource = readFileSync(fileURLToPath(new URL('./AiCreateStudio.tsx', import.meta.url)), 'utf8');
assert.match(studioSource, /usableDuration > 8[^]*?Math\.ceil\(usableDuration \/ 8\)[^]*?longer final slot[^]*?连续片段/, '单条长视频应拆成连续分镜并为唯一 CTA 留出足够时长');
assert.match(studioSource, /response\.validationIssues\?\.length[^]*?issueIndex \+ 1/, '脚本质量阻断应把全部可操作问题展示给用户');
assert.match(studioSource, /hookCoversLockedTimeline[^]*?Object\.fromEntries\(storyboardSlots\.map/, '足够长的来源素材应按全部锁定分镜连续复用');

console.log('AiCreateStudio workflow guard tests passed');

assert.match(studioSource, /modeNotice && <div role="status"/, '镜头制作和预览也必须显示操作及降级提示');
assert.match(studioSource, /coverMaterialVersions\.filter\(item => Boolean\(materialVersionCovers\[item.key\]\)\)\.length/, '封面计数只能统计当前有效版本');
assert.match(studioSource, /脚本已就绪 · 不配音 · 尚未配乐/, '不配音不能显示配音已生成');
assert.match(studioSource, /workspaceStep: step, workspaceScriptStage: scriptStageTab/, '草稿应保存工作位置');
assert.match(studioSource, /savedSteps\.findIndex\(item => item.id === p.spec.workspaceStep\)/, '重新打开草稿应回到保存的步骤');

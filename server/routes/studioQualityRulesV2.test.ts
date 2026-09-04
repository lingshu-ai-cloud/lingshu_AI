import assert from 'node:assert/strict';
import {
  assessScriptQualityV2,
  hardScriptSafetyIssues,
  isBusinessRoleEntity,
  materialCoverageForScript,
  materialTimelineWarningsV2,
  neutralizeUnsupportedMaterialVisuals,
} from '../lib/studioScriptQualityV2.js';
import {
  ensureMaterialCanonicalCta,
  materialGroundingIssues,
} from './studio.js';

const productInfo = `产品名称：LX-Vision 工业视觉检测工作站
所属类目：工厂自动化
已核实事实：可根据工件、节拍、缺陷样本或现场布局开展方案诊断`;
const materialObservation = '素材：气动输送带与工件；观察到工件在输送带上移动；未观察到文字或显示设备';
const primaryCta = '发送工件、节拍、缺陷样本或现场布局，预约一次 30 分钟英文方案诊断';
const targetBuyers = 'Factory Automation Manager、Engineering Manager、Plant Manager、Project Buyer';
const compatibilityClaim = '已验证兼容PCB处理、自动化工位与标准机械机构';
const observedEquipment = '已提供PCB板处理、控制面板、自动化工位和机械机构的真实视频；不据此推断未确认的型号、产能或精度';
assert.match(hardScriptSafetyIssues(`字幕：${compatibilityClaim}。`, observedEquipment).join('；'), /未验证的兼容性/);
assert.match(hardScriptSafetyIssues('台词：verified compatible with PCB handling.', observedEquipment).join('；'), /未验证的兼容性/);
assert.match(hardScriptSafetyIssues(`台词：${compatibilityClaim}`, '已验证兼容其他设备').join('；'), /未验证的兼容性/);
assert.deepEqual(hardScriptSafetyIssues(`台词：${compatibilityClaim}。`, `已核实事实：${compatibilityClaim}。`), []);
assert.deepEqual(hardScriptSafetyIssues('台词：请提供应用需求，由工程师核实兼容性。', observedEquipment), []);


// Buyer roles are audience entities. They must never be interpreted as an
// unsupported brand or machine name merely because they use title case.
for (const role of [
  'Factory Automation Manager',
  'Engineering Manager',
  'Plant Manager',
  'Project Buyer',
]) {
  assert.equal(isBusinessRoleEntity(role, targetBuyers), true, `${role} should be classified as a business role`);
}
const roleStoryboard = `[0-4s]
素材：气动输送带
环境：工厂
景别：中景
运镜：固定
构图：工件居中
镜头功能：买家钩子
画面：工件沿气动输送带移动
配乐：机械环境声
台词：Factory Automation Manager, how do you verify this risk?
字幕：Factory Automation Manager, how do you verify this risk?`;
assert.deepEqual(
  materialGroundingIssues(roleStoryboard, productInfo, materialObservation),
  [],
  'known buyer roles must not trigger the unsupported brand/device rule',
);

const fiveSceneStoryboard = Array.from({ length: 5 }, (_, index) => {
  const start = index * 4;
  const end = start + 4;
  return `[${start}-${end}s]
素材：气动输送带
环境：工厂
景别：中景
运镜：固定
构图：工件居中
镜头功能：${index === 0 ? '买家钩子' : index === 4 ? 'CTA' : '产品证据'}
画面：工件沿气动输送带移动
配乐：机械环境声
台词：${index === 4 ? primaryCta : '无'}
字幕：${index === 4 ? primaryCta : '无'}`;
}).join('\n');
const singleMaterial = [{ name: '气动输送带', targetStart: 0, targetEnd: 4 }];
const coverage = materialCoverageForScript(fiveSceneStoryboard, singleMaterial);
assert.deepEqual(coverage, {
  selectedMaterials: 1,
  storyboardScenes: 5,
  boundScenes: 1,
  pendingScenes: 4,
  coverageRatio: 0.2,
});
assert.match(materialTimelineWarningsV2(fiveSceneStoryboard, singleMaterial).join('\n'), /素材覆盖不足/);

const segmentedSingleMaterial = [{
  name: '气动输送带长视频',
  targetStart: 0,
  targetEnd: 20,
  observations: Array.from({ length: 5 }, (_, index) => `${index * 4}-${(index + 1) * 4}s：可信分段${index + 1}`),
}];
const segmentedCoverage = materialCoverageForScript(fiveSceneStoryboard, segmentedSingleMaterial);
assert.equal(segmentedCoverage.selectedMaterials, 1);
assert.equal(segmentedCoverage.boundScenes, 5);
assert.equal(segmentedCoverage.pendingScenes, 0);
assert.equal(segmentedCoverage.coverageRatio, 1);
assert.doesNotMatch(materialTimelineWarningsV2(fiveSceneStoryboard, segmentedSingleMaterial).join('\n'), /素材覆盖不足/);
const materialShortage = assessScriptQualityV2({
  script: fiveSceneStoryboard,
  productInfo,
  materialsText: materialObservation,
  materialInfos: singleMaterial,
  primaryCta,
  targetBuyerText: targetBuyers,
});
assert.equal(materialShortage.qualityStatus, 'needs_material');
assert.deepEqual(materialShortage.hardIssues, []);
assert.equal(materialShortage.materialCoverage.pendingScenes, 4);
assert.match(materialShortage.warnings.join('\n'), /素材覆盖不足/);
const shortageBlocks = materialShortage.script.split(/(?=^\[\d)/m).filter(block => /^\[\d/.test(block));
assert.equal(shortageBlocks.length, 5);
assert.match(shortageBlocks[0] || '', /^素材：气动输送带$/m);
for (const block of shortageBlocks.slice(1)) {
  assert.match(block, /^素材：待匹配素材$/m);
  assert.match(block, /^镜头功能：待补素材$/m);
  assert.match(block, /^画面：待匹配素材；需补充能够证明本段信息的实际画面$/m);
}

// Unsupported visuals may be reported to the user, but must also be removed
// from the safe script. Returning the hallucinated scene unchanged is unsafe.
const hallucinatedVisualStoryboard = `[0-5s]
素材：气动输送带
环境：展板前
景别：中景
运镜：固定
构图：logo 与屏幕居中
镜头功能：产品证据
画面：镜头展示展板、logo 与检测屏幕
配乐：机械环境声
台词：看屏幕上的检测结果。
字幕：看屏幕上的检测结果。`;
const neutralized = neutralizeUnsupportedMaterialVisuals(
  hallucinatedVisualStoryboard,
  productInfo,
  materialObservation,
);
assert.doesNotMatch(neutralized.script, /展板|logo|屏幕|检测结果/i);
assert.match(neutralized.script, /^素材：待匹配素材$/m);
assert.match(neutralized.script, /^镜头功能：待补素材$/m);
assert.match(neutralized.script, /^画面：待匹配素材；需补充能够证明本段信息的实际画面$/m);
assert.match(neutralized.warnings.join('\n'), /素材未支持的画面/);
const hallucinationAssessment = assessScriptQualityV2({
  script: hallucinatedVisualStoryboard,
  productInfo,
  materialsText: materialObservation,
  materialInfos: singleMaterial,
  primaryCta,
  targetBuyerText: targetBuyers,
});
assert.equal(hallucinationAssessment.qualityStatus, 'warning', 'a fully grounded deterministic repair may proceed without inventing replacement material');
assert.deepEqual(hallucinationAssessment.hardIssues, []);
assert.doesNotMatch(hallucinationAssessment.script, /展板|logo|屏幕|检测结果/i);
assert.match(hallucinationAssessment.script, /^素材：气动输送带$/m);
assert.match(hallucinationAssessment.script, /^画面：原样展示已选素材；不补充未确认的物体、文字或动作$/m);

// Model output may hide unsupported visual nouns in shot/camera/music fields.
// These fields must be repaired too; otherwise the route's grounding pass
// rejects an otherwise usable script and leaves the user stuck at 0%.
const hiddenUnsupportedVisualStoryboard = `[0-4s]
素材：气动输送带
环境：工厂
景别：特写（设备操作界面局部）
运镜：从 logo 缓慢推进到屏幕
构图：工件居中
镜头功能：产品证据
画面：工件沿气动输送带移动
配乐：轻提示音模拟 interface chime
台词：Check the visible evidence.
字幕：Check the visible evidence.
[4-8s]
素材：气动输送带
环境：工厂
景别：中景
运镜：固定
构图：工件居中
镜头功能：CTA
画面：工件沿气动输送带移动
配乐：机械环境声
台词：${primaryCta}
字幕：${primaryCta}`;
const repairedHiddenVisuals = assessScriptQualityV2({
  script: hiddenUnsupportedVisualStoryboard,
  productInfo,
  materialsText: materialObservation,
  materialInfos: [{
    name: '气动输送带',
    targetStart: 0,
    targetEnd: 4,
    observations: ['工件沿气动输送带移动'],
  }],
  primaryCta,
  targetBuyerText: targetBuyers,
});
assert.equal(repairedHiddenVisuals.qualityStatus, 'needs_material');
assert.deepEqual(repairedHiddenVisuals.hardIssues, []);
assert.equal(repairedHiddenVisuals.materialCoverage.coverageRatio, 0.5);
assert.doesNotMatch(repairedHiddenVisuals.script, /logo|界面|屏幕|interface/i);
const repairedHiddenBlocks = repairedHiddenVisuals.script.split(/(?=^\[\d)/m).filter(block => /^\[\d/.test(block));
assert.match(repairedHiddenBlocks[0] || '', /^素材：气动输送带$/m);
assert.match(repairedHiddenBlocks[0] || '', /^景别：特写$/m);
assert.match(repairedHiddenBlocks[0] || '', /^运镜：缓慢推进$/m);
assert.match(repairedHiddenBlocks[0] || '', /^画面：按已选素材观察呈现：工件沿气动输送带移动$/m);
assert.match(repairedHiddenBlocks[1] || '', /^素材：待匹配素材$/m);

// The complete enterprise CTA is deterministic on-screen copy. It must be
// restored verbatim in the final scene even when the spoken line is compacted
// to fit the shot duration.
const genericClosingStoryboard = `[0-4s]
素材：气动输送带
环境：工厂
画面：工件沿输送带移动
镜头功能：买家钩子
台词：采购，怎么判断自动化风险？
字幕：采购，怎么判断自动化风险？
[4-8s]
素材：待匹配素材
环境：按后续补充素材的实际环境
画面：待匹配素材；需补充能够证明本段信息的实际画面
镜头功能：CTA
台词：联系我们。
字幕：联系我们。`;
const canonicalClosing = ensureMaterialCanonicalCta(
  genericClosingStoryboard,
  primaryCta,
  'zh',
  true,
);
const closingBlock = canonicalClosing.split('[4-8s]')[1] || '';
assert.match(closingBlock, /^镜头功能：CTA$/m);
assert.match(closingBlock, new RegExp(`^字幕：${primaryCta}$`, 'm'));
assert.equal((canonicalClosing.match(new RegExp(primaryCta, 'g')) || []).length, 1);
assert.doesNotMatch(closingBlock, /^字幕：(联系我们|预约诊断|发工件和节拍，预约方案诊断)。?$/m);

// Numbers and absolute promises are factual safety boundaries, not quality
// preferences. They must remain hard failures even when material shortages and
// visual hallucinations are downgraded to a repairable needs_material state.
const unsafeClaims = '台词：检测准确率达到 99%，保证零缺陷，永不漏检。';
const unsafeClaimIssues = hardScriptSafetyIssues(unsafeClaims, productInfo);
assert.match(unsafeClaimIssues.join('\n'), /资料未提供的数字[^\n]*99%/);
assert.match(unsafeClaimIssues.join('\n'), /绝对化或不可验证承诺[^\n]*(保证|零缺陷|永不漏)/);
const rejectedUnsafeClaims = assessScriptQualityV2({
  script: `[0-5s]\n素材：气动输送带\n环境：工厂\n画面：工件沿输送带移动\n${unsafeClaims}\n字幕：检测准确率达到 99%，保证零缺陷，永不漏检。`,
  productInfo,
  materialsText: materialObservation,
  materialInfos: singleMaterial,
  primaryCta,
  targetBuyerText: targetBuyers,
});
assert.equal(rejectedUnsafeClaims.qualityStatus, 'rejected');
assert.ok(rejectedUnsafeClaims.hardIssues.length >= 2);

assert.deepEqual(
  hardScriptSafetyIssues('台词：最低起订量为100瓶。\n字幕：最低起订量为 100 瓶。', '产品名称：真实产品\nMOQ：１００　瓶起订'),
  [],
  'the server-side quality gate must treat full-width and spacing variants of the same MOQ as supported',
);
assert.match(
  hardScriptSafetyIssues('高纯度配方符合美国市场基础合规要求。', '产品名称：真实产品\nMOQ：100 瓶起订').join('\n'),
  /产品资料未提供的声明/,
  'unsupported purity and compliance claims must remain a hard failure when deterministic storyboard repair cannot run',
);

const unsupportedProductAndVisualClaims = `[0-4s]
素材：真实产品图
环境：桌面
景别：特写
运镜：固定
构图：瓶身居中
镜头功能：产品证据
画面：标签已有 FOR SENSITIVE SKIN 和 MOQ 字样，旁边出现二维码、邮箱与品牌VI
配乐：轻节奏铺底
台词：高纯度配方符合美国市场基础合规要求。
字幕：高纯度配方符合美国市场基础合规要求。`;
const repairedUnsupportedClaims = assessScriptQualityV2({
  script: unsupportedProductAndVisualClaims,
  productInfo: '产品名称：真实产品\nMOQ：100 瓶起订',
  materialsText: '真实产品瓶体置于桌面；未观察到标签文字、二维码、邮箱、VI 或认证标识',
  materialInfos: [{ name: '真实产品图', targetStart: 0, targetEnd: 4, observations: ['真实产品瓶体置于桌面'] }],
  primaryCta,
  targetBuyerText: targetBuyers,
});
assert.equal(repairedUnsupportedClaims.qualityStatus, 'warning');
assert.deepEqual(repairedUnsupportedClaims.hardIssues, []);
assert.doesNotMatch(repairedUnsupportedClaims.script, /高纯度|美国市场基础合规|FOR SENSITIVE SKIN|MOQ 字样|二维码|邮箱|品牌VI/i);
assert.match(repairedUnsupportedClaims.script, /^画面：按已选素材观察呈现：真实产品瓶体置于桌面$/m);
assert.match(repairedUnsupportedClaims.warnings.join('\n'), /已按已选素材的真实可见内容修复/);

console.log('studio quality rules V2 tests passed');

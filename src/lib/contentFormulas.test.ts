import assert from 'node:assert/strict';
import {
  DEFAULT_CONTENT_FORMULA_DIRECTION,
  createDefaultContentFormulaNode,
  validateContentFormulaDraft,
} from './contentFormulas';

const validNode = {
  ...createDefaultContentFormulaNode(0),
  shotFunction: '证明产品卖点',
  subject: '精华液与检测报告',
  action: '同框近景展示',
  environment: '明亮实验室桌面',
  composition: '产品居中，检测报告在右侧作为证据',
};

const validDirection = structuredClone(DEFAULT_CONTENT_FORMULA_DIRECTION);
validDirection.visualStyle = '真实、专业的产品纪录感';
validDirection.music.mood = '清晰、专业';
validDirection.music.strategy = '口播时降低音量，转场时稍强';
validDirection.music.licenseVerified = true;
validDirection.music.licenseReference = 'licensed-library:track-001';
validDirection.subtitles.styleIntent = '白字深色描边，重点词高亮';
validDirection.cover.intent = '让客户一眼看懂卖点证据';
validDirection.cover.headlineTemplate = { zh: '{{product}}有什么不同', en: 'Why {{product}} is different' };
validDirection.cover.subject = '产品与检测报告';
validDirection.cover.composition = '产品居中，标题置于上方';
validDirection.acceptanceGates = [{ gateId: 'claims_check', name: '事实核验', rule: '所有功效表述必须有企业知识依据', blocking: true }];

const validDraft = {
  formulaId: 'custom.product-proof',
  name: '产品证据链',
  version: '1.0.0',
  direction: validDirection,
  nodes: [validNode],
};

assert.deepEqual(validateContentFormulaDraft(validDraft), []);
assert.equal(validNode.scriptTemplate.zh.includes('{{shotFunction}}'), true);
assert.equal(validNode.voiceoverTemplate.en.includes('{{product}}'), true);
assert.equal(validNode.captionTemplate.zh.includes('{{product}}'), true);

const unsupportedToken = structuredClone(validDraft);
unsupportedToken.nodes[0]!.captionTemplate.zh = '{{secretPrompt}}';
assert.match(validateContentFormulaDraft(unsupportedToken).join('；'), /字幕中文模板包含不支持的变量/);

const invalidDirection = structuredClone(validDraft);
invalidDirection.direction.music.volume = 101;
invalidDirection.direction.voiceover.speed = 0.5;
invalidDirection.direction.subtitles.bottomRatio = 0.5;
const directionIssues = validateContentFormulaDraft(invalidDirection).join('；');
assert.match(directionIssues, /音乐音量需在 0 至 100 之间/);
assert.match(directionIssues, /配音语速需在 0.75 至 1.5 之间/);
assert.match(directionIssues, /字幕底部位置需在画面高度的 8% 至 35% 之间/);

const incompleteDirector = structuredClone(validDraft);
incompleteDirector.direction.visualStyle = '';
incompleteDirector.direction.music.licenseVerified = false;
incompleteDirector.direction.cover.headlineTemplate.en = '';
incompleteDirector.direction.acceptanceGates[0]!.blocking = false;
const directorIssues = validateContentFormulaDraft(incompleteDirector).join('；');
assert.match(directorIssues, /视觉风格需填写/);
assert.match(directorIssues, /必须确认版权/);
assert.match(directorIssues, /封面标题英文模板需填写/);
assert.match(directorIssues, /至少一项验收门槛需设为阻断项/);

const invalidNodeExecution = structuredClone(validDraft);
invalidNodeExecution.nodes[0]!.environment = '';
invalidNodeExecution.nodes[0]!.durationSeconds = { minimum: 9, maximum: 8 };
const executionIssues = validateContentFormulaDraft(invalidNodeExecution).join('；');
assert.match(executionIssues, /拍摄环境需填写/);
assert.match(executionIssues, /时长需大于 0/);

const duplicateNodes = structuredClone(validDraft);
duplicateNodes.nodes.push({ ...structuredClone(validNode) });
assert.match(validateContentFormulaDraft(duplicateNodes).join('；'), /镜头节点编号不能重复/);

console.log('content formula director configuration tests passed');

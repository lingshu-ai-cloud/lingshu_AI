import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual component helpers in a bounded VM: a regression must
// fail quickly rather than freeze the test runner just like the browser.
const source = readFileSync(new URL('./AiCreateStudio.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('studio.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set([
  'parseCueRange', 'normalizeTimeLabel', 'looksLikeProductionInstruction',
  'hasStoryboardFieldLabels', 'looksLikeOnScreenOnlyText', 'cleanVoiceoverLine',
  'mergeTimestampedVoiceoverSegments', 'parseTimestampedVoiceover',
  'formatVoiceoverWithTimestamps', 'compactComparable', 'isNonSpeechSfx',
]);
const declarations = ast.statements.filter(node =>
  ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)
  || ts.isVariableStatement(node) && node.declarationList.declarations.some(d =>
    ts.isIdentifier(d.name) && ['VOICEOVER_FIELD_RE', 'NON_VOICE_FIELD_RE'].includes(d.name.text)),
).map(node => node.getText(ast)).join('\n');
const js = ts.transpileModule(declarations, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const context = vm.createContext({});
vm.runInContext(js, context);
const evaluate = (expression: string) => vm.runInContext(expression, context, { timeout: 1000 });
for (const text of [
  'LX-Press Servo Press-Fit Cell 配乐：工业感节奏鼓点',
  'Assembly line automation system for your factory!',
  `${'A'.repeat(10000)}!`,
]) {
  assert.equal(evaluate(`looksLikeOnScreenOnlyText(${JSON.stringify(text)})`), false);
}
for (const text of ['PDF', 'OEM', 'ABC-123', '123.45']) {
  assert.equal(evaluate(`looksLikeOnScreenOnlyText(${JSON.stringify(text)})`), true);
}
const silent = '[0-7.3s]\n素材：Assembly line\n环境：工厂\n画面：LX-Press Servo Press-Fit Cell\n台词：无\n字幕：预约方案诊断';
assert.equal(evaluate(`formatVoiceoverWithTimestamps(${JSON.stringify(silent)})`), '');
assert.equal(evaluate(`formatVoiceoverWithTimestamps(${JSON.stringify(silent.replaceAll('\n', ' '))})`), '');
assert.match(String(evaluate('formatVoiceoverWithTimestamps("[0-3s]\\n画面：工厂\\n台词：欢迎了解我们的产品。\\n字幕：联系我")')), /欢迎了解我们的产品/);
assert.equal(evaluate('formatVoiceoverWithTimestamps("Send us your sample for a review.")'), 'Send us your sample for a review.');
console.log('voiceover freeze regressions passed');

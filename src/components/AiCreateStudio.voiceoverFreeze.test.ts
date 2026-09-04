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
  'publishCaption', 'stripVoiceoverTimestamps',
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

for (const text of ['Vous avez besoin d’automatisation ?', 'Voice recognition works.', 'Bodywork matters.', 'Captioning is useful.']) {
  assert.equal(evaluate(`cleanVoiceoverLine(${JSON.stringify(text)})`), text);
}
assert.equal(evaluate('cleanVoiceoverLine("VO: Welcome!")'), 'Welcome!');
const spoken = silent.replace('台词：无', '台词：发来工件，我们一起评估方案。');
assert.equal(evaluate(`formatVoiceoverWithTimestamps(${JSON.stringify(spoken.replaceAll('\n', ' '))})`), '[0-7.3s] 发来工件，我们一起评估方案。');
assert.equal(evaluate('publishCaption("Factory-direct home essentials 🏠✨ #tiktokmademebuyit #homefinds", "[0-7s] Need automation?")'), 'Need automation?');
assert.equal(evaluate('publishCaption("Our custom caption", "[0-7s] Need automation?")'), 'Our custom caption');

// Exercise the real server splitter without initializing routes or providers.
const serverSource = readFileSync(new URL('../../server/routes/studio.ts', import.meta.url), 'utf8');
const serverAst = ts.createSourceFile('studio.ts', serverSource, ts.ScriptTarget.Latest, true);
const splitter = serverAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'splitSubtitleText')!;
vm.runInContext(ts.transpileModule(splitter.getText(serverAst), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
for (const text of ['Send us your part specs and cycle time—we’ll evaluate a solution together.', 'Envoyez vos pièces et votre cadence : évaluons ensemble une solution.']) {
  const chunks = Array.from(evaluate(`splitSubtitleText(${JSON.stringify(text)})`)) as string[];
  assert.equal(chunks.join(' '), text, 'subtitle boundaries preserve words and apostrophes');
  assert.ok(chunks.every(chunk => chunk.length <= 42));
}
console.log('voiceover parsing, publishing and subtitle boundary regressions passed');

// Run the component's actual storyboard memo with changing preview state.
// This is the input to source trims and every render signature. A language
// switch must preserve it, including after serializing/restoring the draft.
let storyboardMemo: ts.Expression | undefined;
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'storyboardSlots') storyboardMemo = node.initializer;
  ts.forEachChild(node, visit);
};
visit(ast);
assert.ok(storyboardMemo);
const memoScript = ts.transpileModule(`(${storyboardMemo.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const originalSlots = [{ id: 'shot-1', start: 0, end: 7.3 }];
const renderContext = vm.createContext({
  useMemo: (fn: () => unknown) => fn(),
  script: spoken, duration: 7.3, activeVoiceLang: 'zh', voiceoverMode: 'ai', voiceoverDur: 4.5,
  voiceoverAudios: { zh: { duration: 4.5 }, en: { duration: 6.6 }, fr: { duration: 5.6 } },
  parseStoryboardSlots: () => JSON.parse(JSON.stringify(originalSlots)),
  fitStoryboardSlotsToDuration: (slots: typeof originalSlots, duration: number) => slots.map(slot => ({ ...slot, end: duration })),
});
for (const language of ['zh', 'en', 'fr', 'zh']) {
  renderContext.activeVoiceLang = language;
  assert.equal(JSON.stringify(vm.runInContext(memoScript, renderContext)), JSON.stringify(originalSlots), 'preview language must preserve render source boundaries');
}
console.log('render source stability across language switches passed');

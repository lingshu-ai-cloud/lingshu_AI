import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const auditDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(auditDir, '../..');
const require = createRequire(`${root}/package.json`);
const ts = require('typescript');
const transpile = (s) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function pureModule(relative) {
  const exports = {};
  vm.runInNewContext(transpile(fs.readFileSync(`${root}/${relative}`, 'utf8')), { exports }, { timeout: 2000 });
  return exports;
}
const source = fs.readFileSync(`${root}/server/routes/studio.ts`, 'utf8');
const ast = ts.createSourceFile('studio.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const constants = new Set(['LANG_NAME', 'TECH_TERM_RE', 'MAX_INTERACTIVE_SCRIPT_REPAIR_ATTEMPTS']);
const declarations = ast.statements.filter(n =>
  ts.isFunctionDeclaration(n) && n.name?.text !== 'enterpriseCtx'
  || ts.isVariableStatement(n) && n.declarationList.declarations.some(d => ts.isIdentifier(d.name) && constants.has(d.name.text))
).map(n => n.getText(ast).replace(/^export\s+/, '')).join('\n');
let route;
for (const n of ast.statements) {
  if (!ts.isExpressionStatement(n) || !ts.isCallExpression(n.expression)) continue;
  const call = n.expression;
  if (call.expression.getText(ast) === 'studioRouter.post' && call.arguments[0]?.text === '/script') route = call.arguments[1].getText(ast);
}
if (!route) throw new Error('script route missing');
let modelCalls = 0;
const context = vm.createContext({
  ...pureModule('server/strategy/scriptBrief.ts'),
  ...pureModule('server/lib/studioScriptQualityV2.ts'),
  consumeDemoQuota: async () => true,
  enterpriseCtx: async () => '',
  callLLM: async () => { modelCalls++; return '{"lines":["Bad generic opening","Detail one","Detail two","Message us"]}'; },
  console: { warn() {}, log() {} },
});
vm.runInContext(transpile(`${declarations}\nglobalThis.auditHandler = ${route};`), context, { timeout: 3000 });
const evaluate = expression => vm.runInContext(expression, context, { timeout: 1000 });
async function run(body) {
  let result;
  let status = 200;
  modelCalls = 0;
  await context.auditHandler({ body }, { status(n) { status = n; return this; }, json(body) { result = body; return this; } });
  return { status, calls: modelCalls, ...result };
}
const base = {
  generationMode: 'product', scriptType: 'storyboard', voiceoverMode: 'ai', duration: 20,
  language: 'en', cooperationRoute: 'consumer_retail',
  productInfo: '产品名称：Audit 润唇膏\n产品卖点：5g；旋转管设计',
  videoTheme: { id: 'buyer_pain', title: '买家痛点', primaryCta: 'Message us for details.' },
};
const first = await run(base);
const second = await run({ ...base, tone: '另一个创意版本', variantSeed: 2 });
const durationCase = await run({ ...base, duration: 10, language: 'zh', videoTheme: { id: 'buyer_pain', primaryCta: '私信了解产品资料' } });
const wrongSpec = await run({ ...base, duration: 40, cooperationRoute: 'wholesale_distribution', language: 'zh', videoTheme: { id: 'buyer_pain', primaryCta: '私信了解产品资料' } });
const germanCase = await run({ ...base, language: 'de', productInfo: '产品名称：Audit 工业工作站\n产品卖点：铝合金结构；触摸屏操作', cooperationRoute: 'oem_odm' });
const reports = {
  englishLipBalm: { status: first.status, qualityStatus: first.qualityStatus, source: first.source, modelCalls: first.calls, spokenLines: first.script?.match(/^台词：.*$/gm), checks: first.qualityChecks, warnings: first.validationWarnings },
  variants: { sameScript: first.script === second.script, secondModelCalls: second.calls },
  duration10: { status: durationCase.status, timeline: durationCase.script?.match(/^\[.*\]$/gm), dialogueFits: durationCase.qualityChecks?.dialogueFits },
  wrongSpec40: { status: wrongSpec.status, wrong45gPresent: /4\.5g/.test(wrongSpec.script || ''), issues: wrongSpec.validationIssues },
  germanFallback: { status: germanCase.status, qualityStatus: germanCase.qualityStatus, spokenLines: germanCase.script?.match(/^台词：.*$/gm), modelCalls: germanCase.calls },
  numericMeaning: evaluate('hardScriptSafetyIssues("台词：30天交付。", "产品名称：测试设备\\n质保：30天\\n交期：待确认")'),
};
const mixed = '这是 ' + Array(17).fill('a').join(' ');
context.mixed = mixed;
reports.mixedTiming = evaluate(`(() => { const s = serializeLockedStoryboard(safeProductScenes('产品名称：测试产品', 4), Array(4).fill(mixed), 20); return { ranges:s.match(/^\\[.*\\]$/gm), issues:storyboardSpeechIssues(s) }; })()`);
const sample = JSON.parse(fs.readFileSync(`${root}/data/release-verification/2026-09-05/attempt-1/artifacts/projects.json`, 'utf8'))[0];
context.sampleScript = sample.script;
reports.savedAcceptanceSample = { stage: sample.automation?.stage, speechIssues: evaluate('storyboardSpeechIssues(sampleScript)') };
console.log(JSON.stringify(reports, null, 2));
fs.writeFileSync(path.join(auditDir, 'results.json'), JSON.stringify(reports, null, 2));

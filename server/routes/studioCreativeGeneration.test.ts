import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { SCRIPT_CREATIVE_QUALITY_RULES, SCRIPT_FACT_TO_VALUE_EXAMPLES, scriptUnusedFacts, scriptSelectedFactContext, scriptSelectedFactPhrase, scriptSelectedFactProductName, scriptNarrationFromPlan, scriptNarrationLinesFromPlan, scriptEndingRules, scriptVariantDirection } from '../prompts/scriptCreativeQuality.js';

const sourceFacts = '产品名称：样品设备\n产品规格：可配置快换工装；需要外接控制器时启用防错识别\n产品卖点：压力闭环';
const focused = scriptSelectedFactContext(JSON.stringify({ factBasis: ['快换工装'] }), sourceFacts);
assert.match(focused, /可配置快换工装/);
assert.match(focused, /需要外接控制器/);
assert.doesNotMatch(focused, /压力闭环/);
assert.equal(scriptSelectedFactContext(JSON.stringify({ factBasis: ['自动纠偏'] }), sourceFacts), sourceFacts);
assert.equal(scriptSelectedFactContext('{bad json', sourceFacts), sourceFacts);
assert.equal(scriptSelectedFactPhrase('{"factBasis":["快换工装"]}', '产品规格：1—100 kN 可选；可配置快换工装与防错识别'), '可配置快换工装与防错识别');
assert.equal(scriptSelectedFactPhrase('{"factBasis":["快换工装"]}', sourceFacts), '可配置快换工装；需要外接控制器时启用防错识别');
assert.equal(scriptSelectedFactPhrase('{"factBasis":["自动识别"]}', sourceFacts), '');
assert.equal(scriptSelectedFactProductName('{"factBasis":["防错识别"]}', '产品名称：设备甲\n产品卖点：压力闭环\n产品名称：设备乙\n产品规格：可配置防错识别'), '设备乙');
assert.deepEqual(scriptUnusedFacts(['可配置快换工装与防错识别', '支持条码绑定、曲线存档和 MES 上传'], '快换工装是可配置的。先把自己的换型需求说清楚。'), ['支持条码绑定、曲线存档和 MES 上传']);
assert.deepEqual(scriptUnusedFacts(['supports label and box customization', 'removable liner'], 'Ask about BOX CUSTOMIZATION.'), ['removable liner']);

assert.equal(scriptNarrationFromPlan('{"narration":"第一句话。接着解释。"}'), '第一句话。接着解释。');
assert.equal(scriptNarrationFromPlan('{"lines":["第一句。","第二句。"]}'), '第一句。 第二句。');
assert.equal(scriptNarrationFromPlan('{"narration":123}'), '');
for (const narration of [
  '工装换上去了，然后呢？怎么确认装的是对的？选设备时，这两件事放在一起问。',
  'Can you reach the bottom? This liner comes out. Think about how you would wash it, before choosing a cup.',
  'La doublure est amovible. Comment allez-vous la laver ? Pensez-y avant de choisir.',
  '口播不够四段时也不切断词语',
]) {
  const split = scriptNarrationLinesFromPlan(JSON.stringify({ narration }), 4);
  assert.ok(split.length > 0 && split.length <= 4);
  assert.equal(split.join('').replace(/\s/g, ''), narration.replace(/\s/g, ''), 'splitting never rewrites or drops narration');
  assert.ok(split.every(Boolean));
}
assert.deepEqual(scriptNarrationLinesFromPlan('{"narration":"规格是1.5毫米。"}', 4), ['规格是1.5毫米。']);
assert.deepEqual(scriptNarrationLinesFromPlan('{"narration":""}', 4), []);
assert.match(scriptEndingRules('reach', ''), /不强塞销售邀请/);
assert.match(scriptEndingRules('reach', '私信聊需求'), /用户指定行动：私信聊需求/);
const prompts: string[] = [];
let lines = ['先别定外盒，把瓶子和标签放一起。', '透明玻璃能看清瓶内状态。', '标签和外盒可以一起定制。', '私信了解产品资料。'];
let malformedVoice = false;
let malformedEdit = false;
let editorProse: string | null = null;
let shortenedLines: string[] | null = null;
let editedLines: string[] | null = [lines[0], '里面看得见吗？透明玻璃能看清。', lines[2], lines[3]];
let cloneResponse = '';
const scenes = Array.from({ length: 4 }, (_, i) => ({
  environment: '建议补拍：桌面', shot: '特写', camera: '固定', composition: '瓶器与标签并排',
  purpose: ['细节钩子', '材质证据', '定制选择', '行动引导'][i],
  visual: '建议补拍：手将透明玻璃瓶与标签并排放下', music: '',
}));
const provider = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const prompt = body.messages.at(-1).content as string;
  prompts.push(prompt);
  const content = cloneResponse || (prompt.startsWith('把口播缩到')
    ? JSON.stringify({ lines: shortenedLines || editedLines || lines })
    : prompt.startsWith('写一段')
    ? malformedEdit ? '{"lines":[]}' : JSON.stringify(editorProse ? { narration: editorProse } : { lines: editedLines || lines })
    : prompt.includes('"factBasis"')
    ? malformedVoice ? '{"lines":[]}' : JSON.stringify({ factBasis: [prompt.match(/本轮可用事实：\n- ([^\n]+)/)?.[1] || prompt.match(/产品资料：([^\n]+)/)?.[1]], viewerQuestion: "内部观众问题", factTranslation: "uses a twist-up tube" })
    : JSON.stringify({ scenes: scenes.slice(0, Number(prompt.match(/恰好 (\d+) 段/)?.[1]) || 4) }));
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
});
await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
const providerAddress = provider.address();
assert.ok(providerAddress && typeof providerAddress !== 'string');
process.env.DASHSCOPE_API_KEY = 'local-test';
process.env.DASHSCOPE_BASE_URL = `http://127.0.0.1:${providerAddress.port}/v1`;
process.env.DEMO_MODE = 'false';
process.env.SUBSCRIPTION_ENFORCED = 'false';
const { auth, store } = await import('../storage/index.js');
auth.verifyToken = async header => header === 'Bearer local-creative-test'
  ? { userId: 'creative-test', tenantId: 'local_tenant_admin_creative_test' } : null;
store.list = async () => ({ items: [], page: 1, perPage: 20, totalItems: 0, totalPages: 0 });
const { studioRouter, storyboardSpeechIssues } = await import('./studio.js');
const app = express();
app.use(express.json());
app.use('/studio', studioRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const base = {
  generationMode: 'product', scriptType: 'storyboard', voiceoverMode: 'ai', duration: 20,
  language: 'zh', platform: 'tiktok', audience: '品牌产品经理', cooperationRoute: 'oem_odm',
  productInfo: '产品名称：测试玻璃瓶\n产品卖点：透明玻璃；支持标签和外盒定制',
  videoTheme: { id: 'customization', title: '定制', primaryCta: '私信了解产品资料' },
};
const generate = async (overrides: Record<string, unknown> = {}) => {
  const response = await fetch(`http://127.0.0.1:${address.port}/studio/script`, {
    method: 'POST', headers: { authorization: 'Bearer local-creative-test', 'content-type': 'application/json' },
    body: JSON.stringify({ ...base, ...overrides }),
  });
  return { status: response.status, body: await response.json() };
};
try {
  const first = await generate();
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(prompts.length, 3, 'grounded angle, continuous narration, then visuals');
  assert.ok(prompts[2].includes(editedLines![1]), 'visuals use the edited narration');
  assert.ok(first.body.script.includes(editedLines![1]), 'final script keeps the edited narration');
  assert.ok(!first.body.script.includes(lines[1]), 'draft is not accidentally restored');
  assert.match(first.body.script, new RegExp(`台词：${lines[0]}`), 'natural opening survives missing role keywords');
  assert.ok(prompts[1].includes(SCRIPT_CREATIVE_QUALITY_RULES));
  assert.ok(prompts[1].includes(SCRIPT_FACT_TO_VALUE_EXAMPLES), "examples reach the actual narration stage");
  assert.doesNotMatch(prompts[0], /"narration"/, 'planning does not create an ungrounded draft to anchor the writer');
  assert.match(prompts[2], /相邻镜头推进信息/);
  assert.match(prompts[2], /建议补拍/);
  assert.match(first.body.script, /^配乐：无$/m, 'an intentionally empty music field is valid silence');
  assert.deepEqual(storyboardSpeechIssues(first.body.script), []);
  assert.doesNotMatch(first.body.script, /仅供内部构思|产品资料原文|内部观众问题|factBasis/, "planning metadata never becomes spoken content");

  await generate({ variantSeed: 1, existingScripts: [first.body.script] });
  assert.ok(prompts[3].includes(lines[0]), 'prior narration reaches the real voice generation stage');
  assert.equal(prompts[3].split(lines[0]).length - 1, 1, 'matching voice and caption are not duplicated in history');
  assert.ok(prompts[3].includes(scriptVariantDirection('product', 1)));
  assert.notEqual(scriptVariantDirection('product', 0), scriptVariantDirection('product', 1));

  editedLines = null;
  lines = ['Look at the tube before the box.', 'The balm uses a twist-up tube.', 'Turn it back after showing the product.', 'Message us for product details.'];
  scenes.forEach(scene => { scene.visual = '建议补拍：手将润唇膏旋出后旋回'; scene.composition = '产品居中'; });
  const balm = await generate({ language: 'en', productInfo: '产品名称：测试润唇膏\n产品卖点：旋转管设计', videoTheme: { id: 'product_proof', primaryCta: 'Message us for product details.' } });
  assert.equal(balm.status, 200, JSON.stringify(balm.body));
  assert.match(balm.body.script, /台词：Look at the tube/);
  assert.doesNotMatch(balm.body.script, /乌兹别克斯坦|4\.5g/);
  assert.equal(prompts.length, 9, 'lip balm uses the same three generation stages');

  lines = ['瓶子和外盒，怎么一起看？', '透明玻璃，瓶内状态能看清。', '标签和外盒可以一起定制。', '选包装时，把搭配也考虑进去。'];
  const reachStart = prompts.length;
  const reach = await generate({ videoTheme: { id: 'customization', contentGoal: 'reach' } });
  assert.equal(reach.status, 200, JSON.stringify(reach.body));
  assert.doesNotMatch(reach.body.script, /私信|报价|购买/);
  assert.match(prompts[reachStart + 1], /观看与互动/);
  assert.doesNotMatch(prompts[reachStart], /恰好 4 句|中文最多 16 字/);
  assert.match(prompts[reachStart + 1], /不分镜、不凑句数/);
  lines[3] = '私信了解产品资料。';
  const explicitCta = await generate({ videoTheme: { id: 'customization', contentGoal: 'reach', primaryCta: '私信了解产品资料' } });
  assert.equal(explicitCta.status, 200, JSON.stringify(explicitCta.body));
  assert.match(explicitCta.body.script, /私信了解产品资料/);

  editedLines = ['这句话很长。'.repeat(30), '还有说明。', '再说标签。', '私信了解产品资料。'];
  shortenedLines = ['先看看瓶子和外盒。', '透明玻璃，里面能看清。', '标签和外盒也能定制。', '私信了解产品资料。'];
  const beforeShorten = prompts.length;
  const shortened = await generate();
  assert.equal(shortened.status, 200, JSON.stringify(shortened.body));
  assert.equal(prompts.length - beforeShorten, 4, 'long drafts get only one extra shortening call');
  assert.ok(shortened.body.script.includes(shortenedLines[1]));
  assert.match(shortened.body.script, /-20s\]/);
  shortenedLines = null;
  const stillLongStart = prompts.length;
  const stillLong = await generate();
  assert.equal(stillLong.status, 422, 'a still-overlong draft cannot silently extend the requested duration');
  assert.equal(stillLong.body.code, 'SCRIPT_DURATION_EXCEEDED');
  assert.match(stillLong.body.error, /增加时长/);
  assert.equal(prompts.length - stillLongStart, 3, 'no visuals after unsuccessful shortening');
  editedLines = null;

  lines = ['先看看瓶子。', '容量是999ml。' , '再看看标签。', '私信了解产品资料。'];
  const falseFact = await generate();
  assert.equal(falseFact.status, 422, 'factual rejection still applies to structured drafts');
  assert.match(falseFact.body.validationIssues.join(' '), /999ml/);

  malformedVoice = true;
  const malformed = await generate();
  assert.equal(malformed.status, 502, 'malformed model output is not presented as an AI template');
  assert.equal(malformed.body.script, '');
  malformedVoice = false;
  malformedEdit = true;
  const beforeBadEdit = prompts.length;
  const badEdit = await generate();
  assert.equal(badEdit.status, 502, 'malformed edit cannot silently fall back to unedited copy');
  assert.equal(badEdit.body.script, '');
  assert.equal(prompts.length - beforeBadEdit, 2, 'no visuals are generated after an invalid edit');
  malformedEdit = false;

  editorProse = '瓶子和外盒，怎么一起看？这款使用透明玻璃。私信了解产品资料。';
  const continuous = await generate();
  assert.equal(continuous.status, 200, JSON.stringify(continuous.body));
  const actualProse = Array.from(continuous.body.script.matchAll(/^台词：(.+)$/gm)).map((match: any) => match[1]).join('');
  assert.equal(actualProse, editorProse, 'route preserves every spoken character around the locked fact');
  assert.doesNotMatch(continuous.body.script, /【产品事实】/, 'internal markers never reach the script or captions');
  assert.match(continuous.body.script, /-20s\]/);
  editorProse = '这款使用透明玻璃。私信了解产品资料。';
  const fewerScenes = await generate();
  assert.equal(fewerScenes.status, 200, JSON.stringify(fewerScenes.body));
  assert.equal((fewerScenes.body.script.match(/^台词：/gm) || []).length, 2, 'fewer natural cuts produce matching visuals without invented speech');
  editorProse = null;

  cloneResponse = Array.from({ length: 4 }, (_, i) => `[${i * 5}-${(i + 1) * 5}s]\n环境：桌面\n景别：特写\n运镜：固定\n构图：瓶器居中\n镜头功能：细节展示\n画面：测试玻璃瓶保持直立，透明玻璃可见\n配乐：轻节奏\n台词：无\n字幕：无`).join('\n\n');
  const beforeCloneCalls = prompts.length;
  const clone = await generate({ generationMode: 'clone', voiceoverMode: 'none', referenceAnalysis: cloneResponse });
  assert.equal(clone.status, 200, JSON.stringify(clone.body));
  assert.equal(prompts.length - beforeCloneCalls, 1, 'silent reference does not trigger CTA repair');
  assert.equal((clone.body.script.match(/^台词：无$/gm) || []).length, 4);
  assert.doesNotMatch(clone.body.script, /私信|Message us|主题钩子/);
} finally {
  server.closeAllConnections(); provider.closeAllConnections();
  await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => provider.close(() => resolve()))]);
}
console.log('studio creative generation regressions passed');

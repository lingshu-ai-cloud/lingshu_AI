import assert from 'node:assert/strict';
import { adPlanningSystemPrompt, parseAdProposal } from './planning.js';
const context = { currency: 'CNY' as const, channels: ['Facebook'] };
const sample = { rationale: '500 CNY 总预算、10 CNY 日预算用于暂停创编验收。', audienceStrategy: '美国软件开发者方向，具体定向可用性待核验。', creativeStrategy: '使用联调素材。', risks: ['没有曝光样本，不能评估商业效果。'], assumptions: ['后续需核验同币种账户。'] };
const prompt = adPlanningSystemPrompt(context);
assert.match(prompt, /在美国定向不要求美元账户/);
assert.match(prompt, /禁止汇率换算/);
assert.match(prompt, /暂停创编\/软件联调是功能验收/);
const proposal = parseAdProposal(JSON.stringify(sample), context);
assert.match(proposal.rationale, /500 CNY/);
assert.ok(proposal.risks.some(text => text.includes('人工审核')));
assert.doesNotThrow(() => parseAdProposal(JSON.stringify({ ...sample, rationale: 'CNY币种符合产品当前支持能力，在美国定向无需更换币种。' }), context));
for (const rationale of [
  '500 CNY（约70 USD），每天10 CNY（约1.4 USD）',
  '500 CNY约合49美元，按汇率估算',
  'Facebook不支持人民币预算，需要更换币种',
  '美国与CNY组合会导致支付链路异常或结算失败',
  'Facebook广告账户默认要求本地币种充值',
  '建议使用$20每日预算',
]) assert.throws(() => parseAdProposal(JSON.stringify({ ...sample, rationale }), context), /未保存/);
assert.throws(() => parseAdProposal(JSON.stringify({ ...sample, risks: ['约70美元'] }), context), /未保存/, 'all proposal sections are validated');
assert.throws(() => parseAdProposal(JSON.stringify(sample), { currency: 'USD', channels: ['Facebook'] }), /未保存/, 'USD proposals cannot silently introduce CNY');
console.log('AI planning currency grounding tests passed (no network or task writes)');

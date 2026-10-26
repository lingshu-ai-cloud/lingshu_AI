import assert from 'node:assert/strict';
import { adPlanningSystemPrompt, parseAdProposal } from './planning.js';
const context = { currency: 'CNY' as const, channels: ['Facebook'], budget: 10 };
const sample = { rationale: '面向美国采购商测试产品视频。', audienceStrategy: '采购商方向，具体定向待核验。', creativeStrategy: '展示产品细节。', risks: ['尚无曝光样本。'], assumptions: ['需核验主页。'] };
assert.match(adPlanningSystemPrompt(context), /财务说明由系统/);
const noisy = [
  '500 CNY（约70 USD），每天10 CNY（约1.4 USD）',
  'Facebook不支持人民币预算，需要更换币种',
  '美国与CNY组合会导致支付链路异常或结算失败',
  '平台默认要求本地币种充值',
  '建议使用$20每日预算',
  '最低预算需要5000元',
  '不涉及汇率换算，但500 CNY约合70美元。',
  '美国定向不要求美元账户，无需更换账户币种。',
  '请增加预算至10000 CNY。',
];
for (const currency of ['CNY', 'USD'] as const) {
  for (const claim of noisy) {
    for (const field of ['rationale', 'audienceStrategy', 'creativeStrategy', 'risks', 'assumptions'] as const) {
      const input = { ...sample, [field]: Array.isArray(sample[field]) ? [claim] : claim };
      const p = parseAdProposal(JSON.stringify(input), { ...context, currency });
      assert.ok(!JSON.stringify(p).includes(claim), `${currency}/${field}: ungrounded claim must not survive`);
      assert.ok(p.assumptions.some(text => text.includes(`总预算上限为 ${currency} 10`)));
      assert.ok(p.risks.some(text => text.includes('已移除')));
      assert.ok(p.rationale && p.audienceStrategy && p.creativeStrategy);
    }
  }
}
const clean = parseAdProposal(JSON.stringify(sample), context);
assert.equal(clean.rationale, sample.rationale);
assert.ok(!clean.risks.some(text => text.includes('已移除')));
const mixed = parseAdProposal(JSON.stringify({ ...sample, rationale: '展示产品细节。约合70美元。突出工艺。' }), context);
assert.equal(mixed.rationale, '展示产品细节。突出工艺。');
assert.throws(() => parseAdProposal('not json', context));
assert.throws(() => parseAdProposal(JSON.stringify({ ...sample, rationale: '' }), context));
console.log('AI prose normalized; user CNY/USD amounts preserved; valid drafts no longer rejected by currency prose.');

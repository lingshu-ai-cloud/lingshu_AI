import test from 'node:test';
import assert from 'node:assert/strict';
import { isAffiliateShoppingGuide, isConsumerCouponPromotion, regulatoryInterpretationSupported } from './industrySourceQuality.js';
import { composeSearchEvidenceAnswer } from './searchEvidenceAnswer.js';
import type { SearchOriginal } from './searchEvidenceAnswer.js';
test('coupon and redemption spam filters target promotional mechanics rather than all price news', () => {
 for (const title of ['唯品会红包优惠券领取攻略', '护肤品折扣码', 'Beauty promo code today', 'Claim your coupon']) assert.equal(isConsumerCouponPromotion(title), true, title);
 for (const title of ['原料成本下降与供应链价格调整', '北美零售商降低美妆产品售价', '包材工厂扩产缓解采购成本压力']) assert.equal(isConsumerCouponPromotion(title), false, title);
});
test('affiliate shopping guide is excluded without excluding independent industry reporting', () => {
 assert.equal(isAffiliateShoppingGuide('Skincare fans are obsessed with this €23 collagen mask that helps you look more youthful', 'This article contains affiliate links.'), true);
 assert.equal(isAffiliateShoppingGuide('New cosmetic ingredient enters commercial production', 'This article contains affiliate links.'), false);
 assert.equal(isAffiliateShoppingGuide('Skincare fans are obsessed with a new ingredient', 'A scientific study reports a new ingredient.'), false);
});
test('closed-book research refuses cached consumer coupon originals before any synthesis', async () => {
 let calls = 0;
 const original: SearchOriginal = { id: 'S4', source: { title: '唯品会双十一红包优惠券领取攻略', uri: 'https://www.dzwww.com/xinwen/jishixinwen/202610/t20261028_18247926.htm' }, published: ['2026-10-28'], text: '本轮大促覆盖美妆、护肤品、彩妆，采用现货直降与优惠券叠加模式。'.repeat(10) };
 await assert.rejects(composeSearchEvidenceAnswer('今日资讯：北美B2B美妆采购', [original], async () => { calls++; return '{}'; }), { code: 'search_originals_unavailable' });
 assert.equal(calls, 0);
});

test('real FDA recall applicability conditions cannot be inverted into an exemption by a supported-number draft', async()=>{
 const text='美国 FDA 于2026年10月将化妆品强制召回问答指南定稿，明确须同时认定“掺假或误标”与“严重健康后果”两个合理可能性，才可命令责任人停止分销并召回，送达后10天内可申请非正式听证。';
 const original:SearchOriginal={id:'S27',source:{title:'化妆品强制召回指南定稿',uri:'https://www.lv-1.cn/BeautyNews/article/2026-10-26-daily'},text,published:['2026-10-26']};
 let calls=0;
 const result=await composeSearchEvidenceAnswer('今日资讯，北美美妆',[original],async()=>{calls++;return JSON.stringify({items:[{sourceId:'S27',quoteIds:['S27-Q1'],fact:'原文报道化妆品强制召回指南定稿，说明召回的双重认定条件。',meaning:'可能为北美采购商核对召回程序提供线索。',action:'建议核对产品标签与成分证据包是否满足双重认定豁免条件。'}],conclusion:'近期公开资料提供了监管变化的观察线索。'});});
 assert.equal(calls,1);assert.doesNotMatch(result.text,/豁免/);assert.match(result.text,/适用对象、限制条件/);
});

test('legal terminology guard preserves trigger wording and genuine source exemptions, but not negated exemptions',()=>{
 assert.equal(regulatoryInterpretationSupported('建议核对召回的双重触发条件。','须同时认定掺假或误标与严重健康后果才可召回。'),true);
 assert.equal(regulatoryInterpretationSupported('建议核对豁免适用范围。','Certain small businesses are exempt from facility registration requirements.'),true);
 assert.equal(regulatoryInterpretationSupported('建议核对豁免适用范围。','该类企业不得豁免设施注册。'),false);
});

test('excluding a verified but explicitly unrelated news item also excludes its source and combined conclusion', async () => {
 const relevant:SearchOriginal={id:'S1',source:{title:'化妆品新原料界定指导原则征求意见',uri:'https://example.com/beauty'},text:'中检院发布化妆品新原料界定指导原则征求意见，涉及植物提取物新原料管理。',published:['2026-10-28']};
 const unrelated:SearchOriginal={id:'S2',source:{title:'广交会陶瓷企业出口动态',uri:'https://example.org/ceramics'},text:'广交会聚焦品质家居，陶瓷企业参展并吸引境外采购商洽谈。',published:['2026-10-25']};
 const result=await composeSearchEvidenceAnswer('行业资讯：行业：美妆原料，目标市场：全球。',[relevant,unrelated],async()=>JSON.stringify({items:[
  {sourceId:'S1',quoteIds:['S1-Q1'],fact:'中检院发布化妆品新原料界定指导原则征求意见，涉及植物提取物新原料管理。',meaning:'提示原料企业可关注监管口径。',action:'建议核对原文中的适用范围。'},
  {sourceId:'S2',quoteIds:['S2-Q1'],fact:'广交会聚焦品质家居，陶瓷企业参展并吸引境外采购商洽谈。该报道属于陶瓷出口行业动向，未涉及美妆原料市场。',meaning:'提示该来源与全球美妆原料市场无直接业务关联。',action:'建议排除非相关品类展会综合报道。'}],conclusion:'化妆品原料和陶瓷出口共同反映行业趋势。',conclusionSourceIds:['S1','S2']}));
 assert.match(result.text,/化妆品新原料/);assert.doesNotMatch(result.text,/陶瓷/);assert.deepEqual(result.sources.map(source=>source.uri),['https://example.com/beauty']);
});

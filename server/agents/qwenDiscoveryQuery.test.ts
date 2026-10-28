import test from 'node:test';
import assert from 'node:assert/strict';
import { qwenDiscoveryQuery } from './qwenDiscoveryQuery.js';
test('retrieval scope retains industry market period and local languages without report writing instructions', () => {
 const result = qwenDiscoveryQuery('行业资讯：行业：美妆原料，目标市场：欧洲。查询最近30天相关变化；不限指定站点，从公开报道中整理可视化报告；区分事实、推断与建议。', 30);
 assert.match(result, /美妆原料/); assert.match(result, /Europe EU/); assert.match(result, /最近30天/);
 assert.match(result, /英语.*德语\/法语/); assert.doesNotMatch(result, /可视化报告|推断与建议/);
});
test('daily brief profile scope supplies real industry and market without generic report prompt', () => {
 const result = qwenDiscoveryQuery('今日资讯。请结合当前企业资料、主推产品、目标市场，整理今天最值得关注的资讯。每条说明来源、机会和建议动作。\n已明确的查询范围：{"industry":"美妆原料","products":"防晒剂","market":"日本","platforms":"TikTok"}。没有证据的类别留缺。', 30);
 assert.match(result, /美妆原料/); assert.match(result, /sunscreen/); assert.match(result, /Japan/); assert.match(result, /日语关键词/);
 assert.match(result, /最近30天/); assert.doesNotMatch(result, /每条说明|整理今天|建议动作/);
});
test('North American merchant profile becomes two short English topics rather than a product catalogue or B2B audience query', () => {
 const question = '今日资讯。请结合当前企业资料整理今天最值得关注的资讯。\n已明确的查询范围：'+JSON.stringify({ industry: '美妆个护与护肤品', products: '防晒剂、精华液、面霜、面膜、眼霜、洗面奶、香水、彩妆、身体乳、护发素、洗发水', market: '北美 B2B 美妆品牌主与私标采购商', platforms: '' });
 const first = qwenDiscoveryQuery(question, 30);
 const second = qwenDiscoveryQuery(question, 30, '唯一补轮：缺少监管/供应链，首轮失败域名wx.example');
 assert.match(first, /North America \(US, Canada\)/);
 assert.match(first, /1\. United States sunscreen product launch market news past 30 days/);
 assert.doesNotMatch(first, /B2B|品牌主|私标采购商|面膜|眼霜|护发素/);
 assert.match(second, /补轮改查新议题/); assert.match(second, /manufacturing capacity partnerships/); assert.match(second, /research technology regulation/);
 assert.doesNotMatch(second, /product launch market news|wx\.example/);
});
test('explicit user industry geography entity and historical window override profile defaults', () => {
 const query = qwenDiscoveryQuery('行业资讯：行业：家具，目标市场：加拿大，关注IKEA。2025年1月到3月。\n已明确的查询范围：{"industry":"美妆","products":"防晒剂","market":"美国","platforms":""}');
 assert.match(query, /地域=Canada/); assert.match(query, /Canada IKEA furniture/); assert.match(query, /2025年1月到3月/); assert.match(query, /2025-01 to 2025-03/);
 assert.doesNotMatch(query, /United States|sunscreen|cosmetics/);
});

test('noncosmetic scope cannot acquire unrelated cosmetic translations', () => {
 const query = qwenDiscoveryQuery('行业资讯：行业：家具，目标市场：法国。查询最近30天。');
 assert.match(query, /France furniture/); assert.doesNotMatch(query, /cosmétiques|cosmetics|skincare/);
});

test('structured supplement retains actual missing topics and failed or covered hosts without becoming a site allowlist', () => {
 const question='今日资讯。\n已明确的查询范围：'+JSON.stringify({industry:'美妆个护与护肤品',products:'护肤品、洗发水',market:'北美 B2B 美妆品牌主与私标采购商'});
 const instruction='这是同一次行业研究的唯一一轮补充检索。需补充的议题：监管与行业标准、供应链与生产；首轮不可读取或日期不合格的域名：baike.baidu.com、blocked.example；已成功域名：lv-1.cn。';
 const result=qwenDiscoveryQuery(question,30,instruction);
 assert.match(result,/United States skincare regulation standards past 30 days/);
 assert.match(result,/Canada haircare manufacturing supply chain partnerships past 30 days/);
 assert.match(result,/需补充的实质议题：监管与行业标准、供应链与生产/);
 assert.match(result,/未读成或日期不合格的域名：baike\.baidu\.com、blocked\.example/);
 assert.match(result,/已读来源域名：lv-1\.cn/);
 assert.match(result,/不重复已覆盖页面|回避重复失败候选/);
 assert.match(result,/正文的事实主体、实际发生地点或业务关系必须直接支持North America/);
 assert.match(result,/不是固定站点范围.*仍检索开放网络/s);
 assert.doesNotMatch(result,/site:|assigned_site_list|只允许|仅限站点|禁止媒体|禁止研究/);
 assert.equal((result.match(/^\d\. /gm)||[]).length,2);
});

test('real North America empty-first discovery no longer combines both countries and product families into each query',()=>{
 const question='今日资讯。\n已明确的查询范围：'+JSON.stringify({industry:'美妆个护与护肤品',products:'护肤品、洗发水',market:'北美 B2B 美妆品牌主与私标采购商'});
 const query=qwenDiscoveryQuery(question,30,'需补充的议题：监管与行业标准、市场与竞争动作、技术与研究、供应链与生产；');
 const lines=query.split('\n').filter(line=>/^\d\./u.test(line));
 assert.equal(lines.length,2);
 assert.match(lines[0],/United States skincare regulation standards/);
 assert.match(lines[1],/Canada haircare manufacturing supply chain partnerships/);
 assert.doesNotMatch(lines.join(' '),/US, Canada|skincare haircare|regulation standards research|market competition manufacturing/);
 assert.match(query,/Search English-language local reporting/);
 assert.doesNotMatch(query,/美妆个护与护肤品|私标采购商/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {qwenPublicNewsQueries} from './qwenPublicNewsQueries.js';
test('same-day RSS batch combines open global industry and a short target-market query instead of two narrow repairs',()=>{
 const question='今日资讯。\n已明确的查询范围：'+JSON.stringify({industry:'美妆个护与护肤品',products:'护肤品、洗发水',market:'北美 B2B 美妆品牌主与私标采购商'})+'\n今日资讯发布日期范围：2026-10-28（Asia/Shanghai当天）';
 const queries=qwenPublicNewsQueries(question,1);
 assert.equal(queries.length,2);assert.equal(queries[0],'skincare');assert.equal(queries[1],'(United States OR Canada) skincare');
 assert.doesNotMatch(queries[0],/美国|北美|Canada|United States|global|site:/iu);
 assert.doesNotMatch(queries.join(' '),/2026|Asia|Shanghai|publication date|regulation standards|manufacturing supply chain|B2B|私标采购商/u);
});
test('global wide query stays in the actual industry and target market survives outside North America',()=>{
 const queries=qwenPublicNewsQueries('今日资讯：行业：家具，目标市场：德国。最近30天。',30);
 assert.deepEqual(queries,['家具 OR furniture','Germany furniture']);
});

test('industry scene retains its previous target-market discovery scope',()=>{
 const queries=qwenPublicNewsQueries('行业资讯：行业：家具，目标市场：德国。最近30天。',30);
 assert.equal(queries.length,2);assert.match(queries[0],/^Germany furniture product launch market news/);assert.doesNotMatch(queries.join(' '),/家具 OR furniture/);
});
test('China beauty discovery uses short Chinese industry queries',()=>{
 assert.deepEqual(qwenPublicNewsQueries('行业资讯：行业：美妆，目标市场：中国。查询最近30天。',30),['中国 化妆品','中国 美妆 原料']);
});

test('global industry RSS uses a short industry query while freshness remains a separate filter',()=>{
 const queries=qwenPublicNewsQueries('行业资讯：行业：美妆原料，目标市场：全球。查询最近30天。',30);
 assert.deepEqual(queries,['cosmetic ingredients innovation','cosmetic ingredients']);
 assert.doesNotMatch(queries.join(' '),/global|past 30|site:/iu);
 const supplemented=qwenPublicNewsQueries('行业资讯：行业：美妆原料，目标市场：全球。查询最近30天。',30,'需补充的议题：监管与行业标准、技术与研究、供应链与生产。');
 assert.deepEqual(supplemented,queries);
});

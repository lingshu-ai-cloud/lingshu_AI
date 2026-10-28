import test from 'node:test';
import assert from 'node:assert/strict';
import {qwenPublicNewsQueries} from './qwenPublicNewsQueries.js';
test('same-day RSS batch combines open global industry and a short target-market query instead of two narrow repairs',()=>{
 const question='今日资讯。\n已明确的查询范围：'+JSON.stringify({industry:'美妆个护与护肤品',products:'护肤品、洗发水',market:'北美 B2B 美妆品牌主与私标采购商'})+'\n今日资讯发布日期范围：2026-10-28（Asia/Shanghai当天）';
 const queries=qwenPublicNewsQueries(question,1);
 assert.equal(queries.length,2);assert.equal(queries[0],'美妆 OR 化妆品 OR cosmetics OR skincare');assert.equal(queries[1],'(United States OR Canada) skincare');
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendSocialInsightSamples } from './socialInsightRecommendations.js';
import type { SocialInsightReport } from './socialInsightReport.js';
function report(b2b: Array<number|null>,b2c: Array<number|null>): SocialInsightReport {
 const items=[...b2b.map((views,i)=>({id:`b${i}`,category:'b2b',views})),...b2c.map((views,i)=>({id:`c${i}`,category:'b2c',views}))];
 return {keyword:'sunscreen',videos:items.map(i=>({id:i.id,title:'sunscreen',caption:'sunscreen OEM',views:i.views})),materials:{assignments:items.map(i=>({videoId:i.id,category:i.category,confidence:'high',merchantHelp:'改编采购内容',contentAngle:'拍摄测试',reason:'采购',evidenceNeeded:['核验']}))}} as unknown as SocialInsightReport;
}
test('six B2B and four B2C meet threshold, ranked within categories',()=>{const r=recommendSocialInsightSamples(report([10000,11000,12000,13000,14000,15000,16000],[10000,11000,12000,13000,14000]));assert.equal(r.length,10);assert.equal(r.filter(v=>v.material.category==='b2b').length,6);assert.equal(r.filter(v=>v.material.category==='b2c').length,4);assert.equal(r[0].video.views,16000);assert.ok(r.every(v=>!v.fillsB2bSlot));});
test('only qualifying B2C fills B2B shortage and retains category',()=>{const r=recommendSocialInsightSamples(report([null,9999,10000],[10000,11000,12000,13000,14000,15000]));assert.equal(r.length,7);assert.equal(r.filter(v=>v.material.category==='b2b').length,1);assert.equal(r.filter(v=>v.fillsB2bSlot).length,2);assert.ok(r.filter(v=>v.fillsB2bSlot).every(v=>v.material.category==='b2c'));});
test('unknown views, absent captions and unsupported suggestions cannot qualify',()=>{const data=report([20000,20000,20000,null],[]);data.videos[0].caption='';data.materials!.assignments[1].merchantHelp='内容帮助待核验';data.materials!.assignments[2].confidence='low';assert.equal(recommendSocialInsightSamples(data).length,0);});

test('synonymous OEM evidence need not repeat the keyword',()=>{const data=report([10000],[]);data.videos[0].caption='Private label SPF formulation';data.videos[0].title='Private label';assert.equal(recommendSocialInsightSamples(data).length,1);});

test('B2C does not inherit the B2B ten-thousand-view threshold',()=>{const picks=recommendSocialInsightSamples(report([9999],[9000,null]));assert.equal(picks.length,1);assert.equal(picks[0].material.category,'b2c');assert.equal(picks[0].video.views,9000);});

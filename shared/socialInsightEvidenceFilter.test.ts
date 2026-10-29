import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceSafeSocialInsightReport, filterSocialInsightEvidence } from './socialInsightEvidenceFilter.js';
import type { SocialInsightReport } from './socialInsightReport.js';
test('real receipt examples remove unverified geography and demand without losing supported advice',()=>{
 for (const value of ['全球终端市场的普遍需求','面向美国消费者','采购商备货需求稳定']) assert.equal(filterSocialInsightEvidence(value),'');
 assert.equal(filterSocialInsightEvidence('全球终端市场的普遍需求。建议拍摄配方测试过程。'),'建议拍摄配方测试过程。');
 const report={analysisMarkdown:'可参考样本。',materials:{status:'completed',assignments:[{videoId:'v',category:'b2c',confidence:'high',reason:'面向美国消费者',merchantHelp:'采购商备货需求稳定',contentAngle:'展示防晒配方测试',evidenceNeeded:['补充稳定性测试报告']}],groups:[{category:'b2b',summary:'',recommendations:[],rankedVideoIds:[]},{category:'b2c',summary:'全球终端市场的普遍需求',recommendations:['展示原料检测流程'],rankedVideoIds:['v']}]}} as unknown as SocialInsightReport;
 const safe=evidenceSafeSocialInsightReport(report);const a=safe.materials!.assignments[0];
 assert.equal(a.reason,'分类依据待核验');assert.equal(a.confidence,'low');assert.equal(a.merchantHelp,'内容帮助待核验');assert.equal(a.contentAngle,'展示防晒配方测试');assert.deepEqual(a.evidenceNeeded,['补充稳定性测试报告']);assert.equal(safe.materials!.groups[1].summary,'');assert.deepEqual(safe.materials!.groups[1].recommendations,['展示原料检测流程']);assert.equal(report.materials!.assignments[0].reason,'面向美国消费者');
});

test('small sample cannot establish demand or prove market potential',()=>{
 assert.equal(filterSocialInsightEvidence('呼吁日常使用防晒，反映终端教育需求旺盛。建议拍摄配方测试。'),'建议拍摄配方测试。');
 assert.equal(filterSocialInsightEvidence('用终端教育热度佐证品类代工市场潜力。'),'');
 assert.equal(filterSocialInsightEvidence('可以借鉴防晒教育选题展示配方研发。'),'可以借鉴防晒教育选题展示配方研发。');
 assert.equal(filterSocialInsightEvidence('B2C样本关注日常防晒习惯与无白膜肤感体验，反映消费者对轻薄质地的偏好，可作为B2B选品参考。'),'');
 assert.equal(filterSocialInsightEvidence('配文提及无白膜卖点，可作为选题参考。'),'配文提及无白膜卖点，可作为选题参考。');
});

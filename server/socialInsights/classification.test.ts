import {test} from 'node:test';
import assert from 'node:assert/strict';
import {snapshotReport} from './report.js';
import {applyClassification,classificationPrompt} from './classification.js';
import {readInsightMerchantContext} from './merchantContext.js';
import type {EnterpriseProfile} from '../routes/enterpriseProfileContracts.js';
const now=new Date('2026-10-28T10:00:00Z');
const row=(id:string,views?:number)=>({webVideoUrl:`https://www.tiktok.com/@test/video/${id}`,text:`${'公开配文 '.repeat(60)} OEM quality control`,createTimeISO:'2026-10-28T08:00:00Z',videoMeta:{duration:20},playCount:views});
const ids=['1234567890123456789','2234567890123456789','3234567890123456789'];
const assignment=(id:string)=>({videoId:id,category:'b2b',confidence:'low',reason:'配文涉及OEM',merchantHelp:'作为采购决策证据拍摄参考',contentAngle:'建议展示质控流程',evidenceNeeded:['先提供并核验当前企业真实质控文件']});
const output=()=>({analysisMarkdown:`[样本](https://www.tiktok.com/@test/video/${ids[0]})配文涉及OEM，建议补证据。`,assignments:ids.map(assignment),groups:[{category:'b2b',summary:'采购导向配文',recommendations:['先核验企业证据']},{category:'b2c',summary:'无样本',recommendations:[]}]});
test('all samples assigned exactly once, low confidence explicit, ranking uses actual views only and preserves long captions',()=>{
 const report=snapshotReport('OEM',ids.map((id,i)=>row(id,[2,9,undefined][i])),now);
 applyClassification(report,JSON.stringify(output()));assert.equal(report.materials?.assignments.length,3);
 assert.deepEqual(report.materials?.groups[0].rankedVideoIds,[ids[1],ids[0]]);
 assert.match(report.materials!.assignments[0].reason,/待核验/);
 assert.ok(report.videos[0].caption!.includes('quality control'));assert.ok(!report.videos[0].title.includes('quality control'));
 assert.match(classificationPrompt(report),/没有评论正文/);
});
test('missing or duplicated assignments reject entire classification without partially populating report',()=>{
 for(const assignments of [[assignment(ids[0])],[assignment(ids[0]),assignment(ids[0]),assignment(ids[2])]]){
  const report=snapshotReport('OEM',ids.map(id=>row(id,5)),now);
  assert.throws(()=>applyClassification(report,JSON.stringify({...output(),assignments})),/incomplete/);assert.equal(report.materials,undefined);assert.equal(report.analysisMarkdown,'');
 }
});
test('merchant context projects only authorized industry and categories; disabled/unavailable never passes private fields',async()=>{
 const profile={company:{industry:'美妆原料',name:'PRIVATE COMPANY'},products:{categories:'原料，护肤',certifications:'PRIVATE CERT'},customers:{targetProfiles:'PRIVATE CUSTOMER'},knowledge:'PRIVATE KNOWLEDGE'} as EnterpriseProfile;
 let tenant='';const reader=async(id:string)=>{tenant=id;return profile;};
 const context=await readInsightMerchantContext('tenant-a',reader);assert.equal(tenant,'tenant-a');assert.deepEqual(context,{businessModel:'b2b',industry:'美妆原料',productCategories:['原料','护肤']});assert.equal(JSON.stringify(context).includes('PRIVATE'),false);
 assert.deepEqual(await readInsightMerchantContext('a',async()=>({...profile,dataGovernance:{aiAccessEnabled:false}} as EnterpriseProfile)),{businessModel:'b2b',industry:null,productCategories:[]});
 assert.equal((await readInsightMerchantContext('a',async()=>{throw Error('unavailable');})).industry,null);
});

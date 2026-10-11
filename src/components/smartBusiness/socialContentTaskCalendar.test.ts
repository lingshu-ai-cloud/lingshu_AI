import test from 'node:test';
import assert from 'node:assert/strict';
import type {SocialContentTaskSummary} from '../../../shared/contracts/socialContentWorkflow';
import {projectSocialContentTaskCalendar} from './socialContentTaskCalendar';

const task={
  taskId:'socialtask_real',brief:{title:'GUIANFA 卸妆蜜爆款复刻',objective:'交付一条可发布视频',productRef:'GUIANFA 云朵泡沫卸妆蜜',audience:null,markets:['US'],languages:['en'],platforms:['tiktok'],formats:['video'],aspectRatio:'9:16',cadence:null,requestedOutputCount:1,dueAt:'2026-10-14T10:00:00+08:00',brandNotes:null,restrictions:[],callToAction:null},
  status:'asset_review',version:'43',packageSelection:[],readiness:{complete:true,missing:[]},runId:'run_real',sourceCount:1,knowledgeSourceCount:1,materialSourceCount:2,artifactCount:1,approvedArtifactCount:0,deliveryPackageCount:0,publicationCount:0,metricSubmissionCount:0,createdAt:'2026-10-11T08:00:00+08:00',updatedAt:'2026-10-11T09:00:00+08:00',
  directorPlan:{version:'1',status:'ready',scriptSource:'reference_analysis',baselineVersion:'1',sceneCount:37,language:'en',createdAt:'2026-10-11T08:10:00+08:00',formulaConfigured:false,qualityPassed:true,reshootSuggestionCount:0,scriptSummary:'真实英文脚本',voiceoverSummary:'口播',subtitleSummary:'字幕',shotRhythmSummary:'快切'},
} as SocialContentTaskSummary;

test('real content task is one delivery card with internal agent nodes and real navigation id',()=>{
  const cards=projectSocialContentTaskCalendar([task]);
  assert.equal(cards.length,1);
  assert.equal(cards[0]!.title,'GUIANFA 卸妆蜜爆款复刻');
  assert.equal(cards[0]!.productionTaskId,'socialtask_real');
  assert.equal(cards[0]!.date,'2026-10-14');
  assert.equal(cards[0]!.timeSemantics,'finish');
  assert.deepEqual(cards[0]!.internalNodes?.map(node=>node.agent),['business','director','content','director']);
  assert.equal(cards[0]!.internalNodes?.[1]?.output,'真实英文脚本');
});

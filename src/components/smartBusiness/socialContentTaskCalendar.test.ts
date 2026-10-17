import test from 'node:test';
import assert from 'node:assert/strict';
import type {SocialContentTaskSummary} from '../../../shared/contracts/socialContentWorkflow';
import {projectSocialContentTaskCalendar,standaloneCalendarContentTasks} from './socialContentTaskCalendar';
import {socialContentAssistantReceipt} from '../../../server/starter198/socialContentAssistantActions';

const task={
  taskId:'socialtask_real',brief:{title:'GUIANFA 卸妆蜜爆款复刻',objective:'交付一条可发布视频',productRef:'GUIANFA 云朵泡沫卸妆蜜',audience:null,markets:['US'],languages:['en'],platforms:['tiktok'],formats:['video'],aspectRatio:'9:16',cadence:null,requestedOutputCount:1,dueAt:'2026-10-14T10:00:00+08:00',brandNotes:null,restrictions:[],callToAction:null},
  status:'asset_review',version:'43',packageSelection:[],readiness:{complete:true,missing:[]},runId:'run_real',sourceCount:1,knowledgeSourceCount:1,materialSourceCount:2,artifactCount:1,approvedArtifactCount:0,deliveryPackageCount:0,publicationCount:0,metricSubmissionCount:0,createdAt:'2026-10-11T08:00:00+08:00',updatedAt:'2026-10-11T09:00:00+08:00',
  directorPlan:{version:'1',status:'ready',scriptSource:'reference_analysis',baselineVersion:'1',sceneCount:37,language:'en',createdAt:'2026-10-11T08:10:00+08:00',formulaConfigured:false,qualityPassed:true,reshootSuggestionCount:0,scriptSummary:'真实英文脚本',voiceoverSummary:'口播',subtitleSummary:'字幕',shotRhythmSummary:'快切'},
  scriptBaseline:{version:'1',source:'reference_analysis',sceneCount:37,language:'en',lockedAt:'2026-10-11T08:05:00+08:00',referenceVideoId:'trend_video_real'},
} as SocialContentTaskSummary;

test('standalone calendar scopes explicit programs and leaves package revisions to their authoritative graph',()=>{
  const item=(taskId:string,programId?:string,weeklyPlanId?:string)=>({...task,taskId,weeklyPlanId,brief:{...task.brief,programRef:programId?{type:'social_program',id:programId,version:1}:null}} as SocialContentTaskSummary);
  const items=[item('unbound'),item('independent-social-plan',undefined,'standalone-plan'),item('own','current'),item('foreign','other'),item('other-package','current','other-package'),item('old-revision','current','same-package'),item('in-selected-graph','current')];
  assert.deepEqual(standaloneCalendarContentTasks(items,{programId:'current',packageContentTaskIds:new Set(['in-selected-graph'])}).map(value=>value.taskId),['unbound','independent-social-plan','own']);
  assert.deepEqual(standaloneCalendarContentTasks(items,{packageContentTaskIds:new Set()}).map(value=>value.taskId),['unbound','independent-social-plan']);
});

test('real content task is one delivery card with internal agent nodes and real navigation id',()=>{
  const cards=projectSocialContentTaskCalendar([task]);
  assert.equal(cards.length,1);
  assert.equal(cards[0]!.title,'GUIANFA 卸妆蜜爆款复刻');
  assert.equal(cards[0]!.productionTaskId,'socialtask_real');
  assert.equal(cards[0]!.date,'2026-10-14');
  assert.equal(cards[0]!.timeSemantics,'finish');
  assert.deepEqual(cards[0]!.internalNodes?.map(node=>node.agent),['business','director','content','director']);
  assert.equal(cards[0]!.internalNodes?.[1]?.output,'真实英文脚本');
  assert.equal(cards[0]!.previewThumbnailUrl,'/api/overseas/videos/trend_video_real/thumbnail');
  assert.equal(cards[0]!.previewVideoUrl,'/api/overseas/videos/trend_video_real/media-url');
});

test('an analyzed reference without a frozen director handoff exposes the actual blocking dependency',()=>{
  const [card]=projectSocialContentTaskCalendar([{...task,status:'attention',directorPlan:undefined,artifactCount:0,approvedArtifactCount:0}]);
  const director=card!.internalNodes?.find(node=>node.executionStep==='storyboard');
  const production=card!.internalNodes?.find(node=>node.executionStep==='video_generation');
  assert.equal(director?.status,'blocked');
  assert.match(director?.reason || '',/编导交接尚未冻结/);
  assert.match(production?.reason || '',/等待编导成稿/);
});

test('paused or missing delivery records never appear as completed work',()=>{
  assert.equal(projectSocialContentTaskCalendar([{...task,status:'paused'}])[0]!.status,'blocked');
  const [missing]=projectSocialContentTaskCalendar([{...task,status:'delivered',artifactCount:0,approvedArtifactCount:0}]);
  assert.equal(missing!.status,'blocked');
  assert.match(missing!.reason!,/尚无产物记录/);
});

test('calendar uses Shanghai business time regardless of browser timezone and updates original card on revision',()=>{
  const [original]=projectSocialContentTaskCalendar([{...task,brief:{...task.brief,dueAt:'2026-10-14T23:30:00Z'}}]);
  assert.equal(original!.date,'2026-10-15');
  assert.equal(original!.time,'07:30');
  const [revised]=projectSocialContentTaskCalendar([{...task,version:'44',status:'producing',artifactCount:0}]);
  assert.equal(revised!.id,original!.id);
  assert.equal(revised!.status,'active');
  const [delivered]=projectSocialContentTaskCalendar([{...task,status:'delivered',approvedArtifactCount:1}]);
  assert.equal(delivered!.status,'completed');
  assert.match(delivered!.output,/已回收 1 项产物/);
});

test('backend execution receipt and weekly delivery card keep one identity through production and revision',()=>{
  const running={...task,status:'producing' as const,artifactCount:0,approvedArtifactCount:0};
  const receipt=socialContentAssistantReceipt(running);
  const [card]=projectSocialContentTaskCalendar([running]);
  assert.equal(receipt.started,true);
  assert.equal(receipt.weeklyTaskId,card!.id);
  assert.equal(receipt.taskId,card!.productionTaskId);
  assert.equal(card!.status,'active');
  // dueAt is the promised delivery deadline, never a fabricated execution start.
  assert.equal(card!.dueAt,running.brief.dueAt);
  assert.equal(card!.timeSemantics,'finish');
  const finished={...running,status:'delivered' as const,version:'44',artifactCount:2,approvedArtifactCount:2};
  const [delivered]=projectSocialContentTaskCalendar([finished]);
  assert.equal(delivered!.id,receipt.weeklyTaskId);
  assert.equal(delivered!.status,'completed');
  assert.match(delivered!.output,/已回收 2 项产物 · 2 项审核通过/);
  const revised={...finished,status:'producing' as const,version:'45'};
  const [revision]=projectSocialContentTaskCalendar([revised]);
  assert.equal(socialContentAssistantReceipt(revised).weeklyTaskId,receipt.weeklyTaskId);
  assert.equal(revision!.id,receipt.weeklyTaskId);
  assert.equal(revision!.status,'active');
});

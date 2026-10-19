import test from 'node:test';
import assert from 'node:assert/strict';
import type {SocialContentTaskDetail} from '../../shared/contracts/socialContentWorkflow.js';
import {weeklyProductionAdmissionMessage} from './weeklyProductionAdmissionMessage.js';

const blockedReview = {
  agentWorkflow:{executionPlanReview:{approved:false,reasonCodes:['capability_mismatch'],requiredRevision:['补齐可执行素材'],failedCriteria:['没有可执行的推荐候选'],sceneResults:[{sceneId:'scene-1',reasonCodes:['capability_mismatch'],failedCriteria:['没有可执行的推荐候选']}]}},
} as unknown as SocialContentTaskDetail;

test('weekly machine capability gap remains an executable-route blocker, not a human approval request',()=>{
 const message=weeklyProductionAdmissionMessage('social_content_execution_director_review_required',blockedReview,'fallback');
 assert.match(message,/机器执行能力不足/);
 assert.match(message,/scene-1：没有可执行的推荐候选/);
 assert.doesNotMatch(message,/人工批准|等待导演确认/);
});

test('a local-only product shot reports missing verified same-product video without treating its image as footage',()=>{
 const detail={...blockedReview,assetSupplyPlan:{shots:[{shotId:'product-2',materialRouting:{materialType:'product',policy:'local_only',localMatch:{state:'missing',sourceRefs:[],evidenceRef:null}}}]}} as unknown as SocialContentTaskDetail;
 const message=weeklyProductionAdmissionMessage('social_content_execution_director_review_required',detail,'fallback');
 assert.match(message,/产品镜头 product-2 缺少已核验的同品本地视频/);
 assert.match(message,/产品图片不能代替视频/);
});

test('rights, facts and other non-capability review failures keep their existing message',()=>{
 const detail={agentWorkflow:{executionPlanReview:{approved:false,reasonCodes:['rights_missing'],requiredRevision:['补齐授权凭据'],failedCriteria:[],sceneResults:[]}}} as unknown as SocialContentTaskDetail;
 assert.match(weeklyProductionAdmissionMessage('social_content_execution_director_review_required',detail,'fallback'),/编导执行方案尚未通过核验.*补齐授权凭据/);
});

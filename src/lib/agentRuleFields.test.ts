import assert from 'node:assert/strict';
import { agentRuleFields } from './agentRuleFields';
const fields = agentRuleFields({
  socialCadence: 'YouTube；公开行业案例；关键词：压装曲线；近 14 天；每周一 10:30；每次最多 8 条；按链接与标题去重 30 天；每周生成 3 条发布草稿；账号范围：未确认；发布前人工审批',
  followupCadence: '每周二 11:00生成分层跟进草稿；周二 16:00 前审批；客户当地工作日 10:00–17:00发送；同一客户 14 天最多 1 次',
  reviewSchedule: '周五 17:30（Asia/Shanghai（北京时间））；数据截止 周五 16:30；通知审批负责人；仅生成复盘和下周任务草稿',
});
assert.deepEqual(fields, {collectionPlatforms:'YouTube',collectionSources:'公开行业案例',collectionKeywords:'压装曲线',collectionLookback:14,collectionLimit:8,collectionTime:'每周一 10:30',publishCount:3,followupGenerateAt:'每周二 11:00',followupApproveBy:'周二 16:00 前',followupWindow:'客户当地工作日 10:00–17:00',followupFrequency:'同一客户 14 天最多 1 次',reviewTimezone:'Asia/Shanghai（北京时间）',reviewCutoff:'周五 16:30'});
assert.equal(agentRuleFields({socialCadence:'YouTube；公开内容；近 7 天；每天 09:00；每次最多 20 条；每周生成 5 条发布草稿，发布前人工审批'}).publishCount,5);
assert.equal(agentRuleFields({}).collectionLookback,7);
console.log('Agent rule form persistence regression passed');

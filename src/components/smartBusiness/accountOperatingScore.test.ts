import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccountHealthResult } from './AccountHealthPanel';
import { buildAccountOperatingScore } from './accountOperatingScore';
import type { BusinessHealthDimension } from './businessHealthModel';

const accountHealth: AccountHealthResult = {
  accountId: 'account-1', accountLabel: 'Aurelia TikTok', platform: 'tiktok',
  baselineScore: null, currentScore: 88, targetScore: 100, scoreCoverage: 4,
  dimensions: [
    { key: 'cadence', label: '更新数量与稳定频率', baselineScore: null, currentScore: 90, targetScore: 100, baselineLabel: '建立中', currentLabel: '4 条 / 3 个发布日', targetLabel: '4 条 / 4 个发布日', evidence: '更新数量和发布日分布。' },
    { key: 'performance', label: '真实视频表现与触达', baselineScore: null, currentScore: 100, targetScore: 100, baselineLabel: '建立中', currentLabel: '篇均播放 300', targetLabel: 'P75', evidence: '结果表现。' },
    { key: 'profile', label: '账号资料完整度', baselineScore: null, currentScore: 80, targetScore: 100, baselineLabel: '建立中', currentLabel: '5/6 项完整', targetLabel: '6/6 项', evidence: '账号资料与连接。' },
    { key: 'handoff', label: 'WhatsApp / Messenger 承接', baselineScore: null, currentScore: 100, targetScore: 100, baselineLabel: '建立中', currentLabel: 'WhatsApp 已连接', targetLabel: '承接渠道可用', evidence: '真实渠道连接。' },
    { key: 'inquiries', label: '询盘相关评论', baselineScore: null, currentScore: null, targetScore: null, baselineLabel: '建立中', currentLabel: '待归因', targetLabel: '待设置', evidence: '评论不等于询盘。' },
  ],
  milestones: [], systemActions: [], userActions: [],
};

const businessDimensions: BusinessHealthDimension[] = [
  { key: 'accounts', label: '账号健康度', score: 88, criteria: [], action: '', page: 'socialAccounts' },
  { key: 'inquiries', label: '询盘健康度', score: 50, action: '', page: 'conversion', criteria: [
    { label: '客户来源可追踪率', score: 50, current: '5 / 10 位客户', basis: '已归因客户 ÷ 客户总数。' },
    { label: '响应时效', score: null, current: '待接入响应耗时与 SLA', basis: '没有时效数据时不评分。' },
  ] },
  { key: 'content', label: '内容经营分', score: 85, action: '', page: 'smartAssets', criteria: [
    { label: '成片验收率', score: 80, current: '8 / 10 个项目', basis: '已验收 ÷ 已完成。' },
    { label: '平台发布成功率', score: 90, current: '9 / 10 次发布', basis: '按平台回执统计。' },
  ] },
  { key: 'advertising', label: '投流经营分', score: null, criteria: [], action: '', page: 'adsOverview' },
];

test('account operating score uses four process dimensions and excludes reach results', () => {
  const score = buildAccountOperatingScore([{
    accountId: 'account-1', accountLabel: 'Aurelia TikTok', platform: 'tiktok', weeklyCount: 4,
    connected: true, audience: '海外美妆采购商', productName: '积雪草精华', contentDirection: '产品证据', formats: ['short'], cta: 'WhatsApp 询盘',
  }], [accountHealth], businessDimensions);
  assert.deepEqual(score.dimensions.map(item => item.label), ['搭账号', '提转化', '扩流量', '接询盘']);
  assert.equal(score.totalCriteria, 12);
  assert.equal(score.evaluatedCriteria, 11, 'missing response-time evidence stays pending');
  assert.ok(score.totalScore !== null && score.totalScore > 0, 'pending evidence must not become a zero score');
  const visibleLabels = score.dimensions.flatMap(item => item.criteria.map(criterion => criterion.label)).join(' ');
  assert.doesNotMatch(visibleLabels, /播放|订单|询盘量|视频表现/);
  assert.equal(score.dimensions.find(item => item.key === 'inquiries')?.criteria.find(item => item.label === '客户消息及时回复')?.score, null);
});

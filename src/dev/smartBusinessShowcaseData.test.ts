import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import type { DigitalEmployeeOverview } from '../lib/digitalEmployees';
import {
  applySmartBusinessShowcaseData,
  isSmartBusinessOverviewPreviewEnabled,
  isSmartBusinessShowcaseEnabled,
  isSmartBusinessWeeklyPlanPreviewEnabled,
  SMART_BUSINESS_SHOWCASE_WEEKLY_TOTALS,
  smartBusinessShowcaseAds,
  smartBusinessShowcaseChannels,
  smartBusinessShowcaseNextRoundRecommendations,
  smartBusinessShowcasePerformance,
  smartBusinessShowcaseWeeklyVideos,
} from './smartBusinessShowcaseData';

function overview(): DigitalEmployeeOverview {
  return {
    config: {
      companyName: 'Aurelia 澄光美研有限公司',
      publishingTargets: [
        { platform: 'facebook', accountId: 'facebook-account', accountLabel: '本地演示企业', weeklyCount: 1 },
        { platform: 'tiktok', accountId: 'tiktok-account', accountLabel: '本地演示企业', weeklyCount: 1 },
        { platform: 'instagram', accountId: 'instagram-account', accountLabel: '本地演示企业', weeklyCount: 0 },
        { platform: 'youtube', accountId: 'youtube-account', accountLabel: '本地演示企业', weeklyCount: 0 },
      ],
    },
    goal: { startsAt: '2026-10-13', endsAt: '2026-10-19', videoPlans: [] },
    plan: null,
    agents: [],
    businessSnapshot: null,
    contentQueue: { generatedAt: '', sourceStatus: 'available', sourceNote: '', items: [] },
  } as unknown as DigitalEmployeeOverview;
}

test('showcase data is fail-closed away from local preview and can be explicitly disabled', () => {
  assert.equal(isSmartBusinessShowcaseEnabled({ dev: false, hostname: 'app.example.com' }), false);
  assert.equal(isSmartBusinessShowcaseEnabled({ dev: false, hostname: '127.0.0.1' }), false);
  assert.equal(isSmartBusinessShowcaseEnabled({ dev: true, hostname: 'localhost' }), false);
  assert.equal(isSmartBusinessShowcaseEnabled({ dev: true, hostname: 'localhost', setting: '1' }), true);
  assert.equal(isSmartBusinessShowcaseEnabled({ dev: true, hostname: 'localhost', setting: 'off' }), false);
});

test('local weekly command center uses the requested showcase counts', () => {
  assert.deepEqual(SMART_BUSINESS_SHOWCASE_WEEKLY_TOTALS, {
    plannedVideoCount: 32,
    waitingReviewCount: 3,
    durationSeconds: 1_080,
    budgetMinCny: 300,
    budgetMaxCny: 360,
    budgetMidCny: 320,
  });
  const videos = smartBusinessShowcaseWeeklyVideos(overview(), true)!;
  assert.equal(videos.length, SMART_BUSINESS_SHOWCASE_WEEKLY_TOTALS.plannedVideoCount);
  assert.equal(new Set(videos.map(item => item.id)).size, 32);
  assert.equal(videos.filter(item => item.status === 'waiting_review').length, SMART_BUSINESS_SHOWCASE_WEEKLY_TOTALS.waitingReviewCount);
  assert.equal(videos.every(item => item.thumbnailUrl.startsWith('/demo/') && existsSync(new URL(`../../public${item.thumbnailUrl}`, import.meta.url))), true);
  assert.equal(videos.reduce((sum, item) => sum + item.duration, 0), 1_080);
  assert.equal(videos.reduce((sum, item) => sum + item.estimatedCostCny, 0), 320);
  assert.equal(videos.reduce((sum, item) => sum + item.budgetMinCny, 0), 300);
  assert.equal(videos.reduce((sum, item) => sum + item.budgetMaxCny, 0), 360);
});

test('weekly plan preview is scoped to the requested local project', () => {
  const search = '?page=digitalEmployees&project=studio_projects_9d8c21b5f0cc4149aeab596574b6e61c';
  assert.equal(isSmartBusinessWeeklyPlanPreviewEnabled({ hostname: '127.0.0.1', search }), true);
  assert.equal(isSmartBusinessWeeklyPlanPreviewEnabled({ hostname: 'app.example.com', search }), false);
  assert.equal(isSmartBusinessWeeklyPlanPreviewEnabled({ hostname: '127.0.0.1', search: '?page=digitalEmployees&project=another' }), false);
});

test('business overview preview is local-only and does not depend on a project query', () => {
  assert.equal(isSmartBusinessOverviewPreviewEnabled({ hostname: '127.0.0.1', search: '?page=digitalEmployees' }), true);
  assert.equal(isSmartBusinessOverviewPreviewEnabled({ hostname: 'localhost', search: '?page=digitalEmployees&project=another' }), true);
  assert.equal(isSmartBusinessOverviewPreviewEnabled({ hostname: 'app.example.com', search: '?page=digitalEmployees' }), false);
  assert.equal(isSmartBusinessOverviewPreviewEnabled({ hostname: '127.0.0.1', search: '?page=smartAssets' }), false);
});

test('weekly plan preview fills all next-round recommendation sections', () => {
  const recommendations = smartBusinessShowcaseNextRoundRecommendations(overview(), true)!;
  assert.equal(recommendations.contentInheritance.status, 'ready');
  assert.equal(recommendations.contentInheritance.framework.length, 4);
  assert.equal(recommendations.tagAdaptation.status, 'changed');
  assert.equal(recommendations.tagAdaptation.newTags.length, 2);
  assert.equal(recommendations.industryTrends.status, 'available');
  assert.equal(recommendations.industryTrends.signals.length, 3);
  assert.doesNotMatch(JSON.stringify(recommendations), /模拟数据|mock data/i);
});

test('one local dataset fills every Smart Business domain with aligned account identities', () => {
  const transformed = applySmartBusinessShowcaseData(overview(), true);
  const snapshot = transformed.businessSnapshot!;
  assert.equal(snapshot.dataGaps.length, 0);
  assert.equal(snapshot.readiness.every(item => item.status === 'ready'), true);
  assert.equal(snapshot.social.views.value, 215_800);
  assert.equal(snapshot.social.dailyTrend.reduce((sum, item) => sum + (item.interactions || 0), 0), 18_746);
  assert.equal(snapshot.customer.total.value, 148);
  assert.equal(snapshot.content.publishedPosts.value, 6);
  assert.equal(snapshot.ads?.performance?.conversions.value, 38);
  assert.equal(transformed.review?.status, 'generated');
  assert.equal(transformed.review?.summary.nextRoundRecommendations?.contentInheritance.status, 'ready');
  assert.equal(transformed.config?.publishingTargets[0].accountLabel, 'Aurelia 澄光美研有限公司 · Facebook');

  const performance = smartBusinessShowcasePerformance(transformed, true)!;
  assert.equal(performance.accounts.length, 4);
  assert.equal(performance.unavailable.length, 0);
  assert.equal(performance.contents.every(item => item.thumbnailUrl?.startsWith('/demo/')), true);
  assert.equal(performance.contents.every(item => item.platformUrl?.startsWith('http://127.0.0.1:5177/demo/')), true);
  assert.equal(performance.contents.every(item => existsSync(new URL(`../../public${item.thumbnailUrl}`, import.meta.url))), true);
  assert.equal(performance.contents.filter(item => item.publishedAt.slice(0, 10) >= '2026-10-13').reduce((sum, item) => sum + (item.metrics.views || 0), 0), 215_800);

  const trends = transformed.industryTrends!;
  assert.equal(trends.status, 'available');
  assert.equal(trends.signals.length, 3);
  assert.equal(trends.signals.every(item => item.thumbnailUrl?.startsWith('/demo/')), true);
  assert.equal(trends.signals.every(item => existsSync(new URL(`../../public${item.thumbnailUrl}`, import.meta.url))), true);
  assert.equal(trends.signals.every(item => item.sourceUrl.startsWith('http://127.0.0.1:5177/demo/')), true);

  const channels = smartBusinessShowcaseChannels(transformed, true)!;
  assert.equal(channels.whatsappConnected, true);
  assert.equal(channels.messengerPages[0].id, 'facebook-account');

  const ads = smartBusinessShowcaseAds('2026-10-13', '2026-10-19', true)!;
  assert.equal(ads.tasks.length, 2);
  assert.equal(ads.entries.reduce((sum, item) => sum + (item.report?.spend || 0), 0), 1_680);
  assert.equal(ads.entries.flatMap(item => item.report?.daily || []).reduce((sum, item) => sum + (item.impressions || 0), 0), 284_000);
  assert.equal(ads.entries.flatMap(item => item.report?.daily || []).reduce((sum, item) => sum + (item.clicks || 0), 0), 6_840);
  assert.doesNotMatch(JSON.stringify({ snapshot, performance, ads }), /模拟数据|mock data/i);
});

test('non-overview responses are not altered', () => {
  const response = { items: [{ id: 'one' }] };
  assert.equal(applySmartBusinessShowcaseData(response, true), response);
});

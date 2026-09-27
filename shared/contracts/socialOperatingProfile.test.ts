import assert from 'node:assert/strict';
import {
  SOCIAL_AGENT_BOUNDARIES,
  SOCIAL_OPERATING_PROFILES,
  connectedAccountIssues,
  platformExecutionConstraints,
  SOCIAL_DISCOVERY_BASELINE,
  socialDiscoveryMixIssues,
  socialOperatingProfileIssues,
} from './socialOperatingProfile.js';

for (const profile of Object.values(SOCIAL_OPERATING_PROFILES)) {
  assert.deepEqual(socialOperatingProfileIssues(profile), [], `${profile.id} counts must be conserved`);
}
assert.deepEqual(SOCIAL_OPERATING_PROFILES.starter_four_platform.weeklyTargets, {
  baseVideoOriginals: 5,
  baseNonVideoOriginals: 1,
  adaptationVersions: 14,
  publicationTasks: 20,
});
assert.equal(SOCIAL_OPERATING_PROFILES.dual_account_growth.accounts.filter(row => row.platform === 'tiktok').length, 2);
assert.equal(SOCIAL_OPERATING_PROFILES.dual_account_growth.accounts.filter(row => row.platform === 'facebook').length, 2);
assert.ok(connectedAccountIssues('starter_four_platform', [
  { platform: 'tiktok', accountId: 'tk' },
  { platform: 'facebook', accountId: 'fb' },
  { platform: 'instagram', accountId: 'ig' },
  { platform: 'youtube', accountId: 'yt' },
]).length === 0);
assert.ok(connectedAccountIssues('dual_account_growth', [
  { platform: 'tiktok', accountId: 'tk' },
  { platform: 'facebook', accountId: 'fb' },
  { platform: 'instagram', accountId: 'ig' },
  { platform: 'youtube', accountId: 'yt' },
]).some(issue => issue.includes('tiktok')));
assert.ok(platformExecutionConstraints('youtube').some(rule => rule.includes('频道个人资料入口')));
assert.ok(SOCIAL_AGENT_BOUNDARIES.business.mustNot.some(rule => rule.includes('镜头参考')));
assert.ok(SOCIAL_AGENT_BOUNDARIES.director.mustNot.some(rule => rule.includes('账号数量')));
assert.deepEqual(socialDiscoveryMixIssues(SOCIAL_DISCOVERY_BASELINE), []);

console.log('Social operating profiles, platform rules and Agent boundaries passed');

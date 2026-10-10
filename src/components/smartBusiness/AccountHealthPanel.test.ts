import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import type { ConnectedSocialPerformance } from '../../lib/socialPerformance';
import { scoreAccountHealth, type AccountHealthAccount } from './AccountHealthPanel';

const account: AccountHealthAccount = {
  accountId: 'account-1', accountLabel: 'Aurelia TikTok', platform: 'tiktok', weeklyCount: 2, connected: true,
  audience: '海外美妆品牌采购商', productName: '积雪草精华', contentDirection: '工厂实力与产品证据', formats: ['short'], cta: 'WhatsApp 询盘',
};

function performance(): ConnectedSocialPerformance {
  const content = (id: string, publishedAt: string, views: number) => ({
    id, accountId: account.accountId, accountTitle: account.accountLabel, platform: account.platform, title: id, publishedAt, thumbnailUrl: '', platformUrl: '',
    metrics: { views, likes: 1, comments: 1, shares: 0 },
  });
  return {
    accounts: [{ id: account.accountId, platform: account.platform, title: account.accountLabel, handle: '@aurelia', followerCount: 10, videoCount: 4, viewCount: 1100, lastSyncAt: '2026-10-11T12:00:00.000Z' }],
    contents: [
      content('prior-1', '2026-09-29T10:00:00.000Z', 100), content('prior-2', '2026-10-01T10:00:00.000Z', 200),
      content('current-1', '2026-10-06T10:00:00.000Z', 300), content('current-2', '2026-10-09T10:00:00.000Z', 500),
    ],
    unavailable: [], loadedAt: '2026-10-11T12:00:00.000Z',
  };
}

test('scores only measurable dimensions and derives performance target from the account own P75', () => {
  const result = scoreAccountHealth(account, {
    startsAt: '2026-10-05', endsAt: '2026-10-11', performance: performance(), channelsLoaded: true, whatsappConnected: true, messengerPages: [], inquiryEvidence: [],
  });
  assert.equal(result.currentScore, 100);
  assert.equal(result.baselineScore, null, 'a previous cycle must not be mislabeled as a pre-Lingshu baseline');
  assert.equal(result.targetScore, 100);
  assert.equal(result.scoreCoverage, 4);
  const performanceDimension = result.dimensions.find(item => item.key === 'performance')!;
  assert.equal(performanceDimension.targetLabel, '账号自身真实内容 P75：300');
  assert.match(performanceDimension.baselineLabel, /当前暂无使用前快照；首次启用后自动建立基线。上一周期篇均 150/);
  assert.equal(result.dimensions.find(item => item.key === 'inquiries')?.currentScore, null, 'comments must not be scored as attributed inquiries');
});

test('missing evidence is excluded instead of becoming a fabricated zero', () => {
  const result = scoreAccountHealth({ ...account, connected: false, audience: '待补充目标受众', productName: '待选择主推产品', formats: [], cta: '待配置 CTA' }, {
    startsAt: '2026-10-05', endsAt: '2026-10-11', performance: null, channelsLoaded: false, whatsappConnected: false, messengerPages: [], inquiryEvidence: [],
  });
  assert.equal(result.baselineScore, null);
  assert.equal(result.scoreCoverage, 1);
  assert.equal(result.currentScore, 17, 'only the one real profile field is scored');
  assert.match(result.dimensions.find(item => item.key === 'cadence')!.currentLabel, /待同步/);
  assert.ok(result.userActions.some(item => item.includes('询盘归因')));
});

test('Facebook handoff requires both WhatsApp and a matching Messenger subscription', () => {
  const facebook = { ...account, platform: 'facebook' as const };
  const result = scoreAccountHealth(facebook, {
    startsAt: '2026-10-05', endsAt: '2026-10-11', performance: null, channelsLoaded: true, whatsappConnected: true,
    messengerPages: [{ id: facebook.accountId, status: 'connected', messengerSubscribed: false }], inquiryEvidence: [],
  });
  assert.equal(result.dimensions.find(item => item.key === 'handoff')?.currentScore, 50);
  assert.ok(result.userActions.some(item => item.includes('Messenger')));
});

test('work schedule is top of HomeView while MatrixView starts with account health', () => {
  const source = fs.readFileSync('src/components/SmartBusinessDashboard.tsx', 'utf8');
  const healthSource = fs.readFileSync('src/components/smartBusiness/AccountHealthPanel.tsx', 'utf8');
  const home = source.slice(source.indexOf('function HomeView'), source.indexOf('const matrixRoleLabel'));
  const matrix = source.slice(source.indexOf('function MatrixView'), source.indexOf('function openTaskPreviewPage'));
  assert.ok(home.indexOf('<MatrixWorkSchedule') > 0);
  assert.ok(home.indexOf('<MatrixWorkSchedule') < home.indexOf('<div className="grid divide-y'), 'schedule must precede overview metric strip');
  assert.match(matrix, /<AccountHealthPanel/);
  assert.doesNotMatch(matrix, /<MatrixWorkSchedule/);
  assert.doesNotMatch(matrix, /title="账号表现趋势"/);
  assert.match(healthSource, /图中只显示可核验值。当前暂无使用前快照时不补假低分/);
  assert.match(healthSource, /border-border bg-accent-glow/);
  assert.match(healthSource, /border-border bg-surface-2/);
  assert.doesNotMatch(healthSource, /(?:blue|amber|violet)-(?:50|100|200|600|700|800)/);
});

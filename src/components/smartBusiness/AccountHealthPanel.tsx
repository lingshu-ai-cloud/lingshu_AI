import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Table, Tag, type TableColumnsType } from 'antd';
import { RefreshCcw } from 'lucide-react';
import type { PublishingPlatform } from '../../lib/digitalEmployees';
import { loadConnectedSocialPerformance, type ConnectedSocialPerformance, type ConnectedSocialPerformanceContent } from '../../lib/socialPerformance';
import { SocialPlatformIcon } from '../SocialPlatformIcon';
import LsDataChart from '../ui/LsDataChart';

export type AccountHealthAccount = {
  accountId: string;
  accountLabel: string;
  platform: PublishingPlatform;
  weeklyCount: number;
  connected?: boolean;
  audience: string;
  productName: string;
  contentDirection: string;
  formats?: string[];
  cta: string;
};

export type AccountHealthMessengerPage = {
  id: string;
  providerAccountId?: string;
  title?: string;
  status?: string;
  messengerSubscribed?: boolean;
};

export type AccountInquiryEvidence = {
  accountId: string;
  comments: number;
  inquiries: number;
  qualifiedInquiries: number;
};

export type AccountHealthDimension = {
  key: 'cadence' | 'performance' | 'profile' | 'handoff' | 'inquiries';
  label: string;
  baselineScore: number | null;
  currentScore: number | null;
  targetScore: number | null;
  baselineLabel: string;
  currentLabel: string;
  targetLabel: string;
  evidence: string;
};

export type AccountHealthResult = {
  accountId: string;
  accountLabel: string;
  platform: PublishingPlatform;
  dimensions: AccountHealthDimension[];
  baselineScore: number | null;
  currentScore: number | null;
  targetScore: number | null;
  scoreCoverage: number;
  systemActions: string[];
  userActions: string[];
};

type AccountHealthSources = {
  startsAt: string;
  endsAt: string;
  performance: ConnectedSocialPerformance | null;
  channelsLoaded: boolean;
  whatsappConnected: boolean;
  messengerPages: AccountHealthMessengerPage[];
  inquiryEvidence: AccountInquiryEvidence[];
};

const platformLabels: Record<PublishingPlatform, string> = {
  youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook',
};

function dayTimestamp(value: string, end = false): number | null {
  if (!value) return null;
  const parsed = Date.parse(`${value.slice(0, 10)}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function contentTimestamp(item: ConnectedSocialPerformanceContent): number | null {
  const parsed = Date.parse(item.publishedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function percentile75(values: number[]): number | null {
  if (values.length < 2) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.75) - 1] ?? null;
}

function normalizedScore(value: number, target: number): number | null {
  return target > 0 ? Math.max(0, Math.min(100, Math.round(value / target * 100))) : null;
}

function roundedAverage(values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value !== null);
  return available.length ? Math.round(available.reduce((sum, value) => sum + value, 0) / available.length) : null;
}

function countPublishDays(items: ConnectedSocialPerformanceContent[]): number {
  return new Set(items.map(item => item.publishedAt.slice(0, 10)).filter(Boolean)).size;
}

function meaningful(value: string): boolean {
  const text = value.trim();
  return Boolean(text && !/^(待|未|暂无)/.test(text));
}

function numberLabel(value: number | null, suffix = ''): string {
  return value === null ? '待补充' : `${Math.round(value).toLocaleString('zh-CN')}${suffix}`;
}

export function scoreAccountHealth(account: AccountHealthAccount, sources: AccountHealthSources): AccountHealthResult {
  const start = dayTimestamp(sources.startsAt);
  const end = dayTimestamp(sources.endsAt, true);
  const cycleDays = start !== null && end !== null && end >= start ? Math.max(1, Math.round((end - start + 1) / 86_400_000)) : 7;
  const previousStart = start === null ? null : start - cycleDays * 86_400_000;
  const previousEnd = start === null ? null : start - 1;
  const performanceAccount = sources.performance?.accounts.find(item => item.id === account.accountId)
    ?? sources.performance?.accounts.find(item => item.platform === account.platform && item.title === account.accountLabel);
  const unavailable = sources.performance?.unavailable.some(item => item.accountId === account.accountId || !item.accountId && item.platform === account.platform) ?? false;
  const performanceAvailable = Boolean(sources.performance && performanceAccount && !unavailable);
  const accountContents = performanceAvailable ? sources.performance!.contents.filter(item => item.accountId === performanceAccount!.id) : [];
  const currentContents = start === null || end === null ? [] : accountContents.filter(item => {
    const time = contentTimestamp(item); return time !== null && time >= start && time <= end;
  });
  const previousContents = previousStart === null || previousEnd === null ? [] : accountContents.filter(item => {
    const time = contentTimestamp(item); return time !== null && time >= previousStart && time <= previousEnd;
  });

  const targetCount = Math.max(0, Math.round(account.weeklyCount));
  const targetDays = Math.min(cycleDays, targetCount);
  const currentCount = performanceAvailable ? currentContents.length : null;
  const currentDays = performanceAvailable ? countPublishDays(currentContents) : null;
  const cadenceScore = currentCount === null || currentDays === null || targetCount <= 0
    ? null
    : Math.round(Math.min(1, currentCount / targetCount) * 70 + Math.min(1, currentDays / Math.max(1, targetDays)) * 30);
  const hasPreviousCadence = previousContents.length > 0;

  const allViews = accountContents.map(item => item.metrics.views).filter((value): value is number => value !== null);
  const currentViews = currentContents.map(item => item.metrics.views).filter((value): value is number => value !== null);
  const previousViews = previousContents.map(item => item.metrics.views).filter((value): value is number => value !== null);
  const currentAverageViews = average(currentViews);
  const baselineAverageViews = average(previousViews);
  const performanceTarget = percentile75(allViews);
  const performanceScore = currentAverageViews === null || performanceTarget === null ? null : normalizedScore(currentAverageViews, performanceTarget);

  const profileChecks = [
    account.connected === true,
    meaningful(account.audience),
    meaningful(account.productName),
    meaningful(account.contentDirection),
    Boolean(account.formats?.length),
    meaningful(account.cta),
  ];
  const profileComplete = profileChecks.filter(Boolean).length;
  const profileScore = Math.round(profileComplete / profileChecks.length * 100);

  const messengerApplicable = account.platform === 'facebook';
  const messengerConnected = messengerApplicable && sources.messengerPages.some(page => page.status === 'connected' && page.messengerSubscribed
    && (page.id === account.accountId || page.providerAccountId === account.accountId || page.title === account.accountLabel));
  const handoffTotal = messengerApplicable ? 2 : 1;
  const handoffComplete = (sources.whatsappConnected ? 1 : 0) + (messengerApplicable && messengerConnected ? 1 : 0);
  const handoffScore = sources.channelsLoaded ? Math.round(handoffComplete / handoffTotal * 100) : null;

  const inquiryRows = sources.inquiryEvidence.filter(item => item.accountId === account.accountId);
  const attributedInquiries = inquiryRows.length ? inquiryRows.reduce((sum, item) => sum + item.inquiries, 0) : null;
  const attributedComments = inquiryRows.length ? inquiryRows.reduce((sum, item) => sum + item.comments, 0) : null;
  const platformComments = currentContents.map(item => item.metrics.comments).filter((value): value is number => value !== null);
  const commentCount = attributedComments ?? (platformComments.length ? platformComments.reduce((sum, value) => sum + value, 0) : null);

  const dimensions: AccountHealthDimension[] = [
    {
      key: 'cadence', label: '更新数量与稳定频率', baselineScore: null, currentScore: cadenceScore, targetScore: targetCount > 0 ? 100 : null,
      baselineLabel: hasPreviousCadence ? `当前暂无使用前快照；首次启用后自动建立基线。上一周期参考 ${previousContents.length} 条 / ${countPublishDays(previousContents)} 个发布日` : '当前暂无使用前快照；首次启用后自动建立基线',
      currentLabel: currentCount === null ? '账号发布数据待同步' : `${currentCount} 条 / ${currentDays} 个发布日`,
      targetLabel: targetCount > 0 ? `${targetCount} 条 / ${targetDays} 个发布日` : '周更目标待设置',
      evidence: '更新量占 70%，分布到不同发布日占 30%；均以当前周更目标为上限。',
    },
    {
      key: 'performance', label: '真实视频表现与触达', baselineScore: null, currentScore: performanceScore, targetScore: performanceTarget === null ? null : 100,
      baselineLabel: baselineAverageViews === null ? '当前暂无使用前快照；首次启用后自动建立基线' : `当前暂无使用前快照；首次启用后自动建立基线。上一周期篇均 ${numberLabel(baselineAverageViews)}`,
      currentLabel: currentAverageViews === null ? '本周期播放样本待补充' : `篇均播放 ${numberLabel(currentAverageViews)} · 总播放 ${numberLabel(currentViews.reduce((sum, value) => sum + value, 0))}`,
      targetLabel: performanceTarget === null ? '至少 2 条真实样本后生成' : `账号自身真实内容 P75：${numberLabel(performanceTarget)}`,
      evidence: '目标取该账号已同步真实内容的播放量 P75，不使用行业假设或固定增幅。',
    },
    {
      key: 'profile', label: '账号资料完整度', baselineScore: null, currentScore: profileScore, targetScore: 100,
      baselineLabel: '当前暂无使用前配置快照；首次启用后自动建立基线', currentLabel: `${profileComplete}/${profileChecks.length} 项已完整`, targetLabel: `${profileChecks.length}/${profileChecks.length} 项`,
      evidence: '核对账号连接、目标受众、主推产品、内容方向、内容栏目和 CTA。',
    },
    {
      key: 'handoff', label: 'WhatsApp / Messenger 承接', baselineScore: null, currentScore: handoffScore, targetScore: sources.channelsLoaded ? 100 : null,
      baselineLabel: '当前暂无使用前连接快照；首次启用后自动建立基线',
      currentLabel: !sources.channelsLoaded ? '连接状态读取中' : messengerApplicable ? `WhatsApp ${sources.whatsappConnected ? '已连接' : '未连接'} · Messenger ${messengerConnected ? '已连接' : '未连接'}` : `WhatsApp ${sources.whatsappConnected ? '已连接' : '未连接'} · Messenger 不适用`,
      targetLabel: sources.channelsLoaded ? messengerApplicable ? '两种承接渠道均可用' : 'WhatsApp 可用' : '待读取后确定',
      evidence: 'Messenger 只计入 Facebook；其他平台不因不适用而扣分。',
    },
    {
      key: 'inquiries', label: '询盘相关评论', baselineScore: null, currentScore: null, targetScore: null,
      baselineLabel: '当前暂无账号级历史归因快照；首次启用后自动建立基线',
      currentLabel: attributedInquiries === null ? `${commentCount === null ? '评论待同步' : `${commentCount} 条评论`} · 询盘归因待补充` : `${attributedInquiries} 条归因询盘 · ${commentCount ?? 0} 条相关评论`,
      targetLabel: '账号级询盘目标待设置',
      evidence: '评论数不等于询盘；只有业务回执明确绑定账号时才展示归因询盘。',
    },
  ];

  const currentScore = roundedAverage(dimensions.map(item => item.currentScore));
  const baselineScore = roundedAverage(dimensions.map(item => item.baselineScore));
  const targetScore = roundedAverage(dimensions.map(item => item.targetScore));
  const scoreCoverage = dimensions.filter(item => item.currentScore !== null).length;
  const systemActions = [
    cadenceScore !== null && cadenceScore < 100 ? '按周更目标优先补齐后续内容排期，并识别连续空档。' : '',
    performanceTarget === null ? '继续同步真实内容表现；样本达到 2 条后自动生成账号内 P75 目标。' : '将账号自身 P75 内容作为下轮复用与对照依据。',
    '持续同步评论与账号表现，并把已归因询盘写回经营复盘。',
  ].filter(Boolean);
  const missingProfile = ['账号连接', '目标受众', '主推产品', '内容方向', '内容栏目', 'CTA'].filter((_, index) => !profileChecks[index]);
  const userActions = [
    missingProfile.length ? `补齐账号资料：${missingProfile.join('、')}。` : '',
    sources.channelsLoaded && !sources.whatsappConnected ? '连接 WhatsApp 承接询盘。' : '',
    sources.channelsLoaded && messengerApplicable && !messengerConnected ? '完成 Facebook Messenger 订阅。' : '',
    attributedInquiries === null ? '在会话或 CRM 中保留账号来源，补齐询盘归因。' : '',
  ].filter(Boolean);
  return { accountId: account.accountId, accountLabel: account.accountLabel, platform: account.platform, dimensions, baselineScore, currentScore, targetScore, scoreCoverage, systemActions, userActions };
}

function scoreLabel(value: number | null): string {
  return value === null ? '待补充' : `${value} 分`;
}

function scoreStatus(row: AccountHealthResult): { label: string; color?: string } {
  if (row.currentScore === null) return { label: '待补数据' };
  if (row.currentScore >= 80) return { label: '基础稳健', color: 'success' };
  if (row.currentScore >= 60) return { label: '持续建设', color: 'processing' };
  return { label: '优先补齐', color: 'warning' };
}

export default function AccountHealthPanel({ accounts, startsAt, endsAt, channelsLoaded, whatsappConnected, messengerPages, inquiryEvidence }: { accounts: AccountHealthAccount[]; startsAt: string; endsAt: string; channelsLoaded: boolean; whatsappConnected: boolean; messengerPages: AccountHealthMessengerPage[]; inquiryEvidence: AccountInquiryEvidence[] }) {
  const [performance, setPerformance] = useState<ConnectedSocialPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = async () => {
    setLoading(true); setError('');
    try { setPerformance(await loadConnectedSocialPerformance()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '账号表现读取失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const rows = useMemo(() => accounts.map(account => scoreAccountHealth(account, { startsAt, endsAt, performance, channelsLoaded, whatsappConnected, messengerPages, inquiryEvidence })), [accounts, channelsLoaded, endsAt, inquiryEvidence, messengerPages, performance, startsAt, whatsappConnected]);
  const columns: TableColumnsType<AccountHealthResult> = [
    { title: '账号', key: 'account', width: 240, render: (_, row) => <div className="flex items-center gap-2"><SocialPlatformIcon platform={row.platform} size={18}/><div><strong className="block text-sm text-text-primary">{row.accountLabel}</strong><span className="text-xs text-text-muted">{platformLabels[row.platform]}</span></div></div> },
    { title: '当前健康度', key: 'score', width: 150, render: (_, row) => { const status = scoreStatus(row); return <div><div className="flex items-center gap-2"><strong className="text-lg text-text-primary">{scoreLabel(row.currentScore)}</strong><Tag color={status.color}>{status.label}</Tag></div><span className="text-xs text-text-muted">评分覆盖 {row.scoreCoverage}/{row.dimensions.length} 个维度</span></div>; } },
    { title: '使用灵枢前基线 → 当前 → 可提升目标', key: 'journey', render: (_, row) => <div className="flex min-w-[360px] items-center gap-2 text-xs"><span className="min-w-20 text-text-muted">{row.baselineScore === null ? '当前暂无快照' : scoreLabel(row.baselineScore)}</span><span aria-hidden="true" className="text-text-muted">→</span><strong className="min-w-20 text-text-primary">{scoreLabel(row.currentScore)}</strong><span aria-hidden="true" className="text-text-muted">→</span><span className="min-w-20 font-medium text-accent">{scoreLabel(row.targetScore)}</span>{row.baselineScore !== null && row.currentScore !== null && row.currentScore >= row.baselineScore && <Tag color="success">已提升 {row.currentScore - row.baselineScore} 分</Tag>}</div> },
    { title: '优先建议', key: 'action', width: 280, render: (_, row) => <div className="space-y-1 text-xs leading-5"><p className="text-text-secondary"><span className="font-medium text-text-primary">系统：</span>{row.systemActions[0] || '保持现有自动优化节奏。'}</p><p className="text-text-secondary"><span className="font-medium text-text-primary">你：</span>{row.userActions[0] || '当前无需额外补充。'}</p></div> },
  ];
  return <section className="overflow-hidden rounded-lg border border-border bg-white" aria-labelledby="account-health-title">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
      <div><h2 id="account-health-title" className="text-lg font-semibold text-text-primary">账号经营健康度</h2><p className="mt-1 text-xs text-text-secondary">只对有真实口径的维度等权评分；缺失数据标记待补充，不按 0 分处理。</p></div>
      <Button icon={<RefreshCcw size={15}/>} loading={loading} onClick={() => void refresh()}>同步账号表现</Button>
    </header>
    {error && <div className="px-5 pt-5"><Alert type="warning" showIcon title={error}/></div>}
    <div className="border-b border-border p-5"><LsDataChart title="账号健康度提升空间" description="单位：分；图中只显示可核验值。当前暂无使用前快照时不补假低分，首次启用后自动建立基线；上一周期数据只作参考。表现目标取账号自身真实内容 P75，其余目标来自已配置的周更、资料和承接要求。" kind="bar" horizontal percent labels={rows.map(row => row.accountLabel)} series={[{ label: '使用灵枢前基线', values: rows.map(row => row.baselineScore) }, { label: '当前', values: rows.map(row => row.currentScore) }, { label: '可提升目标', values: rows.map(row => row.targetScore) }]} loading={loading && !performance} height={Math.max(240, rows.length * 58)}/></div>
    <Table<AccountHealthResult> rowKey="accountId" columns={columns} dataSource={rows} pagination={false} scroll={{ x: 1160 }} expandable={{ expandedRowRender: row => <div className="space-y-4 px-2 py-1">
      <Table<AccountHealthDimension> rowKey="key" size="small" pagination={false} dataSource={row.dimensions} scroll={{ x: 820 }} columns={[
        { title: '评分维度', dataIndex: 'label', width: 170 },
        { title: '使用灵枢前基线', dataIndex: 'baselineLabel', width: 180 },
        { title: '当前', dataIndex: 'currentLabel', width: 220 },
        { title: '可提升目标', dataIndex: 'targetLabel', width: 200 },
        { title: '口径', dataIndex: 'evidence', width: 300 },
      ]}/>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-md border border-border bg-accent-glow p-4"><h3 className="text-sm font-semibold text-accent">系统可自动改进</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-text-secondary">{row.systemActions.map(item => <li key={item}>{item}</li>)}</ul></section>
        <section className="rounded-md border border-border bg-surface-2 p-4"><h3 className="text-sm font-semibold text-text-primary">需要你完成</h3>{row.userActions.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-text-secondary">{row.userActions.map(item => <li key={item}>{item}</li>)}</ul> : <p className="mt-2 text-xs leading-5 text-text-secondary">当前无需额外补充，请保持账号授权和承接渠道有效。</p>}</section>
      </div>
    </div> }}/>
  </section>;
}

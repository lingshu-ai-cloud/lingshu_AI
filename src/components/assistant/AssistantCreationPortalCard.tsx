import { lazy, Suspense, useRef } from 'react';
import { App as AntApp } from 'antd';
import { ArrowRight, CalendarDays, Clapperboard, Images } from 'lucide-react';
import { assistantCreationPortalSchema, type AssistantCreationPortal } from '../../../shared/contracts/assistantCreationPortal';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import AssistantImageReplicationScene from './AssistantImageReplicationScene';
import type { SocialContentCreateRequest } from '../socialContent/SocialContentWorkspace';
import { assistantTaskPortalSchema, type AssistantTaskPortal } from '../../../shared/contracts/assistantTaskPortal';
import { assistantSourcePortalSchema, type AssistantSourcePortal } from '../../../shared/contracts/assistantSourcePortal';
import AssistantProductionPortal, { productionPortalNavigation } from './AssistantProductionPortal';
import AssistantReplicationScene from './AssistantReplicationScene';
import { openContentGenerationQueue } from '../../lib/contentGenerationQueue';
import { isContentProductionPlatform } from '../../../shared/contracts/contentProductionPlatforms';
const AssistantHookScene = lazy(() => import('./AssistantHookScene'));
const AssistantCampaignScene = lazy(() => import('./AssistantCampaignScene'));
const AssistantScenarioPlanner = lazy(() => import('./AssistantScenarioPlanner'));

export function creationPortalHomeNavigation(value: AssistantCreationPortal) {
  assistantCreationPortalSchema.parse(value);
  return { page: 'socialInspiration' as const };
}

export function creationPortalNavigation(value: AssistantCreationPortal, requestId = Date.now()) {
  const portal = assistantCreationPortalSchema.parse(value);
  const productionPlatforms = portal.platforms.filter(isContentProductionPlatform);
  const request: SocialContentCreateRequest = {
    requestId, themeId: 'product_value', mode: 'instant', creationPath: portal.imageReplication ? 'viral_replication' : 'material_processing',
    materialInput: 'none', managedMode: 'one_click_managed', assistantEntry: portal,
    prefill: { title: portal.title, topic: portal.objective, platforms: productionPlatforms.length ? productionPlatforms : ['facebook'] },
    specialRequirements: portal.objective,
    ...(portal.imageReplication ? { sourceContext: {
      originLabel: '来自灵小枢对话', referenceContentType: 'image' as const,
      referenceTitle: portal.imageReplication.reference?.name || '',
      referenceMaterialId: portal.imageReplication.reference?.materialId,
      referenceSourceRecordId: portal.imageReplication.reference?.sourceRecordId,
      referenceImageIndex: portal.imageReplication.reference?.imageIndex,
      aspectRatio: portal.aspectRatio || undefined,
    } } : {}),
  };
  return { page: 'smartAssets', view: 'create', studioEntry: true, directStudio: false, contentCreationRequest: request };
}

export default function AssistantCreationPortalCard({ portal }: { portal: AssistantCreationPortal }) {
  const { message } = AntApp.useApp();
  const identity = useRef(productionNavigationIdentity());
  const valid = assistantCreationPortalSchema.safeParse(portal.scenario === 'viral_replication' && Array.isArray(portal.selectedProducts)
    ? { ...portal, selectedProducts: portal.selectedProducts.map(({ id, name }) => ({ id, name })) } : portal);
  if (!valid.success) return null;
  const item = valid.data;
  const unsupportedProductionPlatform = item.platforms.some(platform => !isContentProductionPlatform(platform));
  if (item.imageReplication) return <AssistantImageReplicationScene portal={item}
    request={creationPortalNavigation(item).contentCreationRequest}/>;
  if (item.scenario === 'viral_replication') return <AssistantReplicationScene portal={item}/>;
  if (item.scenario === 'weekly_calendar') return <button type="button" aria-label="打开内容创作 - 发布日历" data-assistant-calendar-portal={item.id}
    className="mt-3 flex w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left text-text-primary transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    onClick={() => {
      if (identity.current !== productionNavigationIdentity()) { void message.warning('登录状态已变化，请重新打开当前会话。'); return; }
      openContentGenerationQueue({view:'calendar'});
    }}>
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-2 text-accent" aria-hidden="true"><CalendarDays size={22}/></span>
    <span className="min-w-0 flex-1"><strong className="block text-sm font-semibold">内容创作 · 发布日历</strong>
      <span className="mt-0.5 block text-xs text-text-secondary">查看已有排期、任务状态与发布时间</span>
    </span><ArrowRight size={17} className="shrink-0 text-text-muted" aria-hidden="true"/>
  </button>;
  if(item.scenario==='hook_first')return <Suspense fallback={<p role="status">正在打开开场场景…</p>}><AssistantHookScene portal={item}/></Suspense>;
  if(item.scenario==='campaign')return <Suspense fallback={<p role="status">正在打开活动场景…</p>}><AssistantCampaignScene portal={item}/></Suspense>;
  if (['content_task'].includes(item.scenario || '')) return <Suspense fallback={<p role="status">正在打开场景…</p>}><AssistantScenarioPlanner portal={item}/></Suspense>;
  return <button type="button" aria-label="打开内容创作" data-assistant-creation-portal={item.id}
    className="mt-3 flex w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left text-text-primary transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    onClick={() => {
      if (identity.current !== productionNavigationIdentity()) { void message.warning('登录状态已变化，请重新打开当前会话。'); return; }
      window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { ...creationPortalHomeNavigation(item), navigationIdentity: identity.current } }));
    }}>
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-2 text-accent" aria-hidden="true">{item.imageReplication ? <Images size={22}/> : <Clapperboard size={22}/>}</span>
    <span className="min-w-0 flex-1"><strong className="block text-sm font-semibold">{item.imageReplication ? '图文爆款复刻' : '内容创作'}</strong>
      <span className="mt-0.5 block text-xs text-text-secondary">{item.imageReplication ? '确认参考图和产品后创建复刻任务' : item.requestedOutputCount === null ? '数量待确认' : `${item.requestedOutputCount}条${item.outputType === 'video' ? '视频' : '内容'}`} · 打开{unsupportedProductionPlatform ? '；当前仅制作 LinkedIn / Facebook，默认改为 Facebook' : ''}</span>
    </span><ArrowRight size={17} className="shrink-0 text-text-muted" aria-hidden="true"/>
  </button>;
}

export function taskPortalNavigation(portal: AssistantTaskPortal) {
  const item = assistantTaskPortalSchema.parse(portal);
  if (item.phase !== 'ready') throw new Error('请先确认是否打开任务。');
  if (item.action === 'view_production') return productionPortalNavigation(item.taskId);
  return { page: 'smartAssets', socialContentTaskId: item.taskId, socialContentPage: 'smartAssets', directStudio: true };
}

export function AssistantTaskPortalCard({ portal }: { portal: AssistantTaskPortal }) {
  const { message } = AntApp.useApp();
  const identity = useRef(productionNavigationIdentity());
  const parsed = assistantTaskPortalSchema.safeParse(portal);
  if (!parsed.success || parsed.data.phase !== 'ready') return null;
  const item = parsed.data;
  if (item.action === 'view_production') return <AssistantProductionPortal taskId={item.taskId}/>;
  const action = item.action === 'review_plan' ? '确认方案' : item.action === 'complete_brief' ? '补充制作信息' : '查看任务';
  return <button type="button" aria-label={`打开任务：${item.title}`} data-assistant-task-portal={item.taskId}
    className="mt-3 flex w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left text-text-primary transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    onClick={() => {
      if (identity.current !== productionNavigationIdentity()) { void message.warning('登录状态已变化，请重新打开当前会话。'); return; }
      window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { ...taskPortalNavigation(item), navigationIdentity: identity.current } }));
    }}>
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-2 text-accent" aria-hidden="true"><Clapperboard size={22}/></span>
    <span className="min-w-0 flex-1"><strong className="block text-sm font-semibold">内容创作 · {action}</strong>
      <span className="mt-0.5 block truncate text-xs text-text-secondary">{item.title}</span>
    </span><ArrowRight size={17} className="shrink-0 text-text-muted" aria-hidden="true"/>
  </button>;
}

export function AssistantSourcePortalCard({ portal }: { portal: AssistantSourcePortal }) {
  const parsed = assistantSourcePortalSchema.safeParse(portal);
  if (!parsed.success) return null;
  const item = parsed.data;
  return <a href={item.uri} target="_blank" rel="noopener noreferrer" aria-label={`查看原文：${item.title}`}
    className="mt-3 flex w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left text-text-primary transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
    <span className="min-w-0 flex-1"><strong className="block truncate text-sm font-semibold">{item.title}</strong>
      <span className="mt-0.5 block text-xs text-text-secondary">{new URL(item.uri).hostname} · 查看原文</span>
    </span><ArrowRight size={17} className="shrink-0 text-text-muted" aria-hidden="true"/>
  </a>;
}

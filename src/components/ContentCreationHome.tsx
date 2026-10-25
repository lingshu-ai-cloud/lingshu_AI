import { Alert, Spin } from 'antd';
import { ArrowRight, CalendarCheck2, ChevronDown, ChevronUp, GraduationCap, LayoutGrid, Newspaper, Target, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Page } from '../pageRegistry';
import { digitalEmployeeApi } from '../lib/digitalEmployeeApi';
import { AUTH_TOKEN_CHANGED_EVENT } from '../lib/auth';
import type { DigitalEmployeeOverview } from '../lib/digitalEmployees';
import { AuthenticatedImage } from './inspiration/InspirationMedia';
import { ASSISTANT_HOME_ACTIVITY_EVENT } from './assistant/useAssistantHomeAnchor';
import { industrySignalsReply, operatingStrategyReply, weeklyTaskReply } from './contentCreationHomeReplies';

function CanvasCard({ mediaUrl, title, description, icon, onClick, primary = false }: {
  mediaUrl?: string;
  title: string;
  description: string;
  icon: ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  const [failedMediaUrl, setFailedMediaUrl] = useState('');
  const showMedia = Boolean(mediaUrl && failedMediaUrl !== mediaUrl);
  return <button type="button" onClick={onClick} className={`creator-home__canvas-card${primary ? ' creator-home__canvas-card--primary' : ''}${showMedia ? ' creator-home__canvas-card--with-media' : ''}`}>
    {showMedia && mediaUrl ? <AuthenticatedImage src={mediaUrl} alt="" className="creator-home__canvas-card-media" onError={() => setFailedMediaUrl(mediaUrl)}/> : null}
    <span className="creator-home__canvas-card-shade" aria-hidden="true"/>
    <span className="creator-home__canvas-card-content">{icon}<strong>{title}</strong><span>{description}</span></span>
  </button>;
}

export default function ContentCreationHome({ inspirationWorkspace }: { onNavigate?: (page: Page) => void; inspirationWorkspace?: ReactNode }) {
  const [overview, setOverview] = useState<DigitalEmployeeOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const [overviewRevision, setOverviewRevision] = useState(0);
  const [canvasCollapsed, setCanvasCollapsed] = useState(false);

  useEffect(() => {
    const resetTenantData = () => { setOverview(null); setOverviewRevision(value => value + 1); };
    const onStorage = (event: StorageEvent) => { if (event.key === 'overseas_token' || event.key === null) resetTenantData(); };
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, resetTenantData);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, resetTenantData); window.removeEventListener('storage', onStorage); };
  }, []);

  useEffect(() => {
    let active = true;
    setOverviewLoading(true);
    setOverviewError('');
    void digitalEmployeeApi.overview()
      .then(data => { if (active) setOverview(data); })
      .catch(error => { if (active) setOverviewError(error instanceof Error ? error.message : '周任务状态读取失败'); })
      .finally(() => { if (active) setOverviewLoading(false); });
    return () => { active = false; };
  }, [overviewRevision]);

  useEffect(() => {
    const onAssistantActivity = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean }>).detail;
      if (detail?.active) setCanvasCollapsed(true);
    };
    window.addEventListener(ASSISTANT_HOME_ACTIVITY_EVENT, onAssistantActivity);
    return () => window.removeEventListener(ASSISTANT_HOME_ACTIVITY_EVENT, onAssistantActivity);
  }, []);

  const suggest = (prompt: string) => window.dispatchEvent(new CustomEvent('lingshu:assistant-home-prompt', { detail: prompt }));
  const askAssistant = (text: string, scriptedReply?: string) => window.dispatchEvent(new CustomEvent('lingshu-assistant-open', {
    detail: {
      text,
      scriptedReply,
      context: {
        agent: 'strategy',
        label: 'hi，灵小枢',
        summary: '当前从轻量首页进入，由灵小枢通过对话解释现状并引导完成目标。',
        sourcePage: 'strategy',
        workflowStage: overview?.goal ? 'planned' : 'unplanned',
        goalId: overview?.goal?.id,
        planId: overview?.plan?.id,
        runId: overview?.run?.id,
      },
    },
  }));
  const initialEntry = !overview?.config;
  const industrySignalCount = overview?.industryTrends?.signals.length ?? 0;
  const cardMedia = useMemo(() => {
    const urls = [
      ...(overview?.industryTrends?.signals.map(item => item.thumbnailUrl) || []),
      ...(overview?.review?.summary.contentPerformance?.map(item => item.thumbnailUrl) || []),
      ...(overview?.goal?.videoPlans?.map(item => item.planningEvidence?.referenceThumbnailUrl || item.preproduction?.benchmark.thumbnailUrl) || []),
    ].map(value => String(value || '').trim()).filter(Boolean);
    return [...new Set(urls)];
  }, [overview]);
  const card = (index: number, title: string, description: string, icon: ReactNode, onClick: () => void, primary = false) => {
    const mediaUrl = cardMedia[index % Math.max(cardMedia.length, 1)];
    return <CanvasCard key={`${index}:${title}`} mediaUrl={mediaUrl} title={title} description={description} icon={icon} onClick={onClick} primary={primary}/>;
  };

  return <div className="creator-home creator-home--employee h-full overflow-y-auto">
    <div className="creator-home__inner">
      <header className="creator-home__hero text-center">
        <h2>今天想让数字员工完成什么？</h2>
      </header>

      <div className={`creator-home__canvas-stage${canvasCollapsed ? ' is-collapsed' : ''}`} inert={canvasCollapsed ? true : undefined} aria-hidden={canvasCollapsed || undefined}>
        <section id="creator-home-operations" className="creator-home__canvas" aria-label="数字员工快捷入口">
          {overviewError && <Alert type="warning" showIcon title={overviewError} className="mb-3"/>}
          {overviewLoading && !overview
            ? <div className="flex min-h-40 items-center justify-center"><Spin description="正在读取数字员工工作"/></div>
            : initialEntry
              ? <div className="creator-home__canvas-grid creator-home__canvas-grid--onboarding">
                  {card(0, '让灵小枢认识你', '录入企业、品牌、主推产品和市场信息', <UserRound size={28}/>, () => askAssistant(
                    '请通过对话认识我的企业、品牌、主推产品和目标市场。',
                    '好，我们从企业与品牌开始。\n\n请用一句话告诉我：企业名称、品牌名称、主推产品，以及主要目标市场。\n\n例如：我们是「澄光美研」，品牌是「Aurelia」，主推精华与面霜，主要面向北美市场。',
                  ))}
                  {card(1, '新手成长', '继续完善企业知识库与数字人形象', <GraduationCap size={28}/>, () => askAssistant('请通过对话引导我完善新手成长资料，优先检查企业知识库和数字人形象。'), true)}
                </div>
              : <div className="creator-home__canvas-grid creator-home__canvas-grid--operations">
                  {card(0, '今日资讯', industrySignalCount ? `${industrySignalCount} 条真实行业与社媒信号` : '行业 B2B、政策与社媒动态', <Newspaper size={28}/>, () => { setCanvasCollapsed(true); askAssistant('请结合我的企业和目标市场，解读今日 B2B 行业资讯、政策调整和社媒热潮，并告诉我哪些值得行动。', industrySignalsReply(overview)); })}
                  {card(1, '经营策略', overview?.plan?.strategy || '查看当前周计划策略与 Agent 设置', <Target size={28}/>, () => { setCanvasCollapsed(true); askAssistant('请查看当前经营策略和 Agent 设置，告诉我本周重点、依据和下一步建议。', operatingStrategyReply(overview)); })}
                  {card(2, '周经营任务', overview?.goal ? `${overview.goal.title} · ${overview.run?.status || '待启动'}` : '制定并确认本周经营任务', <CalendarCheck2 size={28}/>, () => { setCanvasCollapsed(true); askAssistant(overview?.goal ? '查看当前周任务的状态和进度' : '帮我创建当前周任务', weeklyTaskReply(overview)); }, true)}
                </div>}
        </section>
      </div>
      <div className="creator-home__canvas-toggle-row">
        <button type="button" className="creator-home__canvas-toggle" aria-controls="creator-home-operations" aria-expanded={!canvasCollapsed} onClick={() => setCanvasCollapsed(value => !value)}>
          <LayoutGrid size={15} aria-hidden="true"/>
          <span>{canvasCollapsed ? '展开快捷入口' : '收起快捷入口'}</span>
          {canvasCollapsed ? <ChevronDown size={14} aria-hidden="true"/> : <ChevronUp size={14} aria-hidden="true"/>}
        </button>
      </div>

      <section className="creator-home__conversation" aria-label="灵小枢对话">
        <div id="content-creation-assistant-anchor" className="creator-home__assistant-anchor"/>
      </section>

      <div className="creator-home__suggestions" aria-label="创作建议">
        {['写一条爆款视频脚本', '帮我制作产品分镜', '提炼产品卖点', '规划本周内容', '查看素材怎么用'].map(prompt =>
          <button type="button" key={prompt} onClick={() => suggest(prompt)}>{prompt}<ArrowRight size={14} aria-hidden="true"/></button>)}
      </div>

      <section id="creator-home-library" className="creator-home__library" aria-label="爆款视频、素材库、对标账号和待拍">
        {inspirationWorkspace}
      </section>
    </div>
  </div>;
}

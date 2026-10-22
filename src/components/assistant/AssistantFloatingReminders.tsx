import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Loader2, X } from 'lucide-react';
import type { AgentType, Page } from '../../App';
import type { AssistantGuide } from '../../lib/assistantGuides';
import { lsMotion } from '../../lib/designTokens';
import { shouldNotifyAssistant, type AssistantNotificationReason } from '../../stores/assistantStore';

type Performance = { phase: string; message?: string; reason: AssistantNotificationReason };
type Speech = { id: number; message: string };

interface Props {
  page: Page;
  mode: 'breathing' | 'chat';
  launcherRetracted: boolean;
  reduceMotion: boolean;
  viewportWidth: number;
  performance: Performance | null;
  performanceHidden: boolean;
  performanceMessage: string;
  onHidePerformance: () => void;
  speechBubble: Speech | null;
  weeklyPlanKickoffAvailable: boolean;
  weeklyPlanPromptDismissed: boolean;
  onDismissWeeklyPlanPrompt: () => void;
  onOpenWeeklyPlan: () => void;
  featureGuide: (AssistantGuide & { id: string }) | null;
  onDismissFeatureGuide: () => void;
  onOpenFeatureGuide: (agent: AgentType) => void;
  enterpriseGuideSeen: boolean;
  onOpenCurrentPageAgent: () => void;
}

/** Only the highest-priority reminder is visible beside the expanded launcher. */
export default function AssistantFloatingReminders(props: Props) {
  const { page, mode, launcherRetracted, reduceMotion, viewportWidth, performance,
    performanceHidden, performanceMessage, onHidePerformance, speechBubble,
    weeklyPlanKickoffAvailable, weeklyPlanPromptDismissed, onDismissWeeklyPlanPrompt,
    onOpenWeeklyPlan, featureGuide, onDismissFeatureGuide, onOpenFeatureGuide,
    enterpriseGuideSeen, onOpenCurrentPageAgent } = props;
  const fadeTransition = { duration: (reduceMotion ? lsMotion.duration.instant : lsMotion.duration.enter) / 1000, ease: lsMotion.ease.enter };
  const fadeExit = { opacity: 0, transition: { duration: (reduceMotion ? lsMotion.duration.instant : lsMotion.duration.exit) / 1000, ease: lsMotion.ease.exit } };
  const canShow = !launcherRetracted && mode === 'breathing';
  const hasPerformancePriority = Boolean(performance && shouldNotifyAssistant(performance.reason) && !performanceHidden);

  return (
    <>
      <AnimatePresence>
        {canShow && hasPerformancePriority && performance && (
          <motion.div
            key={`performance-${performance.phase}`}
            data-assistant-surface="floating-reminder"
            data-lingshu-assistant-performance={performance.phase}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={fadeExit}
            transition={fadeTransition}
            className="absolute bottom-0 right-[calc(100%+8px)] z-30 w-[248px] max-w-[calc(100vw-176px)] rounded-lg border border-border bg-surface p-3 shadow-lg"
            style={{ width: Math.min(248, viewportWidth - 104), maxWidth: 'calc(100vw - 176px)' }}
          >
            <button type="button" onClick={onHidePerformance}
              className="absolute right-2 top-2 rounded-md p-1 text-text-muted transition hover:bg-surface-2 hover:text-text-primary"
              aria-label="隐藏灵小枢等待提示" title="先隐藏"><X size={13} /></button>
            <p className="ls-type-label-medium pr-6 text-accent">灵小枢陪你等</p>
            <p className="ls-type-body-small mt-1 text-text-secondary">{performanceMessage}</p>
            <span className="ls-type-label-medium mt-2 inline-flex items-center gap-1.5 text-accent"><Loader2 size={12} className="motion-safe:animate-spin" aria-hidden="true" />处理中</span>
            <span className="absolute -right-2 bottom-5 h-4 w-4 rotate-45 border-r border-t border-border bg-surface" />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {canShow && !hasPerformancePriority && speechBubble && (
          <motion.div key={`speech-${speechBubble.id}`} data-assistant-surface="floating-reminder"
            data-lingshu-assistant-speech="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            exit={fadeExit} transition={fadeTransition}
            className="absolute bottom-0 right-[calc(100%+8px)] z-30 w-[248px] max-w-[calc(100vw-176px)] rounded-lg border border-border bg-surface p-3 shadow-lg"
            style={{ width: Math.min(248, viewportWidth - 104), maxWidth: 'calc(100vw - 176px)' }}>
            <p className="ls-type-label-medium text-accent">灵小枢</p>
            <p className="ls-type-body-small mt-1 text-text-secondary">{speechBubble.message}</p>
            <span className="absolute -right-2 bottom-5 h-4 w-4 rotate-45 border-r border-t border-border bg-surface" />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {canShow && !hasPerformancePriority && !speechBubble && weeklyPlanKickoffAvailable && !weeklyPlanPromptDismissed && (
          <motion.div key="weekly-plan-kickoff" data-assistant-surface="floating-reminder"
            data-lingshu-weekly-plan-prompt="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            exit={fadeExit} transition={fadeTransition}
            className="absolute bottom-0 right-[calc(100%+8px)] z-30 w-[264px] max-w-[calc(100vw-176px)] rounded-lg border border-border bg-surface p-3 shadow-lg"
            style={{ width: Math.min(264, viewportWidth - 104), maxWidth: 'calc(100vw - 176px)' }}>
            <button type="button" onClick={onDismissWeeklyPlanPrompt}
              className="absolute right-2 top-2 rounded-md p-1 text-text-muted transition hover:bg-surface-2 hover:text-text-primary"
              aria-label="暂时关闭周计划提示"><X size={13} /></button>
            <p className="ls-type-label-medium pr-6 text-accent">先制定本周计划</p>
            <p className="ls-type-body-small mt-1 text-text-secondary">我会先整理平台、产量、预算和排期，给你预览；你确认后才开始生产。</p>
            <button type="button" onClick={onOpenWeeklyPlan}
              className="ls-type-label-medium mt-2 inline-flex items-center gap-1.5 text-accent hover:text-accent-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              制定周计划 <ArrowRight size={13} aria-hidden="true" />
            </button>
            <span className="absolute -right-2 bottom-5 h-4 w-4 rotate-45 border-r border-t border-border bg-surface" />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {canShow && !hasPerformancePriority && !speechBubble && (!weeklyPlanKickoffAvailable || weeklyPlanPromptDismissed) && featureGuide && (
          <motion.div key={featureGuide.id} data-assistant-surface="floating-reminder"
            data-lingshu-guide-bubble={featureGuide.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            exit={fadeExit} transition={fadeTransition}
            className="absolute bottom-0 right-[calc(100%+8px)] z-20 w-[236px] max-w-[calc(100vw-176px)] rounded-lg border border-border bg-surface p-3 shadow-lg"
            style={{ width: Math.min(236, viewportWidth - 104), maxWidth: 'calc(100vw - 176px)' }}>
            <button type="button" onClick={onDismissFeatureGuide}
              className="absolute right-2.5 top-2.5 rounded-lg p-1 text-text-muted hover:bg-surface-2"
              aria-label="关闭用法提示"><X size={13} /></button>
            <div className="pr-6">
              <p className="ls-type-label-medium text-accent">{featureGuide.title}</p>
              <p className="ls-type-body-small mt-1 text-text-secondary">{featureGuide.message}</p>
            </div>
            <button type="button" onClick={() => onOpenFeatureGuide(featureGuide.agent)}
              className="ls-type-label-medium mt-2 text-accent hover:text-accent-dim">问问灵小枢 →</button>
            <span className="absolute -right-2 bottom-5 h-4 w-4 rotate-45 border-r border-t border-border bg-surface" />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {canShow && page === 'enterprise' && enterpriseGuideSeen && !featureGuide && !speechBubble && (
          <motion.button type="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            exit={fadeExit} transition={fadeTransition} onClick={onOpenCurrentPageAgent}
            className="ls-type-label-medium absolute bottom-2 right-[calc(100%+8px)] z-10 whitespace-nowrap rounded-md border border-border bg-surface px-3 py-1.5 text-accent shadow-sm hover:border-accent/30 hover:bg-accent-glow">
            要补资料？点我
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}

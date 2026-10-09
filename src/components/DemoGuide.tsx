import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'antd';
import { motion } from 'motion/react';
import { CheckCircle2, Sparkles } from 'lucide-react';
import type { Page } from '../App';
import { DEMO_PROGRESS_EVENT, readDemoProgress, writeDemoProgress, type DemoStepId } from '../lib/demoProgress';
import { lsMotion } from '../lib/designTokens';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import { LsBrandAction, LsFlowDialog } from './ui/LsExperiencePrimitives';

interface GuideStep {
  id: DemoStepId;
  title: string;
  body: string;
  target: string;
  page: Page;
}

const STEPS: GuideStep[] = [
  {
    id: 'template',
    title: '第一步 加载企业模版',
    body: '先点击被高亮的加载按钮，我会把测试号行业资料注入企业中心，让后面的 Agent 更懂你的业务。',
    target: 'template',
    page: 'enterprise',
  },
  {
    id: 'strategy',
    title: '第二步 获取策略建议',
    body: '点击页面中高亮的问题卡片，让首页先帮你把目标市场、产品和增长动作串起来。',
    target: 'strategy_prompt',
    page: 'strategy',
  },
  {
    id: 'traffic',
    title: '第三步 生成脚本',
    body: '在智能素材里点击高亮的生成按钮，体验一次爆款素材脚本生成。生成后我会直接带你进入第四步。',
    target: 'traffic_script_generate',
    page: 'smartAssets',
  },
  {
    id: 'conversion',
    title: '第四步 处理模拟询盘',
    body: '点击高亮按钮，让我的客户接手一条模拟询盘，看看报价话术如何被自动整理和推进。',
    target: 'conversion_reply',
    page: 'conversion',
  },
  {
    id: 'retention',
    title: '第五步 创建老客唤醒',
    body: '点击高亮的问题卡片，让我的客户生成老客分层、复购触达和唤醒节奏。',
    target: 'retention_prompt',
    page: 'retention',
  },
  {
    id: 'scheduler',
    title: '第六步 创建自动任务',
    body: '从 0 新建一个每天 01:00 的视频采集定时任务，不需要立即执行真实爬虫。',
    target: 'scheduled_run',
    page: 'scheduled',
  },
  {
    id: 'automation_workflow',
    title: '第七步 体验自动化工作流',
    body: '右侧会打开任务详情抽屉。找到“建议下一步”区域，点击高亮的“去智能素材/去首页”按钮，我会带着任务上下文自动跳到对应模块。',
    target: 'automation_workflow_agent',
    page: 'scheduled',
  },
];

const COMPLETE_FEEDBACK_MS = 4000;

function useTargetRect(target: string, tick: number) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const update = () => {
      const el = document.querySelector(`[data-demo-target="${target}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-demo-target'] });
    const timer = window.setTimeout(update, 80);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [target, tick]);

  return rect;
}

export default function DemoGuide({ page, onNavigate, onShown, forceStart }: { page: Page; onNavigate: (p: Page) => void; onShown?: () => void; forceStart?: boolean }) {
  const reduceMotion = usePrefersReducedMotion();
  const [done, setDone] = useState<Record<string, boolean>>(() => forceStart ? {} : readDemoProgress());
  const [showCelebration, setShowCelebration] = useState(false);
  const [guideDialogOpen, setGuideDialogOpen] = useState(true);
  const wasCompleteRef = useRef(STEPS.every(step => readDemoProgress()[step.id]));
  const didNotifyShownRef = useRef(false);
  const [tick, setTick] = useState(0);
  const current = useMemo(() => STEPS.find(step => !done[step.id]) ?? STEPS[STEPS.length - 1], [done]);
  const currentStepIndex = STEPS.findIndex(step => step.id === current.id);
  const rect = useTargetRect(current.target, tick);
  const completedCount = STEPS.filter(step => done[step.id]).length;
  const isComplete = completedCount === STEPS.length;

  useEffect(() => {
    if (!didNotifyShownRef.current) {
      didNotifyShownRef.current = true;
      onShown?.();
    }
    let completionTimer: number | undefined;
    const applyProgress = (next: Record<string, boolean>) => {
      const nextComplete = STEPS.every(step => next[step.id]);
      if (nextComplete && !wasCompleteRef.current) {
        setShowCelebration(true);
        window.clearTimeout(completionTimer);
        completionTimer = window.setTimeout(() => setShowCelebration(false), COMPLETE_FEEDBACK_MS);
      }
      wasCompleteRef.current = nextComplete;
      setDone(next);
      if (!nextComplete) setGuideDialogOpen(true);
      setTick(value => value + 1);
    };
    const sync = () => {
      applyProgress(readDemoProgress());
    };
    const onCustom = (event: Event) => {
      applyProgress((event as CustomEvent<Record<string, boolean>>).detail ?? readDemoProgress());
    };
    window.addEventListener('storage', sync);
    window.addEventListener(DEMO_PROGRESS_EVENT, onCustom);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(DEMO_PROGRESS_EVENT, onCustom);
      window.clearTimeout(completionTimer);
    };
  }, [onShown]);

  const go = () => {
    setGuideDialogOpen(false);
    onNavigate(current.page);
    window.setTimeout(() => setTick(value => value + 1), 120);
  };

  const skipGuide = () => {
    const skipped = Object.fromEntries(STEPS.map(step => [step.id, true]));
    wasCompleteRef.current = true;
    setShowCelebration(false);
    setGuideDialogOpen(false);
    writeDemoProgress(skipped);
  };

  if (isComplete) {
    return showCelebration ? (
      <div className="pointer-events-none fixed inset-0 z-[90] overflow-hidden" role="status" aria-live="polite">
        <motion.div
          initial={{ opacity: reduceMotion ? 1 : 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: (reduceMotion ? lsMotion.duration.instant : lsMotion.duration.enter) / 1000, ease: lsMotion.ease.enter }}
          className="absolute inset-x-0 top-6 flex justify-center px-6"
        >
          <div className="max-w-[560px] rounded-lg border border-border bg-white/95 px-6 py-6 text-center shadow-xl sm:px-8 sm:py-7">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-green/10 text-green">
              <CheckCircle2 size={22} />
            </div>
            <p className="ls-type-title-medium text-text-primary">
              现在你已经了解灵枢AI啦，一起加油吧～
            </p>
          </div>
        </motion.div>
      </div>
    ) : null;
  }

  return (
    <>
      {rect && !guideDialogOpen && (
        <div
          className="pointer-events-none fixed z-[70] rounded-lg"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: '0 0 0 9999px rgba(24, 24, 27, 0.10), 0 0 0 2px rgba(37, 99, 235, 0.52), 0 8px 24px rgba(24, 24, 27, 0.12)',
          }}
        />
      )}

      <LsFlowDialog
        open={guideDialogOpen}
        onCancel={() => setGuideDialogOpen(false)}
        title="新手引导"
        width={680}
        current={currentStepIndex}
        steps={STEPS.map((step, index) => ({
          title: ['企业', '策略', '脚本', '询盘', '唤醒', '定时', '自动化'][index],
          status: done[step.id] ? 'finish' : index === currentStepIndex ? 'process' : 'wait',
        }))}
        mask={{ closable: false }}
        footer={[
          <Button key="skip" type="text" onClick={skipGuide}>跳过引导</Button>,
          <LsBrandAction key="go" onClick={go}>{current.page === page ? '开始这一步' : '带我去'}</LsBrandAction>,
        ]}
      >
        <div className="flex items-start gap-4 rounded-lg bg-surface-2 p-4">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-accent-glow text-accent">
            <Sparkles size={18} />
          </span>
          <div className="min-w-0">
            <p className="ls-type-title-small text-text-primary">你好，我是灵枢 AI，你的出海外贸助手。</p>
            <p className="ls-type-body-small mt-1 text-text-muted">进度会自动保存，退出后也可从当前步骤继续。</p>
          </div>
        </div>

        <div className="mt-5">
          <p id="demo-guide-step-title" className="ls-type-title-medium text-text-primary">{current.title}</p>
          <p className="ls-type-body-medium mt-2 text-text-secondary">{current.body}</p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <span className="text-xs font-medium text-text-muted">当前步骤 {currentStepIndex + 1}/{STEPS.length}</span>
            <span className="text-xs font-medium text-accent">{current.page === page ? '目标页面已就绪' : '将前往对应页面'}</span>
          </div>
        </div>
      </LsFlowDialog>

      {!guideDialogOpen && <button type="button" onClick={() => setGuideDialogOpen(true)} className="fixed bottom-4 left-4 z-[71] rounded-md border border-border bg-white px-3 py-2 text-xs font-semibold text-text-primary shadow-lg hover:bg-surface-2">继续新手引导 · {currentStepIndex + 1}/{STEPS.length}</button>}
    </>
  );
}

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { motion } from 'motion/react';
import { Sparkles } from 'lucide-react';
import type { Page } from '../App';
import { DEMO_PROGRESS_EVENT, readDemoProgress, writeDemoProgress, type DemoStepId } from '../lib/demoProgress';

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

const CONFETTI_COLORS = ['#117f51', '#d7eadb', '#e98268', '#fff3e7', '#173d31'];

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
  const [done, setDone] = useState<Record<string, boolean>>(() => forceStart ? {} : readDemoProgress());
  const [showCelebration, setShowCelebration] = useState(false);
  const wasCompleteRef = useRef(STEPS.every(step => readDemoProgress()[step.id]));
  const didNotifyShownRef = useRef(false);
  const [tick, setTick] = useState(0);
  const current = useMemo(() => STEPS.find(step => !done[step.id]) ?? STEPS[STEPS.length - 1], [done]);
  const currentStepIndex = STEPS.findIndex(step => step.id === current.id);
  const rect = useTargetRect(current.target, tick);
  const completedCount = STEPS.filter(step => done[step.id]).length;
  const isComplete = completedCount === STEPS.length;
  const confetti = useMemo(() => Array.from({ length: 72 }, (_, index) => ({
    id: index,
    left: `${(index * 37) % 100}%`,
    delay: `${(index % 12) * 0.08}s`,
    duration: `${4.8 + (index % 8) * 0.24}s`,
    color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
    rotate: `${(index * 23) % 180}deg`,
    size: 6 + (index % 4) * 2,
    drift: ((index * 29) % 180) - 90,
  })), []);

  useEffect(() => {
    if (!didNotifyShownRef.current) {
      didNotifyShownRef.current = true;
      onShown?.();
    }
    const applyProgress = (next: Record<string, boolean>) => {
      const nextComplete = STEPS.every(step => next[step.id]);
      if (nextComplete && !wasCompleteRef.current) {
        setShowCelebration(true);
        window.setTimeout(() => setShowCelebration(false), 7200);
      }
      wasCompleteRef.current = nextComplete;
      setDone(next);
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
    };
  }, [onShown]);

  useEffect(() => {
    if (isComplete || current.page === page) return;
    const timer = window.setTimeout(() => {
      onNavigate(current.page);
      setTick(value => value + 1);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [current.id, current.page, isComplete, onNavigate, page]);

  const go = () => {
    onNavigate(current.page);
    window.setTimeout(() => setTick(value => value + 1), 120);
  };

  const skipGuide = () => {
    const skipped = Object.fromEntries(STEPS.map(step => [step.id, true]));
    wasCompleteRef.current = true;
    setShowCelebration(false);
    writeDemoProgress(skipped);
  };

  if (isComplete) {
    return showCelebration ? (
      <div className="pointer-events-none fixed inset-0 z-[90] overflow-hidden bg-slate-950/18" aria-live="polite">
        {confetti.map(piece => (
          <span
            key={piece.id}
            className="absolute -top-10 rounded-[2px]"
            style={{
              left: piece.left,
              width: piece.size,
              height: piece.size * 1.8,
              background: piece.color,
              transform: `rotate(${piece.rotate})`,
              animation: `demo-confetti-fall ${piece.duration} ${piece.delay} cubic-bezier(.18,.72,.28,.98) forwards`,
              '--drift': `${piece.drift}px`,
            } as CSSProperties}
          />
        ))}
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 16 }}
          animate={{ opacity: 1, scale: [0.92, 1.04, 1], y: 0 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.72, times: [0, 0.58, 1], ease: 'easeOut' }}
          className="absolute inset-0 flex items-center justify-center px-6"
        >
          <div className="max-w-[560px] rounded-lg border border-border bg-white/95 px-6 py-6 text-center shadow-xl sm:px-8 sm:py-7">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-accent-glow text-accent">
              <Sparkles size={22} />
            </div>
            <p className="text-xl font-bold leading-snug text-text-primary sm:text-2xl">
              现在你已经了解灵枢AI啦，一起加油吧～
            </p>
          </div>
        </motion.div>
        <style>{`
          @keyframes demo-confetti-fall {
            0% { transform: translate3d(0, -12vh, 0) rotate(0deg); opacity: 0; }
            8% { opacity: 1; }
            100% { transform: translate3d(var(--drift, 0), 112vh, 0) rotate(720deg); opacity: 0.95; }
          }
        `}</style>
      </div>
    ) : null;
  }

  return (
    <>
      {rect && (
        <div
          className="pointer-events-none fixed z-[70] rounded-lg transition-all duration-200"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: '0 0 0 9999px rgba(23, 61, 49, 0.10), 0 0 0 2px rgba(17, 127, 81, 0.52), 0 8px 24px rgba(17, 127, 81, 0.16)',
          }}
        />
      )}

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -6 }}
        animate={{ opacity: 1, scale: [0.96, 1.025, 1], y: [-6, 0, 0] }}
        transition={{ duration: 0.55, times: [0, 0.62, 1], ease: 'easeOut' }}
        role="region"
        aria-live="polite"
        aria-labelledby="demo-guide-step-title"
        className="fixed bottom-3 left-3 right-3 z-[71] overflow-visible rounded-lg border border-border bg-white shadow-lg sm:bottom-6 sm:left-4 sm:right-auto sm:w-[318px]"
      >
        <div className="px-4 py-4">
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={skipGuide}
              className="rounded-md px-2 py-1 text-[11px] font-semibold text-text-muted hover:bg-surface-2 hover:text-text-secondary"
            >
              跳过引导
            </button>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-accent-glow text-accent">
              <Sparkles size={14} />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-text-primary leading-relaxed">
                你好，我是灵枢AI，你的出海外贸助手，请多多指教！
              </p>
            </div>
          </div>

          <div className="mt-4">
            <p id="demo-guide-step-title" className="text-[15px] font-bold leading-snug text-text-primary">{current.title}</p>
          </div>

          <p className="text-xs text-text-secondary mt-3 leading-relaxed">
            {current.page !== page ? '我正在带你进入对应页面，稍等一下。' : current.body}
          </p>

          <div className="flex items-center justify-between gap-3 mt-4">
            <span className="inline-flex items-center border-l-2 border-insight bg-insight-soft px-2.5 py-1 text-[12px] font-bold text-insight-action">
              当前步骤 {currentStepIndex + 1}/{STEPS.length}
            </span>
            <button
              type="button"
              onClick={go}
              className="h-8 flex-shrink-0 rounded-md bg-accent px-4 text-xs font-semibold text-white hover:bg-accent-dim"
            >
              带我去
            </button>
          </div>

        </div>
      </motion.div>
    </>
  );
}

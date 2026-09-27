import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Check, Info, X, XCircle } from 'lucide-react';
import {
  ACTION_FEEDBACK_EVENT,
  type ActionFeedbackDetail,
  type ActionFeedbackTone,
} from '../../lib/actionFeedback';

type FeedbackItem = Required<Pick<ActionFeedbackDetail, 'id' | 'title' | 'tone' | 'durationMs'>> & Pick<ActionFeedbackDetail, 'description'>;

const toneIcon: Record<ActionFeedbackTone, typeof Check> = {
  success: Check,
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
};

export default function ActionFeedbackHost() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = (id: string) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setItems(current => current.filter(item => item.id !== id));
  };

  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<ActionFeedbackDetail>).detail;
      if (!detail?.title) return;
      const item: FeedbackItem = {
        id: detail.id || `feedback:${Date.now()}`,
        title: detail.title,
        description: detail.description,
        tone: detail.tone || 'success',
        durationMs: detail.durationMs ?? 4_200,
      };
      setItems(current => [...current.filter(entry => entry.id !== item.id), item].slice(-3));
      const timer = window.setTimeout(() => dismiss(item.id), item.durationMs);
      timers.current.set(item.id, timer);
    };
    window.addEventListener(ACTION_FEEDBACK_EVENT, handle);
    return () => {
      window.removeEventListener(ACTION_FEEDBACK_EVENT, handle);
      timers.current.forEach(timer => window.clearTimeout(timer));
      timers.current.clear();
    };
  }, []);

  return (
    <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed right-4 top-4 z-[320] flex w-[min(390px,calc(100vw-2rem))] flex-col gap-2">
      <AnimatePresence initial={false}>
        {items.map(item => {
          const Icon = toneIcon[item.tone];
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: 28, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 18, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              role={item.tone === 'error' ? 'alert' : 'status'}
              className={`action-feedback action-feedback--${item.tone} pointer-events-auto`}
            >
              <span className="action-feedback__icon"><Icon size={18} strokeWidth={3} /></span>
              <span className="min-w-0 flex-1">
                <strong className="block text-sm font-black text-[#10244a]">{item.title}</strong>
                {item.description && <span className="mt-1 block text-xs leading-5 text-slate-600">{item.description}</span>}
              </span>
              <button type="button" aria-label="关闭提示" onClick={() => dismiss(item.id)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-700"><X size={14} /></button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

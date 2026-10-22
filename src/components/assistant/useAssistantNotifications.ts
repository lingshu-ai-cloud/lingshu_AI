import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  PRIMARY_ASSISTANT_THREAD,
} from './globalAssistantRuntime';
import {
  shouldNotifyAssistant,
  useAssistantStore,
  type AssistantNotificationReason,
  type AssistantTaskCardInput,
  type OrbitAgentId,
} from '../../stores/assistantStore';
import type { AgentType } from '../../App';

const ASSISTANT_PRIMARY_ENTRY_SEEN_KEY = 'lingshu-assistant-primary-entry-seen-v1';

type AssistantPerformance = { phase: string; message?: string; reason: AssistantNotificationReason };
type AssistantSpeech = { id: number; message: string };

const PERFORMANCE_LINES: Record<string, string[]> = {
  script: ['我正在把卖点排成能拍的镜头，马上就好。', '好内容值得多想几秒，我先帮你把逻辑捋顺。', '别急，我正在检查每个镜头能不能真正执行。'],
  storyboard: ['分镜正在生成，请稍候。', '镜头衔接交给我，我会把节奏接顺。', '正在逐镜检查，避免成片时才发现问题。'],
  voice: ['正在逐句处理配音，不会漏掉后面的台词。', '我在给每句话找合适的停顿和节奏。', '配音还在生成，我陪你等一小会儿。'],
  material: ['我正在替每个分镜挑合适的素材。', '素材匹配中，先看动作，再看画面是否真的能用。', '稍等，我正在把重复镜头和不合适的素材筛掉。'],
  render: ['成片正在合成，我先替进度条加加油。', '最后几步通常最费功夫，马上就能看成片。', '正在把画面、字幕和声音稳稳地合在一起。'],
  default: ['任务正在处理中，我会一直在这里陪你。', '稍等一下，好结果正在路上。', '后台任务正在继续执行。'],
};

export function useAssistantNotifications(input: {
  mode: 'breathing' | 'chat';
  setMode: Dispatch<SetStateAction<'breathing' | 'chat'>>;
  primaryEntry: boolean;
  compactMode: boolean;
  focusTaskCard: (agentId: OrbitAgentId, taskId: string | null) => void;
  setUnreadCount: (agentId: OrbitAgentId, count: number) => void;
  upsertTaskCard: (agentId: OrbitAgentId, card: AssistantTaskCardInput) => void;
}) {
  const { mode, setMode, primaryEntry, compactMode, focusTaskCard, setUnreadCount, upsertTaskCard } = input;
  const [performance, setPerformance] = useState<AssistantPerformance | null>(null);
  const [performanceHidden, setPerformanceHidden] = useState(false);
  const [performanceLineIndex, setPerformanceLineIndex] = useState(0);
  const [speechBubble, setSpeechBubble] = useState<AssistantSpeech | null>(null);
  const speechTimerRef = useRef<number | null>(null);
  const performanceLines = PERFORMANCE_LINES[performance?.phase || 'default'] || PERFORMANCE_LINES.default;
  const performanceMessage = performance?.message || performanceLines[performanceLineIndex % performanceLines.length];

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        agentId?: OrbitAgentId;
        agent?: AgentType;
        card?: AssistantTaskCardInput;
      }>).detail;
      if (!detail?.card?.taskId) return;
      const targetAgent = PRIMARY_ASSISTANT_THREAD;
      upsertTaskCard(targetAgent, detail.card);
      if (!shouldNotifyAssistant(detail.card.notificationReason)) return;
      focusTaskCard(targetAgent, detail.card.taskId);
      const thread = useAssistantStore.getState().threads[targetAgent];
      setUnreadCount(targetAgent, thread.unreadCount + 1);
      setSpeechBubble({ id: Date.now(), message: detail.card.conclusion });
      if (mode !== 'chat') setMode('breathing');
    };
    window.addEventListener('lingshu-assistant-card', handler);
    return () => window.removeEventListener('lingshu-assistant-card', handler);
  }, [focusTaskCard, mode, setMode, setUnreadCount, upsertTaskCard]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        active?: boolean;
        phase?: string;
        message?: string;
        reason?: AssistantNotificationReason;
      }>).detail;
      if (!detail?.active) {
        setPerformance(null);
        setPerformanceHidden(false);
        setPerformanceLineIndex(0);
        return;
      }
      const reason = detail.reason ?? 'routine';
      if (!shouldNotifyAssistant(reason)) {
        setPerformance(null);
        setPerformanceHidden(false);
        setPerformanceLineIndex(0);
        return;
      }
      setPerformance({ phase: detail.phase || 'default', message: detail.message?.trim() || undefined, reason });
      setPerformanceHidden(false);
      setPerformanceLineIndex(0);
    };
    window.addEventListener('lingshu-assistant-performance', handler);
    return () => window.removeEventListener('lingshu-assistant-performance', handler);
  }, []);

  useEffect(() => {
    if (!performance || performance.message) return;
    const timer = window.setInterval(() => setPerformanceLineIndex(index => index + 1), 3_800);
    return () => window.clearInterval(timer);
  }, [performance]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        message?: string;
        durationMs?: number;
        reason?: AssistantNotificationReason;
      }>).detail;
      const message = detail?.message?.trim();
      if (!message) return;
      if (!shouldNotifyAssistant(detail.reason ?? 'routine')) return;
      if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);
      setSpeechBubble({ id: Date.now(), message });
      setMode('breathing');
      const durationMs = Math.max(2_500, Math.min(15_000, Number(detail.durationMs || 7_000)));
      speechTimerRef.current = window.setTimeout(() => setSpeechBubble(null), durationMs);
    };
    window.addEventListener('lingshu-assistant-say', handler);
    return () => {
      window.removeEventListener('lingshu-assistant-say', handler);
      if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);
    };
  }, [setMode]);

  useEffect(() => {
    if (!primaryEntry || compactMode) return;
    try {
      if (window.localStorage.getItem(ASSISTANT_PRIMARY_ENTRY_SEEN_KEY) === 'true') return;
      window.localStorage.setItem(ASSISTANT_PRIMARY_ENTRY_SEEN_KEY, 'true');
    } catch {
      // Storage is optional; the primary entry remains usable without it.
    }
    setSpeechBubble({ id: Date.now(), message: '告诉灵小枢你想完成什么，我会把目标变成计划并陪你推进。' });
    if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);
    speechTimerRef.current = window.setTimeout(() => setSpeechBubble(null), 12_000);
  }, [compactMode, primaryEntry]);

  return { performance, performanceHidden, setPerformanceHidden, performanceMessage, speechBubble, setSpeechBubble };
}

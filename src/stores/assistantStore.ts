import { create } from 'zustand';
import type { Message } from '../App';

export type OrbitAgentId = 'business' | 'director' | 'content' | 'customer';

export interface AgentThreadState {
  messages: Message[];
  draftInput: string;
  scrollPosition: number;
  unreadCount: number;
}

type AssistantStore = {
  threads: Record<OrbitAgentId, AgentThreadState>;
  setMessages: (agentId: OrbitAgentId, messages: Message[]) => void;
  setDraftInput: (agentId: OrbitAgentId, draftInput: string) => void;
  setScrollPosition: (agentId: OrbitAgentId, scrollPosition: number) => void;
  setUnreadCount: (agentId: OrbitAgentId, unreadCount: number) => void;
  hydrateThread: (agentId: OrbitAgentId, patch: Partial<AgentThreadState>) => void;
};

const emptyThread = (): AgentThreadState => ({
  messages: [],
  draftInput: '',
  scrollPosition: 0,
  unreadCount: 0,
});

export const ORBIT_AGENT_IDS: OrbitAgentId[] = ['business', 'director', 'content', 'customer'];

export const useAssistantStore = create<AssistantStore>((set) => ({
  threads: {
    business: emptyThread(),
    director: emptyThread(),
    content: emptyThread(),
    customer: emptyThread(),
  },
  setMessages: (agentId, messages) => set(state => ({
    threads: { ...state.threads, [agentId]: { ...state.threads[agentId], messages } },
  })),
  setDraftInput: (agentId, draftInput) => set(state => ({
    threads: { ...state.threads, [agentId]: { ...state.threads[agentId], draftInput } },
  })),
  setScrollPosition: (agentId, scrollPosition) => set(state => ({
    threads: { ...state.threads, [agentId]: { ...state.threads[agentId], scrollPosition } },
  })),
  setUnreadCount: (agentId, unreadCount) => set(state => ({
    threads: { ...state.threads, [agentId]: { ...state.threads[agentId], unreadCount } },
  })),
  hydrateThread: (agentId, patch) => set(state => ({
    threads: { ...state.threads, [agentId]: { ...state.threads[agentId], ...patch } },
  })),
}));

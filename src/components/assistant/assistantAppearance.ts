import type { AgentType } from '../../App';
import type { AssistantTodoItem } from './globalAssistantRuntime';

export const ASSISTANT_API_PATH: Record<AgentType, string> = {
  strategy: '/api/overseas/strategy/chat',
  traffic: '/api/overseas/agents/traffic/chat',
  conversion: '/api/overseas/agents/conversion/chat',
  retention: '/api/overseas/agents/retention/chat',
};

export function todoToneClass(tone: AssistantTodoItem['tone'], completed: boolean) {
  if (completed) return 'border-green/20 bg-green/5 text-green';
  if (tone === 'red') return 'border-red/20 bg-red/5 text-red';
  if (tone === 'amber') return 'border-amber/20 bg-amber-dim text-amber';
  if (tone === 'blue') return 'border-accent/20 bg-accent-glow text-accent';
  return 'border-border bg-surface text-text-secondary';
}

export function todoDotClass(tone: AssistantTodoItem['tone'], completed: boolean) {
  if (completed) return 'bg-green';
  if (tone === 'red') return 'bg-red';
  if (tone === 'amber') return 'bg-amber';
  if (tone === 'blue') return 'bg-accent';
  return 'bg-border-bright';
}

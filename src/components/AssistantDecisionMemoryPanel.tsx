import type { AssistantDecisionMemory } from '../lib/useAssistantDecisionMemory';

export function AssistantDecisionSaveButton({ memory, text }: { memory: AssistantDecisionMemory; text: string }) {
  return <button type="button" disabled={memory.busy} title="将这条用户原话确认为长期经营决策"
    onClick={() => void memory.request('save', text)}
    className="mt-2 block text-[11px] text-white/80 underline underline-offset-2 hover:text-white disabled:opacity-40"
  >确认并保存为经营决策</button>;
}

export default function AssistantDecisionMemoryPanel({ memory }: { memory: AssistantDecisionMemory }) {
  const { panelOpen, setPanelOpen, items, busy, listLoaded, feedback, request } = memory;
  return (
    <div className="shrink-0 border-b border-border px-4 py-2 text-xs">
      <button type="button" disabled={busy} className="font-semibold text-accent disabled:opacity-40" onClick={() => {
        setPanelOpen(previous => !previous);
        if (!panelOpen) void request('list');
      }}>{panelOpen ? '收起经营决策' : '查看经营决策'}</button>
      {panelOpen && (
        <div aria-busy={busy} className="mt-2 max-h-40 space-y-2 overflow-y-auto">
          <p className="text-text-muted">近期经营决策：仅保存你主动确认的原话；撤销后不再作为当前经营决策。</p>
          {busy && <p className="text-text-muted">正在处理...</p>}
          {listLoaded && !items.some(item => item.status !== 'revoked') && <p className="text-text-muted">本次返回范围内暂无有效经营决策</p>}
          {items.filter(item => item.status !== 'revoked').map(item => (
            <div key={item.id} className="rounded border border-border p-2">
              <p className="whitespace-pre-wrap text-text-secondary">{item.text}</p>
              <button type="button" disabled={busy} className="mt-1 text-text-muted hover:text-red disabled:opacity-40" onClick={() => void request('revoke', '', item)}>撤销决策</button>
            </div>
          ))}
        </div>
      )}
      {feedback && <p role="status" className="mt-1 text-text-secondary">{feedback}</p>}
    </div>
  );
}

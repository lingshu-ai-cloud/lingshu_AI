import { Button } from 'antd';
import {
  assistantDecisionSaveUnavailableReason,
  type AssistantDecisionMemory,
} from '../lib/useAssistantDecisionMemory';

export function AssistantDecisionSaveButton({ memory, text }: { memory: AssistantDecisionMemory; text: string }) {
  const unavailableReason = assistantDecisionSaveUnavailableReason(text);
  return (
    <span className="mt-1.5 flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <Button
        type="link"
        size="small"
        disabled={memory.busy || Boolean(unavailableReason)}
        title={unavailableReason || '将这条用户原话确认为长期经营决策'}
        onClick={() => void memory.request('save', text)}
        className="!h-auto !p-0 !text-[11px] !font-semibold !text-white/80 hover:!text-white disabled:!text-white/40"
      >保存为经营决策</Button>
      {unavailableReason && <span role="status" className="text-[10px] text-white/70">{unavailableReason}</span>}
    </span>
  );
}

export default function AssistantDecisionMemoryPanel({ memory }: { memory: AssistantDecisionMemory }) {
  const { panelOpen, setPanelOpen, items, busy, listLoaded, feedback, request } = memory;
  return (
    <section className="shrink-0 border-b border-border bg-surface px-4 py-2.5" aria-label="灵小枢对话记忆操作">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="ls-type-label-medium text-text-primary">对话记忆</p>
          <p className="ls-type-body-small truncate text-text-muted">只保存你主动确认的原话</p>
        </div>
        <Button type="text" size="small" disabled={busy} onClick={() => {
          setPanelOpen(previous => !previous);
          if (!panelOpen) void request('list');
        }}>{panelOpen ? '收起' : '查看已确认决策'}</Button>
      </div>
      {panelOpen && (
        <div aria-busy={busy} className="mt-2 max-h-44 space-y-2 overflow-y-auto rounded-md bg-surface-2 p-2.5">
          <p className="ls-type-body-small text-text-muted">撤销后，该内容不再作为当前经营决策。</p>
          {busy && <p className="ls-type-body-small text-text-muted">正在处理…</p>}
          {listLoaded && !items.some(item => item.status !== 'revoked') && <p className="ls-type-body-small text-text-muted">暂无已确认的经营决策</p>}
          {items.filter(item => item.status !== 'revoked').map(item => (
            <div key={item.id} className="rounded-md border border-border bg-surface p-2.5">
              <p className="ls-type-body-small whitespace-pre-wrap text-text-secondary">{item.text}</p>
              <Button danger type="link" size="small" disabled={busy} className="!mt-1 !h-auto !p-0" onClick={() => void request('revoke', '', item)}>撤销决策</Button>
            </div>
          ))}
        </div>
      )}
      {feedback && <p role="status" className="ls-type-body-small mt-1.5 text-text-secondary">{feedback}</p>}
    </section>
  );
}

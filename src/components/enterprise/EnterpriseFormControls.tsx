import { cloneElement, isValidElement, useId, type ComponentType, type ReactNode } from 'react';
import { Checkbox, Form, Pagination } from 'antd';

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return <Checkbox checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  return <Form.Item label={label} htmlFor={id} extra={hint} layout="vertical">
    {isValidElement<{ id?: string }>(children) ? cloneElement(children, { id }) : children}
  </Form.Item>;
}

export function PaginationControls({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (page: number) => void }) {
  if (total <= pageSize) return null;
  return <div className="mt-4 flex justify-end border-t border-border pt-3">
    <Pagination current={page} total={total} pageSize={pageSize} onChange={onChange} showSizeChanger={false} showTotal={count => `共 ${count} 条`} />
  </div>;
}

export function KnowledgeCard({
  icon: Icon,
  title,
  purpose,
  completed,
  stat,
  children,
  id,
  highlight,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  purpose: string;
  completed: boolean;
  stat?: string;
  children: ReactNode;
  id?: string;
  highlight?: boolean;
}) {
  return (
    <section id={id} className={`rounded-lg border border-border bg-white p-5 transition-all ${highlight ? 'ring-2 ring-accent/30' : ''}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-secondary">
            <Icon size={16} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${completed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {completed ? '已完成' : '未完成'}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{purpose}</p>
          </div>
        </div>
        {stat && <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-bold text-text-secondary">{stat}</span>}
      </div>
      {children}
    </section>
  );
}

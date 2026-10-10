import type { ReactNode } from 'react';

export function SectionTitle({ title, desc, noMargin }: { title: string; desc?: string; noMargin?: boolean }) {
  return <div className={noMargin ? '' : 'mb-4'}><h3 className="text-base font-bold text-text-primary font-display">{title}</h3>{desc && <p className="text-xs text-text-muted mt-0.5">{desc}</p>}</div>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><p className="text-xs font-semibold text-text-secondary mb-2">{label}</p>{children}</div>;
}
export function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border" style={active ? { background: 'var(--color-accent)', color: '#fff', borderColor: 'var(--color-accent)' } : { background: 'var(--color-surface)', color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' }}>{children}</button>;
}

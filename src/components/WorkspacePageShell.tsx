import type { ReactNode } from 'react';

export default function WorkspacePageShell({ icon, title, description, hideHeader = false, children }: { icon: ReactNode; title: string; description: string; hideHeader?: boolean; children: ReactNode }) {
  return <div className="workspace-management-page flex h-full flex-col bg-white">
    {!hideHeader && <header className="shrink-0 border-b border-border px-5 py-4 sm:px-6"><div className="mx-auto flex max-w-6xl items-start gap-3"><span className="mt-1 flex h-6 w-6 items-center justify-center text-accent">{icon}</span><div><h1 className="text-lg font-semibold text-text-primary">{title}</h1><p className="mt-1 text-xs leading-5 text-text-muted">{description}</p></div></div></header>}
    <main className="min-h-0 flex-1 overflow-y-auto bg-[#f8faf7] px-4 py-6 sm:px-6"><div className="mx-auto max-w-6xl">{children}</div></main>
  </div>;
}

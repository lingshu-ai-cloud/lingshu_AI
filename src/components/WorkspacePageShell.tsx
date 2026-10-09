import type { ReactNode } from 'react';
import LsPageHeader from './ui/LsPageHeader';

export default function WorkspacePageShell({ icon, title, description, hideHeader = false, children }: { icon: ReactNode; title: string; description: string; hideHeader?: boolean; children: ReactNode }) {
  return <div className="workspace-management-page flex h-full flex-col bg-white">
    {!hideHeader && <div className="shrink-0 px-4 pt-6 sm:px-6"><LsPageHeader title={title} description={description} className="!mb-0" /></div>}
    <main className="min-h-0 flex-1 overflow-y-auto bg-[#f8faf7] px-4 py-6 sm:px-6"><div className="mx-auto max-w-6xl">{children}</div></main>
  </div>;
}

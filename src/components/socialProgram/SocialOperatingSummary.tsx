import type { Page } from '../../pageRegistry';
import { useSocialProgram } from '../../contexts/SocialProgramContext';

/** Compact operating context inside the existing home, not a second workspace. */
export default function SocialOperatingSummary({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { available, activeProgram, accounts, loading, error } = useSocialProgram();
  if (!available) return <section aria-label="托管发布能力" className="shrink-0 border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-900">当前工作区尚未开放持续托管发布授权。可继续制作内容并交付发布包；连接账号不会自动启用无人值守发布。</section>;
  return (
    <section aria-label="社媒经营背景" className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-white px-5 py-3">
      <div className="text-sm"><strong>{activeProgram ? `${activeProgram.brandName} · ${activeProgram.market}` : '社媒经营'}</strong><span className="ml-3 text-text-muted">{loading ? '读取经营背景…' : activeProgram ? `${accounts.length} 个账号策略 · ${activeProgram.targetAudience}` : '从目标、灵感或成片开始，业务背景可随时补充'}</span>{error && <p role="status" className="text-xs text-amber-800">经营背景暂时不可用：{error}</p>}</div>
      <div className="flex gap-2"><button className="btn-ghost text-xs" onClick={() => onNavigate('socialInspiration')}>查看选题</button><button className="btn-ghost text-xs" onClick={() => onNavigate('traffic')}>查看发布</button></div>
    </section>
  );
}

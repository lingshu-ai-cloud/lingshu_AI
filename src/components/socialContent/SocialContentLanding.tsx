import {
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import type { SocialContentThemeId } from '../../../shared/contracts/socialContentWorkflow';
import SocialThemeCards from './SocialThemeCards';

export default function SocialContentLanding({ onStart }: { onStart: (themeId: SocialContentThemeId | '') => void }) {
  return (
    <>
      <header className="rounded-xl border border-border bg-white px-4 py-3.5 sm:px-5">
        <h1 className="flex items-start gap-2 text-sm font-black leading-6 text-text-primary sm:text-base">
          <Sparkles size={17} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <span>选好视频主题并上传素材，编导 Agent 会先定导演方案，再由内容 Agent 生成视频，你只需审核成品。</span>
        </h1>
      </header>

      <section aria-labelledby="social-theme-launcher-title" className="rounded-xl border border-border bg-white p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-muted">第一步</p><h2 id="social-theme-launcher-title" className="mt-1 text-lg font-black text-text-primary">这条视频想讲什么？</h2></div>
          <div className="flex items-center gap-2 text-[11px] font-bold text-text-muted"><span>选主题</span><ArrowRight size={12} /><span>补资料</span><ArrowRight size={12} /><span>确认生成</span></div>
        </div>
        <SocialThemeCards onSelect={onStart} />
      </section>
    </>
  );
}

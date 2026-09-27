import { ArrowRight, Check, Loader2, Sparkles, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { SOCIAL_CONTENT_STAGE_PROFILES, type SocialContentStageId } from '../../lib/socialContentStage';

export default function SocialContentStageOnboarding({ busy, onConfirm }: { busy?: boolean; onConfirm: (id: SocialContentStageId) => void | Promise<void> }) {
  const [selected, setSelected] = useState<SocialContentStageId | ''>('');
  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-[#15392f]/45 p-4 backdrop-blur-[2px]">
      <section role="dialog" aria-modal="true" aria-label="选择社媒经营阶段" className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-white/70 bg-[#fbfcfa] p-5 shadow-2xl sm:p-7">
        <div className="flex items-start gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800"><Sparkles size={21}/></span><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">首次使用 · 1 分钟设置</p><h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">先确定你的社媒经营阶段</h2><p className="mt-2 text-sm leading-6 text-slate-500">选择最接近当前情况的一项，我们会为你准备更合适的内容方向。</p></div></div>
        <div className="mt-6 grid gap-3 md:grid-cols-3">{SOCIAL_CONTENT_STAGE_PROFILES.map((profile)=>{const active=selected===profile.id;return <button type="button" key={profile.id} aria-pressed={active} onClick={()=>setSelected(profile.id)} className={`relative rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${active?'border-emerald-500 bg-emerald-50 shadow-sm':'border-slate-200 bg-white'}`}>
          <span className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border ${active?'border-emerald-700 bg-emerald-700 text-white':'border-slate-300 text-transparent'}`}><Check size={12}/></span>
          <TrendingUp size={18} className={active?'text-emerald-700':'text-slate-400'}/><h3 className="mt-5 pr-5 text-base font-black text-slate-950">{profile.name}</h3><p className="mt-3 text-xs leading-5 text-slate-600">{profile.description}</p>
        </button>})}</div>
        <div className="mt-6 flex justify-end"><button type="button" disabled={!selected||busy} onClick={()=>selected&&void onConfirm(selected)} className="inline-flex items-center gap-2 rounded-xl bg-[#173d31] px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300">{busy?<Loader2 size={16} className="animate-spin"/>:<ArrowRight size={16}/>}保存并进入内容制作</button></div>
      </section>
    </div>
  );
}

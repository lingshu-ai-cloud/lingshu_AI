import { useState, type ComponentType } from 'react';
import {
  ArrowRight,
  Check,
  Link2,
  PackageOpen,
  Scissors,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Upload,
} from 'lucide-react';
import type {
  SocialContentCreationPath,
  SocialContentMaterialInput,
} from '../../lib/socialContentModel';

export interface SocialContentLaunchOptions {
  creationPath: SocialContentCreationPath;
  materialInput: SocialContentMaterialInput;
  managedMode: 'one_click_managed';
}

interface CreationPathCard {
  id: SocialContentCreationPath;
  title: string;
  description: string;
  result: string;
  icon: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  tint: string;
}

const CREATION_PATHS: CreationPathCard[] = [
  {
    id: 'material_processing',
    title: '素材加工',
    description: '把你现有的视频、图片或商品信息，加工成口播、字幕、特效完整的成片。',
    result: '适合：有自己的产品或品牌内容，想直接做成高质量视频',
    icon: Scissors,
    tint: 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-[#e8f4ed]',
  },
  {
    id: 'viral_replication',
    title: '爆款裂变',
    description: '提供一条参考视频，系统逐镜分析前三秒、节奏和结构，再换成你的产品重新制作。',
    result: '适合：已经看到想参考的爆款，希望快速做出自己的版本',
    icon: TrendingUp,
    tint: 'border-amber-200 bg-gradient-to-br from-amber-50 via-white to-[#f7eadb]',
  },
];

const MATERIAL_INPUTS: Array<{
  id: SocialContentMaterialInput;
  title: string;
  description: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}> = [
  { id: 'ready', title: '有视频或图片', description: '上传原始素材，系统负责选镜、口播、字幕和剪辑', icon: Upload },
  { id: 'limited', title: '只有商品链接或一张图', description: '系统保护商品真实信息，并补齐可生成的画面', icon: Link2 },
  { id: 'none', title: '完全没素材', description: '不用找人拍摄，系统改用数字人、合规素材和生成画面', icon: PackageOpen },
];

export default function SocialContentLanding({ onStart }: { onStart: (options: SocialContentLaunchOptions) => void }) {
  const [creationPath, setCreationPath] = useState<SocialContentCreationPath | null>(null);
  const [materialInput, setMaterialInput] = useState<SocialContentMaterialInput>('none');

  return (
    <>
      <header className="rounded-xl border border-border bg-white px-4 py-4 sm:px-5">
        <h1 className="flex items-start gap-2 text-sm font-black leading-6 text-text-primary sm:text-base">
          <Sparkles size={17} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <span>不会拍、不会剪也能做视频。选择一种制作方式，剩下的交给编导 Agent 和内容 Agent。</span>
        </h1>
        <p className="mt-2 pl-6 text-xs leading-5 text-text-muted">默认使用一键托管：系统准备脚本、画面、口播、字幕和剪辑，你只需确认关键信息并审核成片。</p>
      </header>

      <section aria-labelledby="social-creation-path-title" className="rounded-xl border border-border bg-white p-4 sm:p-5">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-muted">第一步</p>
          <h2 id="social-creation-path-title" className="mt-1 text-lg font-black text-text-primary">你想怎么制作？</h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {CREATION_PATHS.map(path => {
            const Icon = path.icon;
            const active = creationPath === path.id;
            return (
              <button
                key={path.id}
                type="button"
                aria-pressed={active}
                onClick={() => setCreationPath(path.id)}
                className={`relative rounded-xl border p-5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${path.tint} ${active ? 'shadow-[0_0_0_2px_var(--color-accent),0_12px_30px_rgba(17,127,81,0.12)]' : 'hover:-translate-y-0.5 hover:shadow-md'}`}
              >
                <span className="flex items-start gap-4">
                  <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-accent text-white' : 'bg-white text-text-secondary shadow-sm'}`}><Icon size={22} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2"><strong className="text-base font-black text-text-primary">{path.title}</strong>{active && <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white"><Check size={13} strokeWidth={3} /></span>}</span>
                    <span className="mt-2 block text-xs leading-5 text-text-secondary">{path.description}</span>
                    <span className="mt-3 block text-[10px] font-semibold leading-4 text-text-muted">{path.result}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {creationPath && (
          <div className="mt-6 border-t border-border pt-5">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-muted">第二步</p>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
              <div><h3 className="text-base font-black text-text-primary">你手头有什么？</h3><p className="mt-1 text-[11px] text-text-muted">没有素材也可以开始，系统不会反复要求你补拍。</p></div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-black text-emerald-800"><ShieldCheck size={13} />默认一键托管</span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {MATERIAL_INPUTS.map(option => {
                const Icon = option.icon;
                const active = materialInput === option.id;
                return (
                  <button key={option.id} type="button" aria-pressed={active} onClick={() => setMaterialInput(option.id)} className={`flex min-h-24 items-start gap-3 rounded-xl border p-3 text-left transition ${active ? 'border-accent bg-accent-glow shadow-[0_0_0_1px_var(--color-accent)]' : 'border-border bg-white hover:border-border-bright'}`}>
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-accent text-white' : 'bg-surface-2 text-text-muted'}`}><Icon size={17} /></span>
                    <span><strong className="block text-xs font-black text-text-primary">{option.title}</strong><span className="mt-1 block text-[10px] leading-4 text-text-muted">{option.description}</span></span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => onStart({ creationPath, materialInput, managedMode: 'one_click_managed' })} className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 text-xs font-black text-white shadow-sm hover:bg-accent-dim">一键托管生成<ArrowRight size={15} /></button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

import { Scissors, TrendingUp, X, type LucideIcon } from 'lucide-react';
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
  icon: LucideIcon;
  tint: string;
  iconTint: string;
}

const CREATION_PATHS: CreationPathCard[] = [
  {
    id: 'material_processing',
    title: '自由创作',
    description: '系统从“我的素材”和企业中心自动组织内容，你只需选择要宣传的产品。',
    icon: Scissors,
    tint: 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-[#e8f4ed] hover:border-emerald-300',
    iconTint: 'text-emerald-800',
  },
  {
    id: 'viral_replication',
    title: '爆款裂变',
    description: '沿用爆款口播与结构，仅替换企业、品牌和产品名称，再自动匹配制作。',
    icon: TrendingUp,
    tint: 'border-orange-200 bg-gradient-to-br from-orange-50 via-white to-[#f7eadb] hover:border-orange-300',
    iconTint: 'text-orange-800',
  },
];

export default function SocialContentLanding({
  onStart,
  onClose = () => {},
}: {
  onStart: (options: SocialContentLaunchOptions) => void;
  onClose?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[175] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="social-creation-path-title" className="w-full max-w-5xl rounded-2xl border border-white/80 bg-white p-5 shadow-[0_30px_90px_rgba(15,36,29,0.22)] sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-black tracking-[0.12em] text-text-muted">第一步</p>
            <h2 id="social-creation-path-title" className="mt-2 text-2xl font-black text-[#173d31]">你想怎么制作？</h2>
            <p className="mt-2 text-xs leading-5 text-text-muted">选择一种方式，进入逐句口播与画面制作台。</p>
          </div>
          <button type="button" aria-label="收起制作方式" title="收起" onClick={onClose} className="rounded-xl p-2 text-text-muted hover:bg-surface-2 hover:text-text-primary"><X size={19} /></button>
        </div>

        <div className="mt-7 grid gap-4 md:grid-cols-2">
          {CREATION_PATHS.map(path => {
            const Icon = path.icon;
            return (
              <button
                key={path.id}
                type="button"
                onClick={() => onStart({ creationPath: path.id, materialInput: path.id === 'viral_replication' ? 'ready' : 'none', managedMode: 'one_click_managed' })}
                className={`group rounded-2xl border p-6 text-left transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 ${path.tint}`}
              >
                <span className="flex items-start gap-5">
                  <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm ${path.iconTint}`}><Icon size={25} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2"><strong className="text-xl font-black text-[#173d31]">{path.title}</strong><span className="text-lg text-text-muted transition group-hover:translate-x-1">→</span></span>
                    <span className="mt-3 block text-sm leading-6 text-text-secondary">{path.description}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

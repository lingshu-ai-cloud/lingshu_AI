import type { ComponentType } from 'react';
import {
  ArrowUpRight,
  Boxes,
  Check,
  Factory,
  PackageSearch,
  PenLine,
  Route,
  ScanSearch,
  TrendingUp,
} from 'lucide-react';
import type { SocialContentThemeId } from '../../../shared/contracts/socialContentWorkflow';
import { SOCIAL_THEME_OPTIONS } from './socialContentUi';

type ThemeSelection = SocialContentThemeId | '';

interface ThemeVisual {
  icon: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  eyebrow: string;
  example: string;
  tint: string;
  iconStyle: string;
  chips: readonly string[];
}

const THEME_VISUALS: Record<SocialContentThemeId, ThemeVisual> = {
  product_value: {
    icon: PackageSearch,
    eyebrow: '产品介绍',
    example: '拍细节、演示用法，讲清产品优势',
    tint: 'from-[#e4f3ea] via-[#f3f8f4] to-[#dcece4]',
    iconStyle: 'bg-[#173d31] text-white',
    chips: ['细节', '演示', '证据'],
  },
  scenario_solution: {
    icon: ScanSearch,
    eyebrow: '使用演示',
    example: '拍真实使用过程，让客户看懂怎么用',
    tint: 'from-[#fcebdc] via-[#fff7ef] to-[#f3dfcf]',
    iconStyle: 'bg-[#a45a3b] text-white',
    chips: ['场景', '痛点', '结果'],
  },
  supplier_capability: {
    icon: Factory,
    eyebrow: '工厂展示',
    example: '拍车间、设备和质检，展示生产实力',
    tint: 'from-[#e4ecef] via-[#f5f8f8] to-[#dce6e8]',
    iconStyle: 'bg-[#315b63] text-white',
    chips: ['团队', '流程', '质检'],
  },
  customization_process: {
    icon: Route,
    eyebrow: '合作流程',
    example: '讲清从沟通、打样到生产交付的步骤',
    tint: 'from-[#eee8f5] via-[#faf8fc] to-[#e5dced]',
    iconStyle: 'bg-[#665079] text-white',
    chips: ['需求', '打样', '交付'],
  },
  customer_case: {
    icon: TrendingUp,
    eyebrow: '合作案例',
    example: '展示真实成品和合作结果，增加信任',
    tint: 'from-[#e6eee1] via-[#f7faf4] to-[#dce8d5]',
    iconStyle: 'bg-[#42613a] text-white',
    chips: ['问题', '方案', '成果'],
  },
};

interface SocialThemeCardsProps {
  selected?: ThemeSelection;
  onSelect: (themeId: ThemeSelection) => void;
  compact?: boolean;
  includeCustom?: boolean;
}

export default function SocialThemeCards({
  selected,
  onSelect,
  compact = false,
  includeCustom = false,
}: SocialThemeCardsProps) {
  return (
    <div className={compact ? 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3' : 'grid gap-3 sm:grid-cols-2 xl:grid-cols-5'}>
      {SOCIAL_THEME_OPTIONS.map(theme => {
        const visual = THEME_VISUALS[theme.id];
        const Icon = visual.icon;
        const active = selected === theme.id;
        return (
          <button
            key={theme.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(theme.id)}
            className={`group relative overflow-hidden border bg-white text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${compact ? 'min-h-24 rounded-lg p-3' : 'rounded-xl'} ${active ? 'border-accent shadow-[0_0_0_1px_var(--color-accent),0_10px_24px_rgba(17,127,81,0.10)]' : 'border-border hover:-translate-y-0.5 hover:border-border-bright hover:shadow-[0_10px_24px_rgba(23,61,49,0.08)]'}`}
          >
            {compact ? (
              <div className="flex h-full items-start gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${visual.iconStyle}`}><Icon size={19} strokeWidth={1.8} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <strong className="text-xs font-black text-text-primary">{theme.title}</strong>
                    {active && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-white"><Check size={11} strokeWidth={3} /></span>}
                  </span>
                  <span className="mt-1 block text-[10px] leading-4 text-text-muted">{visual.example}</span>
                </span>
              </div>
            ) : (
              <>
                <span className={`relative block h-28 overflow-hidden bg-gradient-to-br ${visual.tint}`}>
                  <span className="absolute -right-7 -top-7 h-24 w-24 rounded-full border border-white/70 bg-white/30" />
                  <span className="absolute bottom-3 left-3 flex gap-1.5">
                    {visual.chips.map(chip => <span key={chip} className="rounded-md border border-white/70 bg-white/75 px-2 py-1 text-[9px] font-black text-text-secondary backdrop-blur">{chip}</span>)}
                  </span>
                  <span className={`absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-xl shadow-sm ${visual.iconStyle}`}><Icon size={21} strokeWidth={1.8} /></span>
                </span>
                <span className="block p-4">
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-muted">{visual.eyebrow}</span>
                    {active ? <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white"><Check size={11} strokeWidth={3} /></span> : <ArrowUpRight size={14} className="text-text-muted transition group-hover:text-accent" />}
                  </span>
                  <strong className="mt-2 block text-sm font-black text-text-primary">{theme.title}</strong>
                  <span className="mt-1 block text-[11px] leading-5 text-text-muted">{visual.example}</span>
                </span>
              </>
            )}
          </button>
        );
      })}

      {includeCustom && (
        <button
          type="button"
          aria-pressed={selected === ''}
          onClick={() => onSelect('')}
          className={`relative min-h-24 rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${selected === '' ? 'border-accent bg-accent-glow shadow-[0_0_0_1px_var(--color-accent)]' : 'border-dashed border-border-bright bg-surface-2/60 hover:border-accent/50'}`}
        >
          <span className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-text-secondary"><PenLine size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-start justify-between gap-2"><strong className="text-xs font-black text-text-primary">自定义主题</strong>{selected === '' && <Check size={14} className="text-accent" strokeWidth={3} />}</span>
              <span className="mt-1 block text-[10px] leading-4 text-text-muted">没有合适选项时，写下你想讲的内容</span>
            </span>
          </span>
          <Boxes size={42} className="pointer-events-none absolute -bottom-2 -right-1 text-border/50" strokeWidth={1.2} />
        </button>
      )}
    </div>
  );
}

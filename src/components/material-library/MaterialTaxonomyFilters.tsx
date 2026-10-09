import { Cloud, Images, Sparkles, Upload } from 'lucide-react';
import { MATERIAL_SOURCE_LABELS, MATERIAL_THEME_LABELS, type MaterialSourceCategory, type MaterialTheme } from '../../../shared/materialTaxonomy';

export type MaterialSourceFilter = 'all' | MaterialSourceCategory;
export type MaterialThemeFilter = 'all' | MaterialTheme;

export default function MaterialTaxonomyFilters(props: {
  source: MaterialSourceFilter;
  theme: MaterialThemeFilter;
  total: number;
  sourceCounts: Record<MaterialSourceCategory, number>;
  onSourceChange: (value: MaterialSourceFilter) => void;
  onThemeChange: (value: MaterialThemeFilter) => void;
}) {
  const sources = [
    { id: 'all' as const, label: '全部素材', icon: Images, count: props.total },
    ...Object.entries(MATERIAL_SOURCE_LABELS).map(([id, label]) => ({
      id: id as MaterialSourceCategory,
      label,
      icon: id === 'local_upload' ? Upload : id === 'official_import' ? Cloud : Sparkles,
      count: props.sourceCounts[id as MaterialSourceCategory] || 0,
    })),
  ];
  return <>
    <div className="flex flex-wrap items-center gap-2" aria-label="素材来源">
      {sources.map(item => { const Icon = item.icon; const active = props.source === item.id; return <button key={item.id} type="button" onClick={() => props.onSourceChange(item.id)} aria-pressed={active} className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-black transition ${active ? 'border-accent bg-accent text-white' : 'border-border bg-white text-text-secondary hover:border-accent hover:text-accent'}`}><Icon size={14}/>{item.label}<span className={`rounded-full px-1.5 py-0.5 text-[9px] ${active ? 'bg-white/20' : 'bg-surface-2'}`}>{item.count}</span></button>; })}
    </div>
    <div className="flex flex-wrap items-center gap-2" aria-label="主题标签">
      <span className="mr-1 text-xs font-bold text-text-muted">主题标签</span>
      <button type="button" onClick={() => props.onThemeChange('all')} aria-pressed={props.theme === 'all'} className={`rounded-full px-3 py-1.5 text-xs font-bold ${props.theme === 'all' ? 'bg-text-primary text-white' : 'bg-surface-2 text-text-secondary'}`}>全部</button>
      {Object.entries(MATERIAL_THEME_LABELS).map(([id, label]) => <button key={id} type="button" onClick={() => props.onThemeChange(id as MaterialTheme)} aria-pressed={props.theme === id} className={`rounded-full px-3 py-1.5 text-xs font-bold ${props.theme === id ? 'bg-text-primary text-white' : 'bg-surface-2 text-text-secondary'}`}>{label}</button>)}
    </div>
  </>;
}

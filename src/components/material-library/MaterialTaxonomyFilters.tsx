import { Select } from 'antd';
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
    { id: 'all' as const, label: '全部素材', count: props.total },
    ...Object.entries(MATERIAL_SOURCE_LABELS).map(([id, label]) => ({
      id: id as MaterialSourceCategory,
      label,
      count: props.sourceCounts[id as MaterialSourceCategory] || 0,
    })),
  ];
  return <>
    <Select
      aria-label="素材来源"
      className="w-44 shrink-0"
      value={props.source}
      onChange={value => props.onSourceChange(value as MaterialSourceFilter)}
      options={sources.map(item => ({ value: item.id, label: `${item.label} · ${item.count}` }))}
    />
    <Select
      aria-label="主题标签"
      className="w-36 shrink-0"
      value={props.theme}
      onChange={value => props.onThemeChange(value as MaterialThemeFilter)}
      options={[
        { value: 'all', label: '全部主题' },
        ...Object.entries(MATERIAL_THEME_LABELS).map(([value, label]) => ({ value, label })),
      ]}
    />
  </>;
}

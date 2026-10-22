import { Button, Drawer } from 'antd';
import { Music2 } from 'lucide-react';
import type { Material } from '../../lib/studioApi';
import { displayDuration } from '../../lib/inspirationDataQuality';
import { generatedMaterialOriginLabel } from '../../lib/materialAssetOwnership';
import { MATERIAL_THEME_LABELS, materialPrimaryThemeOf } from '../../../shared/materialTaxonomy';
import { canCreateFromLibraryMaterial, materialAssetBadge, materialDirectorUi, materialSemanticLabel, visibleMaterialTags } from './inspirationMaterialLibrary';
import { MaterialUsagePanel } from './MaterialUsageHistory';

export default function InspirationMaterialDetailDrawer({ material, updatingTheme, onClose, onUpdateTheme, onCreate }: {
  material: Material;
  updatingTheme: boolean;
  onClose: () => void;
  onUpdateTheme: (theme: keyof typeof MATERIAL_THEME_LABELS) => void;
  onCreate: (material: Material) => void;
}) {
  const theme = materialPrimaryThemeOf(material);
  const director = materialDirectorUi(material);
  const badge = materialAssetBadge(material);
  const canCreate = canCreateFromLibraryMaterial(material);
  return <Drawer open title={material.name} size={800} onClose={onClose} styles={{ body: { padding: 0 } }}>
    <section className="border-b border-border bg-surface-2 px-5 py-4" aria-label="素材标签">
      <p className="text-xs font-semibold text-text-primary">素材标签</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="rounded-md border border-border bg-white px-2 py-1 text-xs font-semibold text-text-secondary">{badge.label}</span>
        <span className={`rounded-md border border-border px-2 py-1 text-xs font-semibold ${theme ? 'bg-accent-glow text-accent' : 'bg-white text-text-secondary'}`}>{theme ? MATERIAL_THEME_LABELS[theme] : '主题待识别'}</span>
        {visibleMaterialTags(material.tags).split(/[,，]/).map(tag => tag.trim()).filter(Boolean).map(tag => <span key={`detail-tag-${tag}`} className="rounded-md border border-border bg-white px-2 py-1 text-xs font-semibold text-text-secondary">{tag}</span>)}
      </div>
    </section>
    <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1.2fr)_minmax(240px,0.8fr)]">
      <div className="overflow-hidden rounded-lg border border-border bg-black">
        {material.type === 'video' ? <video src={material.url} poster={material.poster} controls playsInline preload="metadata" className="aspect-video h-full max-h-[54vh] w-full object-contain" />
          : material.type === 'image' ? <img src={material.poster || material.url} alt={material.name} className="max-h-[54vh] w-full object-contain" />
          : <div className="flex min-h-44 flex-col items-center justify-center gap-4 bg-surface-2 p-6"><Music2 size={28} className="text-text-muted" /><audio src={material.url} controls className="w-full" /></div>}
      </div>
      <div className="space-y-3 text-xs">
        <div className="rounded-xl border border-accent/20 bg-accent-glow px-3 py-3">
          <div className="flex items-center justify-between gap-2"><p className="font-bold text-text-primary">编导 Agent 识别</p><span className="text-[10px] font-bold text-accent">{director.status}</span></div>
          <p className="mt-2 font-semibold text-text-primary">{director.role} · {director.content}</p>
          {director.uses.length > 0 && <p className="mt-1 leading-5 text-text-secondary">可用于：{director.uses.join('、')}</p>}
          {director.cautions.length > 0 && <p className="mt-1 leading-5 text-text-muted">注意：{director.cautions.join('；')}</p>}
        </div>
        <div className="rounded-xl border border-border bg-surface px-3 py-2.5"><p className="text-[10px] font-bold text-text-muted">主题标签</p><div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(MATERIAL_THEME_LABELS).map(([id, label]) => <button type="button" key={id} disabled={updatingTheme} onClick={() => onUpdateTheme(id as keyof typeof MATERIAL_THEME_LABELS)} className={`rounded-full px-2.5 py-1 text-[11px] font-bold disabled:opacity-50 ${theme === id ? 'bg-accent text-white' : 'bg-surface-2 text-text-secondary'}`}>{label}</button>)}</div></div>
        {[
          ['素材类型', material.type === 'video' ? '视频' : material.type === 'image' ? '图片' : '音频'],
          ['关联产品', material.productName || '企业通用素材'],
          ['主要内容', materialSemanticLabel(material)],
          ['素材来源', generatedMaterialOriginLabel(material) || material.sourceName || material.sourceProvider || (material.scope === 'shared' ? '共享素材' : '我的素材')],
          ['时长', material.type === 'video' || material.type === 'audio' ? displayDuration(material.duration) : '—'],
          ['入库时间', material.createdAt ? new Date(material.createdAt).toLocaleString('zh-CN') : '—'],
        ].map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-surface px-3 py-2.5"><p className="text-[10px] font-bold text-text-muted">{label}</p><p className="mt-1 break-words font-bold leading-5 text-text-primary">{value}</p></div>)}
        <Button type="primary" block onClick={() => onCreate(material)} disabled={!canCreate}>{material.type === 'image' ? '用此图制作图片' : '自由创作'}</Button>
      </div>
    </div>
    <MaterialUsagePanel material={material} />
  </Drawer>;
}

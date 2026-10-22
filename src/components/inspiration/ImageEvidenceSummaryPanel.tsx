import type { VideoAnalysisPayload } from '../../lib/inspirationTypes';

type ImageEvidence = NonNullable<VideoAnalysisPayload['imageEvidence']>;

/** The selected image record's visual evidence, not a generic video script sidebar. */
export default function ImageEvidenceSummaryPanel({ evidence }: { evidence: ImageEvidence }) {
  const blueprints = evidence.layerBlueprints ?? [];
  return <div className="mt-4 space-y-4">
    <section className="rounded-lg border border-border bg-white p-4">
      <h3 className="text-sm font-semibold text-text-primary">图文证据与轮播节奏</h3>
      <div className="mt-3 space-y-2">
        {evidence.carouselFlow.map(item => <div key={`${item.imageIndex}-${item.role}`} className="rounded-lg bg-surface-2 px-3 py-2 text-xs leading-5"><strong className="text-text-primary">第 {item.imageIndex} 张 · {item.role}</strong><p className="text-text-secondary">{item.evidence}</p></div>)}
      </div>
    </section>
    <section className="rounded-lg border border-border bg-white p-4">
      <h3 className="text-sm font-semibold text-text-primary">可复用模块</h3>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{evidence.reusableModules.map(item => <div key={item.module} className="rounded-lg border border-border p-3 text-xs"><strong>{item.module}</strong><p className="mt-1 leading-5 text-text-secondary">保留：{item.preserve}</p><p className="leading-5 text-text-muted">替换：{item.replace}</p></div>)}</div>
    </section>
    {blueprints.length > 0 && <section className="space-y-2 rounded-lg border border-border bg-surface-2 p-3" aria-label="遮罩与图层生产蓝图">
      <h3 className="text-sm font-semibold text-text-primary">遮罩与图层生产蓝图</h3>
      {blueprints.map(blueprint => <div key={blueprint.imageIndex} className="rounded-lg bg-white p-2.5">
        <p className="text-xs font-semibold text-text-secondary">第 {blueprint.imageIndex} 张 · 由后到前</p>
        <p className="mt-1 text-xs leading-5 text-text-secondary">{blueprint.layers.slice().sort((a, b) => a.zIndex - b.zIndex).map(layer => layer.role).join(' → ') || '未识别层级'}</p>
        {blueprint.masks.map(mask => <p key={mask.id} className="mt-1 text-xs leading-5 text-text-muted">遮罩 {mask.shape} · 透明度 {Math.round(mask.opacity * 100)}% · 层级 {mask.zIndex}</p>)}
      </div>)}
    </section>}
  </div>;
}

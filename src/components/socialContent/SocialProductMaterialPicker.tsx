import { Alert, Button, Checkbox, Spin } from 'antd';
import type { EnterpriseProductOption } from './socialCreationDraft';
import type { useSocialProductMaterials } from './useSocialProductMaterials';

type Selection = ReturnType<typeof useSocialProductMaterials>;
export function SocialProductMaterialPicker({ selection, products, disabled = false }: {
  selection: Selection; products: EnterpriseProductOption[]; disabled?: boolean;
}) {
  if (!products.length) return null;
  return <section aria-label="所选产品素材" className="rounded-lg border border-border bg-white p-3">
    <p className="text-xs font-semibold text-text-primary">产品素材 · 已选 {selection.selectedIds.length} 项</p>
    <p className="mt-1 text-[10px] leading-4 text-text-muted">来自当前企业「我的素材」，按所选产品默认勾选，可取消或重新选择。</p>
    {selection.loading ? <div className="mt-3"><Spin size="small" /> <span className="text-xs">读取产品素材…</span></div>
      : selection.error ? <Alert className="mt-2" type="warning" title="产品素材暂时无法读取" description={selection.error} action={<Button size="small" onClick={selection.retry}>重试</Button>} />
        : products.map(product => {
          const materials = selection.candidates.filter(item => item.productId === product.id);
          return <div key={product.id} className="mt-3"><p className="text-[10px] font-semibold text-text-secondary">{product.name} · {materials.length} 项</p>
            {!materials.length ? <p className="mt-1 text-[10px] text-text-muted">暂无可用产品图片或视频，请到「我的素材」关联此产品。</p>
              : <div className="mt-2 space-y-2">{materials.map(item => <div key={item.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                <Checkbox aria-label={`选用素材 ${item.name}`} checked={selection.selectedIds.includes(item.id)} disabled={disabled} onChange={() => selection.toggle(item.id)} />
                <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-surface-2 text-[9px] text-text-muted">{item.type === 'video' ? '视频' : '图片'}{(item.poster || (item.type === 'image' && item.url)) && <img src={item.poster || item.url} alt="" className="absolute inset-0 h-full w-full object-contain" onError={event => { event.currentTarget.style.display = 'none'; }} />}</span>
                <span className="min-w-0 flex-1 text-[10px] text-text-primary">{item.name}<span className="block text-text-muted">{item.type === 'video' ? '视频' : '图片'}</span></span>
              </div>)}</div>}
          </div>;
        })}
  </section>;
}

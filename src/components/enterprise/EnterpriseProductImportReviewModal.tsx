import { Button, Modal } from 'antd';
import type { PendingProductImport } from './enterpriseProductImportPreparation';

interface Props {
  pending: PendingProductImport;
  confirming: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  onRemoveProduct: (index: number) => void;
}

export default function EnterpriseProductImportReviewModal({ pending, confirming, onClose, onConfirm, onRemoveProduct }: Props) {
  return (
    <Modal open title="确认产品导入结果" width={840} onCancel={onClose} mask={{ closable: false }}
      keyboard={!confirming} closable={!confirming}
      styles={{ body: { maxHeight: '65vh', overflowY: 'auto' } }}
      footer={<div className="flex flex-wrap items-center justify-between gap-3 text-left">
        <span className="text-xs text-text-secondary">{pending.skippedRows ? `${pending.skippedRows} 行因缺少产品名称或 SKU 将被跳过` : '未发现需要跳过的空行'}</span>
        <div className="flex gap-2"><Button disabled={confirming} onClick={onClose}>取消</Button><Button type="primary" disabled={!pending.products.length} loading={confirming} onClick={() => void onConfirm()}>{confirming ? '正在保存图片…' : `确认导入 ${pending.products.length} 个产品`}</Button></div>
      </div>}>
      <p className="mb-4 text-sm text-text-secondary">{pending.fileName} · {pending.sourceLabel} · 识别 {pending.products.length}/{pending.totalRows} 行</p>
        <div>
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">请核对产品名称、SKU、模型提取字段与图片归属。PDF / DOCX 的内容来自文档文本或表格提取，必须由用户复核后才会写入。</p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead className="bg-surface-2 text-text-muted"><tr><th className="px-3 py-2">图片</th><th className="px-3 py-2">产品名称</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2">品牌 / 规格</th><th className="px-3 py-2">识别卖点</th><th className="w-16 px-3 py-2">操作</th></tr></thead>
              <tbody className="divide-y divide-border">
                {pending.products.map((product, index) => { const transfer = pending.remoteImageTransfers[index]; return <tr key={`${product.sku || product.name}-${index}`}>
                  <td className="px-3 py-2"><div className="relative w-fit">{(pending.assignedImages.find(image => image.productIndex === index)?.url || product.imageUrl) ? <img src={pending.assignedImages.find(image => image.productIndex === index)?.url || product.imageUrl} alt="" className="h-12 w-12 rounded-lg border border-border object-cover" onError={event => { event.currentTarget.style.display = 'none'; }} /> : <span className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-surface-2 text-[10px] text-text-muted">无图片</span>}{transfer && <span title={transfer.error || transfer.originalUrl} className={`absolute -bottom-1 -right-2 rounded px-1 py-0.5 text-[8px] font-semibold text-white ${transfer.status === 'uploaded' ? 'bg-emerald-600' : transfer.status === 'failed' ? 'bg-red-600' : transfer.status === 'uploading' ? 'bg-slate-800' : 'bg-amber-600'}`}>{transfer.status === 'uploaded' ? '已转存' : transfer.status === 'failed' ? '转存失败' : transfer.status === 'uploading' ? '转存中' : '待转存'}</span>}</div>{transfer?.error && <p className="mt-2 max-w-32 text-[9px] leading-4 text-red-600">{transfer.error}</p>}</td>
                  <td className="px-3 py-2 font-bold text-text-primary">{product.name}</td>
                  <td className="px-3 py-2 text-text-secondary">{product.sku || '—'}</td>
                  <td className="px-3 py-2 text-text-secondary">{[product.brand, product.color, product.size].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="max-w-56 px-3 py-2 text-text-secondary"><span className="line-clamp-2">{product.highlights || '—'}</span></td>
                  <td className="px-3 py-2"><button type="button" disabled={confirming} onClick={() => onRemoveProduct(index)} className="text-[11px] font-bold text-red-600 hover:text-red-800 disabled:opacity-50">移除</button></td>
                </tr>;})}
              </tbody>
            </table>
          </div>
          {pending.assignedImages.length > 0 && <p className="mt-3 text-xs text-emerald-700">已识别并待绑定 {pending.assignedImages.length} 张 PDF 产品照片，请核对商品名称后确认导入。</p>}
          {pending.unassignedImages.length > 0 && <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3"><p className="text-xs font-semibold text-sky-900">未归属图片（{pending.unassignedImages.length}）</p><p className="mt-1 text-[11px] leading-5 text-sky-800">文档没有提供可验证的图片与产品对应关系，因此不会静默绑定。确认导入时会把这些图片持久化到“企业上传素材”，随后可手动关联产品。</p><div className="mt-3 flex flex-wrap gap-2">{pending.unassignedImages.map(image => <figure key={image.name} className="w-24"><div className="relative"><img src={image.url} alt={image.name} className="h-20 w-24 rounded-lg border border-sky-200 bg-white object-cover"/>{image.status && image.status !== 'pending' && <span className={`absolute bottom-1 right-1 rounded px-1.5 py-0.5 text-[9px] font-semibold ${image.status === 'uploaded' ? 'bg-emerald-600 text-white' : image.status === 'failed' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'}`}>{image.status === 'uploaded' ? '已保存' : image.status === 'failed' ? '失败' : '上传中'}</span>}</div><figcaption className="mt-1 truncate text-[9px] text-sky-800" title={image.error || image.name}>{image.error || image.name}</figcaption></figure>)}</div></div>}
        </div>
    </Modal>
  );
}

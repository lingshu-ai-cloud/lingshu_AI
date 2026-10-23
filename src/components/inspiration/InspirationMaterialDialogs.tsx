import { Input, Modal, Select } from 'antd';
import type { ProductSceneKind } from '../../../shared/contracts/productScenePreparation';
import { PRODUCT_SCENE_KINDS } from '../../../shared/contracts/productScenePreparation';
import { neutralProductSceneLabel } from '../material-library/ProductMaterialGroup';

type ProductOption = { id: string; name: string };

export function MaterialUploadDialog(props: {
  open: boolean;
  productId: string;
  productSceneKind: ProductSceneKind | null;
  linkedProductId: string;
  linkedProductRef: string;
  products: ProductOption[];
  onProductChange: (id: string) => void;
  onCancel: () => void;
  onChooseFile: () => void;
}) {
  const sceneLabel = props.productSceneKind
    ? neutralProductSceneLabel(Math.max(0, PRODUCT_SCENE_KINDS.indexOf(props.productSceneKind)))
    : '';
  return <Modal open={props.open} title={sceneLabel ? `补充${sceneLabel}` : '上传素材'} width={480}
    okText="选择文件" cancelText="取消"
    okButtonProps={{ disabled: Boolean(props.productSceneKind && !props.productId) }}
    onCancel={props.onCancel} onOk={props.onChooseFile}>
    <label className="block text-xs font-semibold text-text-secondary">
      素材归属（可选）<span className="sr-only">可关联产品，也可作为企业通用素材上传</span>
      <Select aria-label="本次上传素材归属" className="mt-2 w-full"
        value={props.productId || undefined}
        placeholder={props.productSceneKind ? '请选择对应产品' : '企业通用素材（不绑定产品）'}
        disabled={Boolean(props.productSceneKind)} onChange={props.onProductChange}
        options={[
          { value: '', label: '企业通用素材（不绑定产品）' },
          ...(props.linkedProductId && props.linkedProductRef && !props.products.some(item => item.id === props.linkedProductId)
            ? [{ value: props.linkedProductId, label: props.linkedProductRef }] : []),
          ...props.products.map(item => ({ value: item.id, label: item.name })),
        ]} />
    </label>
    <p className="mt-3 text-xs leading-5 text-text-muted">工厂、展会、办公、人物动作和通用转场等素材可直接作为企业通用素材；只有需要锁定具体商品身份时才关联产品。</p>
    {props.productSceneKind && <div role="status" className="mt-4 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-text-secondary">
      该素材会归入当前产品的<strong className="mx-1 text-text-primary">{sceneLabel}</strong>。请选择视频文件。
    </div>}
  </Modal>;
}

export function MaterialManageDialog(props: {
  target: { action: 'edit' | 'delete'; kind: 'video' | 'material' } | null;
  name: string;
  tags: string;
  productId: string;
  products: ProductOption[];
  busy: boolean;
  commonProductValue: string;
  onNameChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onProductChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const target = props.target;
  if (!target) return null;
  return <Modal open title={`${target.action === 'delete' ? '删除' : '编辑'}${target.kind === 'video' ? '爆款视频' : '素材'}`}
    width={480} onCancel={props.onCancel} mask={{ closable: false }} keyboard={!props.busy} closable={!props.busy}
    confirmLoading={props.busy} okText={target.action === 'delete' ? '确认删除' : '保存'} cancelText="取消"
    okButtonProps={{ danger: target.action === 'delete', disabled: target.action === 'edit' && !props.name.trim() }}
    cancelButtonProps={{ disabled: props.busy }} onOk={props.onConfirm}>
    {target.action === 'edit' ? <>
      <label className="mt-4 block text-xs font-bold text-text-secondary">名称</label>
      <Input value={props.name} onChange={event => props.onNameChange(event.target.value)} maxLength={160} className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-accent" />
      <label className="mt-3 block text-xs font-bold text-text-secondary">标签</label>
      <Input value={props.tags} onChange={event => props.onTagsChange(event.target.value)} placeholder="用逗号分隔" className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-accent" />
      {target.kind === 'material' && <label className="mt-3 block text-xs font-bold text-text-secondary">关联产品
        <Select aria-label="素材关联产品" value={props.productId || props.commonProductValue}
          onChange={value => props.onProductChange(value === props.commonProductValue ? '' : value)}
          className="mt-1 w-full" options={[{ value: props.commonProductValue, label: '不指定（系统自动匹配）' }, ...props.products.map(item => ({ value: item.id, label: item.name }))]} />
        <span className="mt-1 block font-normal text-text-muted">可选。未指定时系统会按口播与画面语义自动匹配，也可作为企业通用素材使用。</span>
      </label>}
      <p className="mt-3 text-xs text-text-muted">仅当前租户自己采集或本地上传的素材可修改；共享素材保持只读。</p>
    </> : <p className="mt-4 border-l-2 border-red bg-red/5 p-3 text-sm text-red">确认删除“{props.name}”？删除后无法恢复。</p>}
  </Modal>;
}

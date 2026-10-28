import { Button, Drawer, Empty, Skeleton } from 'antd';
import { CheckCircle2, Clock3, Eye, Film, ImageOff, Music2, PackageOpen, Pencil, Play, RefreshCw, Sparkles, Star, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  PRODUCT_SCENE_KINDS,
  stableProductScenePreparationSlotId,
  type ProductSceneKind,
  type ProductScenePreparationReadModel,
} from '../../../shared/contracts/productScenePreparation';
import type { Material } from '../../lib/studioApi';
import { materialHasAuthoritativeAspectRatio, materialIntrinsicAspectRatio } from '../../lib/materialAspectRatio';
export { materialHasAuthoritativeAspectRatio, materialIntrinsicAspectRatio } from '../../lib/materialAspectRatio';
import { LsMasonryGallery, LsMediaStateFrame, LsProgressiveMedia } from '../ui/LsExperiencePrimitives';

export type ProductScenePreparationSlotView = ProductScenePreparationReadModel;

export interface ProductMaterialGroupProduct {
  id: string;
  name: string;
}

export const CONTAINED_PRODUCT_PREVIEW_ASPECT_RATIO = 1;

export function materialUsesContainedProductPreview(
  material: Pick<Material, 'type' | 'materialV2'> | undefined,
): boolean {
  return material?.type === 'image' && material.materialV2?.contentRole === 'transparent_cutout';
}

export function neutralProductSceneLabel(index: number): string {
  return `预制场景 ${index + 1}`;
}

export function materialMatchesProduct(
  material: Pick<Material, 'productId' | 'productName'>,
  product: ProductMaterialGroupProduct,
): boolean {
  const productId = String(material.productId || '').trim();
  if (productId) return productId === product.id;
  return Boolean(String(material.productName || '').trim() && material.productName === product.name);
}

export function materialBelongsToKnownProduct(
  material: Pick<Material, 'productId' | 'productName'>,
  products: ReadonlyArray<ProductMaterialGroupProduct>,
): boolean {
  return products.some(product => materialMatchesProduct(material, product));
}

export function selectProductCoverMaterial(
  materials: ReadonlyArray<Material>,
  product: ProductMaterialGroupProduct,
): Material | undefined {
  const productMaterials = materials.filter(material => materialMatchesProduct(material, product));
  return productMaterials.find(material => material.type === 'image' && material.sourceType === 'enterprise_product_table')
    || productMaterials.find(material => material.type === 'image' && material.materialV2?.contentRole !== 'transparent_cutout')
    || productMaterials.find(material => material.type === 'image')
    || productMaterials.find(material => material.type === 'video');
}

export function productSceneSlotHasReadyMaterial(slot: ProductScenePreparationSlotView): boolean {
  return slot.status === 'ready'
    && Boolean(String(slot.materialId || '').trim())
    && Boolean(String(slot.materialUrl || '').trim());
}

function IntrinsicMedia({
  alt,
  material,
  src,
  type,
  contained = false,
  children,
}: {
  alt: string;
  material?: Material;
  src: string;
  type: 'image' | 'video';
  contained?: boolean;
  children?: ReactNode;
}) {
  const [aspectRatio, setAspectRatio] = useState(() => (
    contained ? CONTAINED_PRODUCT_PREVIEW_ASPECT_RATIO : materialIntrinsicAspectRatio(material)
  ));
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(src ? 'loading' : 'error');

  useEffect(() => {
    setAspectRatio(contained ? CONTAINED_PRODUCT_PREVIEW_ASPECT_RATIO : materialIntrinsicAspectRatio(material));
    setState(src ? 'loading' : 'error');
  }, [contained, material?.aspectRatio, material?.height, material?.width, src]);

  const updateRatio = (width: number, height: number, mediaSource: 'image' | 'video') => {
    const posterMustNotOverrideVideo = material?.type === 'video'
      && mediaSource === 'image'
      && materialHasAuthoritativeAspectRatio(material);
    if (!contained && !posterMustNotOverrideVideo && width > 0 && height > 0) setAspectRatio(width / height);
    setState('ready');
  };

  return (
    <div
      className="relative w-full overflow-hidden bg-surface-2"
      data-media-fit={contained ? 'contain' : 'cover'}
      style={{ aspectRatio }}
    >
      <LsMediaStateFrame
        state={state}
        label={state === 'error' ? '素材预览暂不可用' : '正在加载素材'}
        className={`absolute inset-0 ${contained ? 'ls-transparent-media-preview' : ''}`}
      >
        {type === 'image' ? (
          <LsProgressiveMedia
            src={src}
            alt={alt}
            preview={false}
            width="100%"
            height="100%"
            style={{ objectFit: contained ? 'contain' : 'cover' }}
            onLoad={event => {
              const image = event.target as HTMLImageElement;
              updateRatio(image.naturalWidth, image.naturalHeight, 'image');
            }}
            onError={() => setState('error')}
          />
        ) : (
          <video
            src={src}
            aria-label={alt}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
            onLoadedMetadata={event => updateRatio(event.currentTarget.videoWidth, event.currentTarget.videoHeight, 'video')}
            onError={() => setState('error')}
          />
        )}
        {state === 'ready' ? children : null}
      </LsMediaStateFrame>
    </div>
  );
}

function ProductCover({
  product,
  coverMaterial,
  sourceImageUrl,
  loading,
  error,
}: {
  product: ProductMaterialGroupProduct;
  coverMaterial?: Material;
  sourceImageUrl?: string;
  loading?: boolean;
  error?: boolean;
}) {
  if (loading) {
    return <div className="aspect-square w-full bg-surface-2 p-5"><Skeleton active title={false} paragraph={{ rows: 5 }} /></div>;
  }
  const coverUrl = String(coverMaterial?.poster || coverMaterial?.url || sourceImageUrl || '').trim();
  if (!coverUrl) {
    return (
      <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-surface-2 text-text-muted">
        <PackageOpen size={30} aria-hidden="true" />
        <span className="ls-type-body-small">{error ? '素材暂时无法读取' : '产品素材待补充'}</span>
      </div>
    );
  }
  return (
    <IntrinsicMedia
      alt={`${product.name}产品素材`}
      material={coverMaterial}
      src={coverUrl}
      type={coverMaterial?.type === 'video' && !coverMaterial.poster ? 'video' : 'image'}
      contained={materialUsesContainedProductPreview(coverMaterial)}
    />
  );
}

export function ProductMaterialGroupCard({
  product,
  materials,
  slots,
  loading = false,
  error = false,
  onOpen,
}: {
  product: ProductMaterialGroupProduct;
  materials: ReadonlyArray<Material>;
  slots: ReadonlyArray<ProductScenePreparationSlotView>;
  loading?: boolean;
  error?: boolean;
  onOpen: (product: ProductMaterialGroupProduct) => void;
}) {
  const productSlots = slots.filter(slot => slot.productId === product.id);
  const coverMaterial = selectProductCoverMaterial(materials, product);
  const sourceImageUrl = productSlots.find(slot => slot.sourceImageUrl)?.sourceImageUrl;

  return (
    <article className="group relative overflow-hidden rounded-lg border border-border bg-surface transition-colors hover:border-border-bright focus-within:border-accent">
      <ProductCover product={product} coverMaterial={coverMaterial} sourceImageUrl={sourceImageUrl} loading={loading} error={error} />
      <div className="ls-touch-media-reveal absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/65 to-transparent p-3 pt-10 text-white opacity-0 transition-opacity duration-[var(--ls-motion-fast)] group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
        <h3 className="line-clamp-2 ls-type-title-small text-white">{product.name}</h3>
        <p className="mt-1 ls-type-body-small text-white/80">产品素材集合</p>
        <Button className="mt-3 min-h-11 w-full" icon={<Eye size={14} />} onClick={() => onOpen(product)}>
          查看详情
        </Button>
      </div>
    </article>
  );
}

function MaterialDetailTile({
  material,
  favoriting,
  onPreview,
  onEdit,
  onDelete,
  onToggleFavorite,
  onOpenDetail,
  onCreate,
}: {
  material: Material;
  favoriting: boolean;
  onPreview: (material: Material) => void;
  onEdit: (material: Material) => void;
  onDelete: (material: Material) => void;
  onToggleFavorite: (material: Material) => void;
  onOpenDetail: (material: Material) => void;
  onCreate: (material: Material) => void;
}) {
  const mediaUrl = String(material.poster || material.url || '').trim();
  const canCreate = material.type !== 'audio' && Boolean(mediaUrl);
  return (
    <article className="group relative overflow-hidden rounded-lg border border-border bg-surface focus-within:border-accent">
      <div className="relative">
        {material.type === 'audio' ? (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-surface-2 text-text-muted">
            <Music2 size={28} aria-hidden="true" />
            <span className="ls-type-body-small">音频素材</span>
          </div>
        ) : mediaUrl ? (
          <IntrinsicMedia
            alt={material.name}
            material={material}
            src={mediaUrl}
            type={material.type === 'video' && !material.poster ? 'video' : 'image'}
            contained={materialUsesContainedProductPreview(material)}
          >
            {material.type === 'video' ? (
              <button
                type="button"
                aria-label={`播放 ${material.name}`}
                onClick={() => onPreview(material)}
                className="ls-touch-media-reveal absolute left-1/2 top-1/2 z-10 inline-flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white max-md:opacity-100"
              >
                <Play size={18} fill="currentColor" />
              </button>
            ) : null}
          </IntrinsicMedia>
        ) : (
          <div className="flex aspect-square w-full items-center justify-center bg-surface-2 text-text-muted"><Film size={26} /></div>
        )}
      </div>
      <div className="ls-touch-media-reveal absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/65 to-transparent p-3 pt-10 text-white opacity-0 transition-opacity duration-[var(--ls-motion-fast)] group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
        <p className="line-clamp-2 ls-type-label-medium text-white">{material.name}</p>
        {Number(material.usageSummary?.totalUses || 0) > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/30 pt-2 ls-type-label-small text-white/85" aria-label="素材使用记录">
            <span>已用 {material.usageSummary?.totalUses} 次</span>
            {Number(material.usageSummary?.hookUses || 0) > 0 ? <span>前三秒 {material.usageSummary?.hookUses} 次</span> : null}
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1">
          {material.canManage ? <Button aria-label={`编辑 ${material.name}`} title="编辑" size="small" icon={<Pencil size={13} />} onClick={() => onEdit(material)} /> : null}
          {material.canManage ? <Button aria-label={`删除 ${material.name}`} title="删除" size="small" danger icon={<Trash2 size={13} />} onClick={() => onDelete(material)} /> : null}
          <Button aria-label={`${material.pinned ? '取消收藏' : '收藏'} ${material.name}`} title={material.pinned ? '取消收藏' : '收藏'} size="small" loading={favoriting} icon={<Star size={13} fill={material.pinned ? 'currentColor' : 'none'} />} onClick={() => onToggleFavorite(material)} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button className="min-w-0" icon={<Eye size={13} />} onClick={() => onOpenDetail(material)}>查看详情</Button>
          <Button type="primary" className="min-w-0" icon={<Sparkles size={13} />} disabled={!canCreate} onClick={() => onCreate(material)}>自由创作</Button>
        </div>
      </div>
    </article>
  );
}

function ProductSceneTile({
  index,
  material,
  slot,
  onPreview,
  onUpload,
}: {
  index: number;
  material?: Material;
  slot: ProductScenePreparationSlotView;
  onPreview: (material: Material) => void;
  onUpload: (slot: ProductScenePreparationSlotView) => void;
}) {
  const ready = productSceneSlotHasReadyMaterial(slot);
  const sourceAvailable = slot.sourceImageAvailable === true;
  const previewUrl = String(slot.posterUrl || slot.materialUrl || slot.sourceImageUrl || '').trim();
  const previewType = ready && !slot.posterUrl ? 'video' : 'image';
  const statusLabel = ready ? '已入库' : sourceAvailable ? '素材准备中' : '等待产品图片';
  const StatusIcon = ready ? CheckCircle2 : sourceAvailable ? Clock3 : ImageOff;
  const label = neutralProductSceneLabel(index);

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-surface">
      {previewUrl ? (
        <IntrinsicMedia alt={label} material={material} src={previewUrl} type={previewType}>
          {!ready ? <div className="absolute inset-0 flex items-center justify-center bg-white/80 px-4 text-center ls-type-label-medium text-text-secondary">{statusLabel}</div> : null}
          {ready && material ? (
            <button
              type="button"
              aria-label={`播放${label}`}
              onClick={() => onPreview(material)}
              className="absolute left-1/2 top-1/2 z-10 inline-flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Play size={18} fill="currentColor" />
            </button>
          ) : null}
        </IntrinsicMedia>
      ) : (
        <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-surface-2 text-text-muted">
          <StatusIcon size={24} aria-hidden="true" />
          <span className="ls-type-body-small">{statusLabel}</span>
        </div>
      )}
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="ls-type-label-medium text-text-primary">{label}</h3>
          <span className={`inline-flex items-center gap-1 ls-type-label-small ${ready ? 'text-emerald-700' : 'text-text-muted'}`} role="status">
            <StatusIcon size={13} aria-hidden="true" />{statusLabel}
          </span>
        </div>
        <Button
          className="mt-3 min-h-11 w-full"
          icon={ready ? <RefreshCw size={14} /> : <Upload size={14} />}
          onClick={() => onUpload(slot)}
        >
          {ready ? '更新素材' : '补充素材'}
        </Button>
      </div>
    </article>
  );
}

function LoadingTile({ index }: { index: number }) {
  return (
    <article aria-label={`正在读取产品素材 ${index + 1}`} className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="aspect-square bg-surface-2 p-5"><Skeleton active title={false} paragraph={{ rows: 4 }} /></div>
      <div className="p-3"><Skeleton active title={{ width: '60%' }} paragraph={{ rows: 1 }} /></div>
    </article>
  );
}

function completeProductSlots(
  product: ProductMaterialGroupProduct,
  slots: ReadonlyArray<ProductScenePreparationSlotView>,
): ProductScenePreparationSlotView[] {
  return PRODUCT_SCENE_KINDS.map((kind: ProductSceneKind) => {
    const persisted = slots.find(slot => slot.productId === product.id && slot.kind === kind);
    return persisted || {
      slotId: stableProductScenePreparationSlotId(product.id, kind),
      productId: product.id,
      kind,
      label: '',
      description: '',
      targetDurationSeconds: { min: 2, max: 3 },
      status: 'waiting_source',
      sourceImageAvailable: false,
    };
  });
}

export function ProductMaterialDetailDrawer({
  product,
  filterActive = false,
  materials,
  slots,
  loading,
  error,
  onClose,
  onRetry,
  onPreviewMaterial,
  onEditMaterial,
  onDeleteMaterial,
  onToggleFavoriteMaterial,
  onOpenMaterialDetail,
  onCreateFromMaterial,
  isMaterialFavoriting,
  onUploadSlot,
}: {
  product: ProductMaterialGroupProduct | null;
  filterActive?: boolean;
  materials: ReadonlyArray<Material>;
  slots: ReadonlyArray<ProductScenePreparationSlotView>;
  loading: boolean;
  error?: string;
  onClose: () => void;
  onRetry: (product: ProductMaterialGroupProduct) => void;
  onPreviewMaterial: (material: Material) => void;
  onEditMaterial: (material: Material) => void;
  onDeleteMaterial: (material: Material) => void;
  onToggleFavoriteMaterial: (material: Material) => void;
  onOpenMaterialDetail: (material: Material) => void;
  onCreateFromMaterial: (material: Material) => void;
  isMaterialFavoriting: (material: Material) => boolean;
  onUploadSlot: (slot: ProductScenePreparationSlotView) => void;
}) {
  const productSlots = useMemo(() => product ? (filterActive ? [...slots] : completeProductSlots(product, slots)) : [], [product, slots, filterActive]);
  const sceneMaterialIds = useMemo(() => new Set(productSlots.map(slot => slot.materialId).filter(Boolean)), [productSlots]);
  const regularMaterials = materials.filter(material => !material.productSceneType && !sceneMaterialIds.has(material.id));
  const items = [
    ...regularMaterials.map(material => ({
      id: `material-${material.id}`,
      content: (
        <MaterialDetailTile
          material={material}
          favoriting={isMaterialFavoriting(material)}
          onPreview={onPreviewMaterial}
          onEdit={onEditMaterial}
          onDelete={onDeleteMaterial}
          onToggleFavorite={onToggleFavoriteMaterial}
          onOpenDetail={onOpenMaterialDetail}
          onCreate={onCreateFromMaterial}
        />
      ),
    })),
    ...productSlots.map((slot, index) => {
      const material = materials.find(candidate => candidate.id === slot.materialId);
      return {
        id: `scene-${slot.slotId}`,
        content: (
          <ProductSceneTile
            index={index}
            material={material}
            slot={slot}
            onPreview={onPreviewMaterial}
            onUpload={onUploadSlot}
          />
        ),
      };
    }),
  ];

  return (
    <Drawer
      open={Boolean(product)}
      title={product ? `${product.name} · 素材详情` : '产品素材详情'}
      placement="right"
      size={760}
      onClose={onClose}
      styles={{ body: { padding: 0 } }}
    >
      <section className="border-b border-border bg-surface-2 px-5 py-4">
        <p className="ls-type-body-small text-text-muted">产品素材统一收纳在这里，内容制作时可直接调用。</p>
      </section>
      <div className="p-5">
        {loading ? (
          <LsMasonryGallery
            layout="masonry"
            columns={{ xs: 1, sm: 2, md: 2, lg: 3, xl: 3, xxl: 3 }}
            items={[0, 1, 2, 3].map(index => ({ id: `loading-${index}`, content: <LoadingTile index={index} /> }))}
          />
        ) : error ? (
          <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            <p>{error}</p>
            {product ? <Button className="mt-3" icon={<RefreshCw size={14} />} onClick={() => onRetry(product)}>重新加载</Button> : null}
          </div>
        ) : items.length ? (
          <LsMasonryGallery layout="masonry" columns={{ xs: 1, sm: 2, md: 2, lg: 3, xl: 3, xxl: 3 }} items={items} />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无产品素材" />
        )}
      </div>
    </Drawer>
  );
}

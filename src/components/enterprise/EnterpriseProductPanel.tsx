import { type Dispatch, type SetStateAction } from 'react';
import { Alert, Button, Input, Upload as AntUpload } from 'antd';
import { ChevronDown, FileSpreadsheet, FileText, Image, Package, Plus, Upload, X } from 'lucide-react';
import { CATEGORY_OPTIONS, CERTIFICATION_OPTIONS } from './enterpriseProfileNormalization';
import { productCreativeMaterialCount } from './enterpriseProfileCompleteness';
import type { ProductItem, Profile } from './enterpriseProfileTypes';
import { Field, KnowledgeCard, OptionSelector, PaginationControls } from './EnterpriseFormControls';

type ProductDeepLink = { productName: string; materialIds: string[]; contentItemId: string };

interface Props {
  profileProducts: Profile['products'];
  products: ProductItem[];
  visibleProducts: ProductItem[];
  completed: boolean;
  assetStats: { documents: number; creative: number };
  productsDeepLink: ProductDeepLink | null;
  productsDeepLinkResolved: boolean;
  deepLinkedProduct: ProductItem | null;
  deepLinkMaterialCount: number;
  openProductMaterials: (product: ProductItem) => void;
  openMaterialLibrary: () => void;
  onProductFieldChange: (field: string, value: string) => void;
  productImporting: boolean;
  productImportMessage: string;
  importProductSheet: (file: File | null) => Promise<void>;
  addProduct: () => void;
  productPage: number;
  pageSize: number;
  expandedProductIndexes: ReadonlySet<number>;
  setExpandedProductIndexes: Dispatch<SetStateAction<Set<number>>>;
  removeProduct: (index: number) => void;
  updateProduct: (index: number, patch: Partial<ProductItem>) => void;
  addProductDocuments: (index: number, files: FileList | null) => Promise<void>;
  removeProductDocument: (index: number, assetIndex: number) => void;
  maxProductDocuments: number;
  setProductPage: Dispatch<SetStateAction<number>>;
}

const inputCls = 'w-full';
const textareaCls = 'w-full resize-y';

function formatSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  if (size >= 1024) return `${Math.round(size / 1024)}KB`;
  return `${size}B`;
}

export default function EnterpriseProductPanel({
  profileProducts, products, visibleProducts, completed, assetStats,
  productsDeepLink, productsDeepLinkResolved, deepLinkedProduct, deepLinkMaterialCount,
  openProductMaterials, openMaterialLibrary, onProductFieldChange,
  productImporting, productImportMessage, importProductSheet, addProduct,
  productPage, pageSize, expandedProductIndexes, setExpandedProductIndexes,
  removeProduct, updateProduct, addProductDocuments, removeProductDocument,
  maxProductDocuments, setProductPage,
}: Props) {
  return (
          <KnowledgeCard
            icon={Package}
            title="产品资料"
            purpose="AI 推荐产品、整理询价条件和生成内容的原料"
            completed={completed}
            stat={`${products.length} 个产品 · ${assetStats.documents} 份资质凭证 · ${assetStats.creative} 项历史素材记录`}
          >
            {productsDeepLink && productsDeepLinkResolved && <div className="mb-4" data-content-item-id={productsDeepLink.contentItemId || undefined}>
              <Alert
                type={deepLinkedProduct ? 'success' : 'warning'}
                showIcon
                title={deepLinkedProduct ? `已定位到“${deepLinkedProduct.name}”` : '未能可靠定位任务产品'}
                description={deepLinkedProduct
                  ? deepLinkMaterialCount > 0
                    ? `内容任务 ${productsDeepLink.contentItemId || '当前任务'} 还引用 ${deepLinkMaterialCount} 项素材。企业知识库只展示产品事实，不会把素材 ID 伪装成页内文件定位；请从该产品的“我的素材”入口继续核对。`
                    : `已按内容任务 ${productsDeepLink.contentItemId || '当前任务'} 的唯一同名产品定位到资料卡。`
                  : `内容任务 ${productsDeepLink.contentItemId || '当前任务'} 提供的产品名称无法唯一匹配已保存产品，已打开稳定的产品资料列表${deepLinkMaterialCount > 0 ? `；其 ${deepLinkMaterialCount} 项素材引用请在“我的素材”中核对` : ''}。`}
                action={<Button onClick={() => deepLinkedProduct ? openProductMaterials(deepLinkedProduct) : openMaterialLibrary()}>
                  {deepLinkedProduct ? '打开该产品素材' : '打开我的素材'}
                </Button>}
              />
            </div>}
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-3">
              <p className="text-sm font-semibold text-emerald-950">产品素材统一在“我的素材”管理</p>
              <p className="mt-1 text-xs leading-5 text-emerald-800">企业知识库只维护产品事实和资质凭证。图片、视频和音频只需上传一次；从内容任务上传的素材也会归入同一个素材库。</p>
            </div>
            <div className="mb-4 grid gap-4 md:grid-cols-2">
              <Field label="主营品类">
                <OptionSelector value={profileProducts.categories} options={CATEGORY_OPTIONS} onChange={value => onProductFieldChange('categories', value)} placeholder="选择主营品类" />
              </Field>
              <Field label="认证资质">
                <OptionSelector value={profileProducts.certifications} options={CERTIFICATION_OPTIONS} onChange={value => onProductFieldChange('certifications', value)} placeholder="选择认证资质" />
              </Field>
            </div>
            <Field label="产品核心优势">
              <Input.TextArea className={textareaCls} rows={2} value={profileProducts.highlights} onChange={e => onProductFieldChange('highlights', e.target.value)} placeholder="工厂直供、支持 OEM/ODM、备货稳定" />
            </Field>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <AntUpload accept=".xlsx,.xls,.csv,.pdf,.docx" showUploadList={false} disabled={productImporting} beforeUpload={file => { void importProductSheet(file); return false; }}>
                <Button loading={productImporting} icon={<FileSpreadsheet size={14} />}>导入产品表</Button>
              </AntUpload>
              <Button onClick={addProduct} icon={<Plus size={14} />}>添加产品</Button>
              {productImportMessage && <span className="text-[11px] font-bold text-emerald-700">{productImportMessage}</span>}
            </div>
            <div className="mt-4 space-y-3">
              {visibleProducts.map((product, pageIndex) => {
                const index = (productPage - 1) * pageSize + pageIndex;
                return (
                <details
                  key={index}
                  id={`enterprise-product-${index}`}
                  className="group relative rounded-lg border border-border bg-surface-2/50 p-4"
                  open={expandedProductIndexes.has(index)}
                  onToggle={event => {
                    const isOpen = event.currentTarget.open;
                    setExpandedProductIndexes(previous => {
                      if (previous.has(index) === isOpen) return previous;
                      const next = new Set(previous);
                      if (isOpen) next.add(index);
                      else next.delete(index);
                      return next;
                    });
                  }}
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 pr-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-text-primary">{product.name.trim() || `产品 ${index + 1}`}</p>
                      <p className="mt-1 text-[10px] text-text-muted">产品事实 · 资质凭证 {product.documents?.length ?? 0} 份 · 现有素材记录 {productCreativeMaterialCount(product)} 项</p>
                    </div>
                    <ChevronDown size={14} className="shrink-0 text-text-muted transition-transform group-open:rotate-180" />
                  </summary>
                  <button type="button" onClick={() => removeProduct(index)} aria-label={`删除产品 ${product.name || index + 1}`} className="absolute right-3 top-3 rounded-md p-1 text-text-muted hover:bg-white hover:text-red" title="删除产品"><X size={13} /></button>
                  <div className="mt-4 border-t border-border pt-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="产品名称">
                      <Input className={inputCls} value={product.name} onChange={e => updateProduct(index, { name: e.target.value })} placeholder={`产品${index + 1}`} />
                    </Field>
                    <Field label="产品类目">
                      <OptionSelector value={product.category ?? ''} options={CATEGORY_OPTIONS} multiple={false} onChange={value => updateProduct(index, { category: value })} placeholder="选择产品类目" />
                    </Field>
                    <div id={`enterprise-product-${index}-price`}><Field label="参考价或标签价">
                      <Input className={inputCls} value={product.priceRange ?? product.retailPrice ?? product.tagPrice ?? ''} onChange={e => updateProduct(index, { priceRange: e.target.value })} placeholder="$5 - $500 USD" />
                    </Field></div>
                    <Field label="起订量">
                      <Input className={inputCls} value={product.moq ?? ''} onChange={e => updateProduct(index, { moq: e.target.value })} placeholder="50 件起，支持混批" />
                    </Field>
                  </div>
                  <Field label="产品卖点">
                    <Input.TextArea className={textareaCls} rows={2} value={product.highlights ?? ''} onChange={e => updateProduct(index, { highlights: e.target.value })} placeholder="核心卖点、适用场景、可定制项、交付优势" />
                  </Field>
                  <div className="mt-3 space-y-3 border-t border-border pt-3">
                    <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold text-emerald-950">产品素材统一在“我的素材”管理</p>
                        <p className="mt-1 text-[11px] leading-5 text-emerald-800">当前产品有 {productCreativeMaterialCount(product)} 项历史素材记录。进入素材库后可按产品查看、上传和复用。</p>
                      </div>
                      <button type="button" onClick={() => openProductMaterials(product)} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
                        <Image size={13} />去我的素材
                      </button>
                    </div>
                    <div id={`enterprise-product-${index}-certificate`} className="rounded-lg border border-border bg-white p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-text-secondary"><FileText size={12} />资质凭证</span>
                        <span className="text-[10px] text-text-muted">{product.documents?.length ?? 0}/{maxProductDocuments}</span>
                      </div>
                      <p className="mb-2 text-[10px] leading-4 text-text-muted">这里只保存用于证明产品事实的证书、检测报告等资料，不作为视频创作素材。</p>
                      <label className={`flex h-8 items-center justify-center gap-1.5 rounded-md border border-dashed text-[11px] font-bold ${(product.documents?.length ?? 0) >= maxProductDocuments ? 'cursor-not-allowed bg-surface-2 text-text-muted' : 'cursor-pointer text-text-secondary hover:border-border-bright hover:text-text-primary'}`}>
                        <Upload size={12} />上传资质凭证
                        <input className="hidden" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" disabled={(product.documents?.length ?? 0) >= maxProductDocuments} onChange={e => { addProductDocuments(index, e.currentTarget.files); e.currentTarget.value = ''; }} />
                      </label>
                      <div className="mt-2 space-y-1">
                        {(product.documents ?? []).map((asset, assetIndex) => (
                          <div key={`${asset.name}-${assetIndex}`} className="flex min-w-0 items-center gap-1.5 text-[10px] text-text-secondary">
                            {asset.url ? <a href={asset.url} target="_blank" rel="noreferrer" className="flex-1 truncate hover:text-text-primary">{asset.name}</a> : <span className="flex-1 truncate">{asset.name}</span>}
                            <span className="shrink-0 text-text-muted">{formatSize(asset.size)}</span>
                            <button type="button" onClick={() => removeProductDocument(index, assetIndex)} aria-label={`删除资质凭证 ${asset.name}`} title="删除资质凭证" className="shrink-0 rounded p-0.5 text-text-muted hover:text-red"><X size={10} /></button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  </div>
                </details>
                );
              })}
              {!products.length && <p className="rounded-lg bg-surface-2 px-3 py-3 text-xs text-text-muted">还没有产品，先添加一个产品或导入产品表。</p>}
            </div>
            <PaginationControls page={productPage} total={products.length} pageSize={pageSize} onChange={setProductPage} />
          </KnowledgeCard>
  );
}

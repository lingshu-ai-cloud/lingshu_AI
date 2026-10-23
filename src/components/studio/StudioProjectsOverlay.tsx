import { lazy, Suspense, useState } from 'react';
import { Button, Popconfirm } from 'antd';
import { motion } from 'motion/react';
import { Copy, FolderOpen, Trash2 } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus';
import { productionSummary } from '../../lib/shotProduction';
import { studioApi, type StudioProject, type VariationBatch } from '../../lib/studioApi';
import type { StudioWorkflowContext } from '../../lib/studioProjectContext';
import type { Clip } from './studioSourceMaterial.js';
import { ProjectFirstFrameThumb } from '../StudioMediaPreviews';
const ContentLibrary = lazy(() => import('../ContentLibrary'));
const STUDIO_ACCENT = 'var(--color-accent)';

/* ── 我的作品 / 草稿 浮层 ─────────────────────────────────────────────── */
export default function ProjectsOverlay({ projects, batches, materials, currentId, workflowContext, emptyMessage, onClose, onLoad, onDelete, onReview, onReuseProject, onReuse, onPublish }: {
  projects: StudioProject[];
  batches: VariationBatch[];
  materials: Clip[];
  currentId: string | null;
  workflowContext?: StudioWorkflowContext;
  emptyMessage?: string;
  onClose: () => void;
  onLoad: (p: StudioProject) => void;
  onDelete: (id: string) => Promise<void>;
  onReview: (batchId: string, itemId: string, status: 'approved' | 'rejected') => void;
  onReuseProject: (p: StudioProject) => void | Promise<void>;
  onReuse: (batch: VariationBatch) => void;
  onPublish: (draft: any) => void;
}) {
  const [collection, setCollection] = useState<'projects' | 'finished'>('projects');
  const dialogRef = useModalFocus<HTMLDivElement>({ open: true, onClose });
  const drafts = projects.filter(p => p.status === 'draft');
  const works = projects.filter(p => p.status === 'ready_for_approval' || p.status === 'published');

  const Section = ({ title, items }: { title: string; items: StudioProject[] }) => (
    <div className="mb-5">
      <p className="text-xs font-semibold text-text-secondary mb-2">{title} · {items.length}</p>
      {items.length === 0 ? (
        <p className="text-xs text-text-muted py-3 text-center">暂无</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map(p => (
            <div key={p.id}
              className="card !rounded-lg overflow-hidden group cursor-pointer relative"
              style={p.id === currentId ? { borderColor: STUDIO_ACCENT, boxShadow: `0 0 0 1px ${STUDIO_ACCENT}` } : undefined}
              onClick={() => onLoad(p)}>
              <div className="relative">
                <ProjectFirstFrameThumb project={p} materials={materials} />
                <button
                  type="button"
                  onClick={event => {
                    event.stopPropagation();
                    void onReuseProject(p);
                  }}
                  className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-lg bg-accent px-2 py-1 text-[10px] font-semibold text-white shadow-none hover:brightness-95"
                  title="复制为新草稿并进入编辑"
                >
                  <Copy size={10} /> 一键复用
                </button>
              </div>
              <div className="p-2.5">
                <p className="text-xs font-semibold text-text-primary truncate">{p.title}</p>
                {productionSummary(p.spec || {}) && <p className="mt-1 text-[10px] text-amber-700">{productionSummary(p.spec || {})}</p>}
                <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-xs text-text-muted">{new Date(p.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
                  <Popconfirm
                    title="删除这条创作？"
                    description={`“${p.title}”删除后无法恢复。`}
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => onDelete(p.id)}
                  >
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<Trash2 size={13} />}
                      aria-label={`删除创作：${p.title}`}
                      onClick={event => event.stopPropagation()}
                    >
                      删除
                    </Button>
                  </Popconfirm>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <motion.div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="projects-overlay-title"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex bg-surface">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="h-full w-full flex flex-col bg-surface overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <FolderOpen size={15} style={{ color: STUDIO_ACCENT }} />
            <div>
              <span id="projects-overlay-title" className="text-sm font-bold text-text-primary">{workflowContext ? '当前任务的内容项目' : '我的创作'}</span>
              {workflowContext && <p className="mt-0.5 text-[10px] text-text-muted">仅显示本次运行与任务关联的项目</p>}
            </div>
          </div>
          <button type="button" data-modal-initial-focus onClick={onClose} aria-label="关闭我的创作" title="关闭" className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary">
            返回创作
          </button>
        </div>
        <div className="flex shrink-0 gap-6 border-b border-border px-6" role="tablist" aria-label="我的创作分类">
          {(['projects', 'finished'] as const).filter(tab => !workflowContext || tab === 'projects').map(tab => <button key={tab} role="tab" aria-selected={collection === tab} onClick={() => setCollection(tab)} className={`border-b-2 py-4 text-sm font-semibold ${collection === tab ? 'border-accent text-accent' : 'border-transparent text-text-muted'}`}>{tab === 'projects' ? '草稿与项目' : '已完成成片'}</button>)}
        </div>
        {collection === 'finished' && <div className="min-h-0 flex-1"><Suspense fallback={<div role="status" className="p-6 text-sm text-text-secondary">正在打开成片库…</div>}><ContentLibrary
          onPublish={onPublish}
          onOpenProject={async projectId => onLoad(await studioApi.getProject(projectId))}
        /></Suspense></div>}
        <div className={collection === 'projects' ? "flex-1 overflow-y-auto p-6" : "hidden"}>
          {drafts.length === 0 && works.length === 0 && batches.length === 0 ? (
            <div className="text-center py-12">
              <FolderOpen size={28} className="mx-auto text-text-muted mb-3 opacity-30" />
              <p className="text-sm text-text-muted">{emptyMessage || (workflowContext ? '当前任务尚未创建内容项目' : '还没有保存任何草稿或作品')}</p>
              <p className="text-xs text-text-muted mt-1">{workflowContext ? '请返回执行中心查看任务状态或重试任务' : '开始创作后会自动保存，也可在顶部手动保存'}</p>
            </div>
          ) : (
            <>
              <Section title="继续创作" items={drafts} />
              <Section title="已完成项目 · 可继续编辑" items={works} />
              {batches.length > 0 && (
                <div className="mb-5">
                  <p className="mb-2 text-xs font-semibold text-text-secondary">裂变批次 · {batches.length}</p>
                  <div className="space-y-2">
                    {batches.map(batch => (
                      <div key={batch.id} className="rounded-lg border border-border bg-surface-2 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div><p className="text-xs font-bold text-text-primary">{batch.title}</p><p className="mt-0.5 text-[10px] text-text-muted">{batch.items.length} 条 · 预计生成成本 ¥{batch.estimatedCostCny} · {batch.status}</p></div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button type="button" onClick={() => void onReuse(batch)}
                              className="flex items-center gap-1 rounded-md border border-accent/25 bg-white px-2 py-1 text-[10px] font-bold text-accent transition hover:bg-accent/10">
                              <Copy size={10} /> 复用
                            </button>
                          </div>
                        </div>
                        {batch.items.filter(item => item.status === 'review').map(item => (
                          <div key={item.id} className="mt-2 flex items-center gap-2 rounded-lg bg-surface px-2.5 py-2">
                            <p className="min-w-0 flex-1 truncate text-[10px] text-text-secondary">{Object.values(item.variables).join(' · ')}{item.qualityScore != null ? ` · 质检 ${item.qualityScore}` : ''}</p>
                            <button onClick={() => onReview(batch.id, item.id, 'approved')} className="text-[10px] font-bold text-accent">通过</button>
                            <button onClick={() => onReview(batch.id, item.id, 'rejected')} className="text-[10px] font-bold text-red">驳回</button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

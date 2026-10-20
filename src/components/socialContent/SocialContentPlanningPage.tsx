import { useEffect, useState } from 'react';
import { FileImage, ImagePlus, Loader2, Video } from 'lucide-react';
import { Button } from 'antd';
import LsPageHeader from '../ui/LsPageHeader';
import type { Page } from '../../App';
import SocialContentWorkspace, { type SocialContentCreateRequest } from './SocialContentWorkspace';
import SocialContentLanding, { type SocialContentLaunchOptions } from './SocialContentLanding';
import SocialCreationWorkbench, {
  type SocialCreationWorkbenchSeed,
  type SocialCreationWorkbenchSubmit,
} from './SocialCreationWorkbench';
import SocialImageWorkbench from './SocialImageWorkbench';
import SocialContentHistoryHome from './SocialContentHistoryHome';
import { loadSocialContentStage, readSocialContentStage, type SocialContentStageProfile } from '../../lib/socialContentStage';
import { studioApi } from '../../lib/studioApi';
import { replicationResumeStep } from '../../lib/socialContentReplicationResume';
import type { SocialImageCreationTask } from '../../../shared/contracts/socialImageCreation';

type PlanningView = 'workbench' | 'creations';
type ProductionMode = 'video' | 'image';

function creationPathFromRequest(request: SocialContentCreateRequest): SocialContentLaunchOptions['creationPath'] {
  return request.creationPath || (request.sourceContext ? 'viral_replication' : 'material_processing');
}

function seedFromRequest(request?: SocialContentCreateRequest | null): SocialCreationWorkbenchSeed | undefined {
  if (!request) return undefined;
  return {
    continueTaskId: request.continueTaskId,
    continueProjectId: request.continueProjectId,
    presenterAssetId: request.presenterAssetId,
    draftTitle: request.prefill?.title,
    referenceTitle: request.sourceContext?.referenceTitle,
    referenceThumbnail: request.sourceContext?.referenceThumbnail,
    referenceMediaUrl: request.sourceContext?.referenceMediaUrl,
    referenceContentType: request.sourceContext?.referenceContentType,
    referenceShots: request.sourceContext?.referenceShots,
    referenceLinks: request.prefill?.referenceLinks,
    productMappings: request.identityMappings?.products,
    confirmedSpeech: request.confirmedSpeech,
    selectedProductIds: request.identityMappings?.selectedProductIds,
    selectedProductNames: request.identityMappings?.selectedProductNames,
    productId: request.prefill?.productId,
    productName: request.prefill?.productName,
  };
}

export default function SocialContentPlanningPage({
  onNavigate,
  onNavigateWithTask,
  onLaunchStudio,
  taskOnly = false,
  initialCreateRequest,
}: {
  taskOnly?: boolean;
  onNavigate: (page: Page) => void;
  onNavigateWithTask: (page: Page, taskId: string) => void;
  onLaunchStudio: (request: SocialContentCreateRequest) => void;
  initialCreateRequest?: SocialContentCreateRequest | null;
}) {
  const [view, setView] = useState<PlanningView>(initialCreateRequest ? 'workbench' : 'creations');
  const [chooserOpen, setChooserOpen] = useState(false);
  const [stageProfile, setStageProfile] = useState<SocialContentStageProfile | null>(() => readSocialContentStage());
  const [launch, setLaunch] = useState<SocialContentLaunchOptions | null>(() => initialCreateRequest ? {
    creationPath: creationPathFromRequest(initialCreateRequest),
    materialInput: initialCreateRequest.materialInput || 'ready',
    managedMode: initialCreateRequest.managedMode || 'one_click_managed',
  } : null);
  const [seed, setSeed] = useState<SocialCreationWorkbenchSeed | undefined>(() => seedFromRequest(initialCreateRequest));
  const [sourceRequest, setSourceRequest] = useState<SocialContentCreateRequest | null>(initialCreateRequest || null);
  const [productionMode, setProductionMode] = useState<ProductionMode | null>(() => initialCreateRequest?.sourceContext?.referenceContentType === 'image' ? 'image' : initialCreateRequest ? 'video' : null);
  const [imageTask, setImageTask] = useState<SocialImageCreationTask | undefined>();
  const [resumeChecking, setResumeChecking] = useState(() => Boolean(!initialCreateRequest?.replicationStep
    && initialCreateRequest?.continueProjectId
    && creationPathFromRequest(initialCreateRequest) === 'viral_replication'));

  useEffect(() => {
    if (taskOnly) return;
    let active = true;
    void loadSocialContentStage().then(profile => { if (active) setStageProfile(profile); });
    return () => { active = false; };
  }, [taskOnly]);

  useEffect(() => {
    if (!initialCreateRequest) return;
    setLaunch({
      creationPath: creationPathFromRequest(initialCreateRequest),
      materialInput: initialCreateRequest.materialInput || 'ready',
      managedMode: initialCreateRequest.managedMode || 'one_click_managed',
    });
    setSeed(seedFromRequest(initialCreateRequest));
    setSourceRequest(initialCreateRequest);
    setProductionMode(initialCreateRequest.sourceContext?.referenceContentType === 'image' ? 'image' : 'video');
    setImageTask(undefined);
    setChooserOpen(false);
    setView('workbench');
  }, [initialCreateRequest]);

  useEffect(() => {
    const projectId = String(initialCreateRequest?.continueProjectId || '').trim();
    if (!initialCreateRequest || initialCreateRequest.replicationStep || !projectId || creationPathFromRequest(initialCreateRequest) !== 'viral_replication') {
      setResumeChecking(false);
      return undefined;
    }
    let disposed = false;
    setResumeChecking(true);
    void studioApi.getProject(projectId).then(project => {
      if (disposed) return;
      const resumeStep = replicationResumeStep(project);
      if (!resumeStep) return;
      onLaunchStudio({ ...initialCreateRequest, replicationStep: resumeStep });
    }).catch(() => {
      // Keep the editable speech step available if the authoritative project cannot be read.
    }).finally(() => {
      if (!disposed) setResumeChecking(false);
    });
    return () => { disposed = true; };
  }, [initialCreateRequest, onLaunchStudio]);

  useEffect(() => {
    if (taskOnly) return undefined;
    const openChooser = () => setChooserOpen(true);
    window.addEventListener('lingshu:open-content-creation', openChooser);
    return () => window.removeEventListener('lingshu:open-content-creation', openChooser);
  }, [taskOnly]);

  const startCreation = (options: SocialContentLaunchOptions) => {
    setLaunch(options);
    setSeed(undefined);
    setSourceRequest(null);
    setProductionMode(null);
    setImageTask(undefined);
    setChooserOpen(false);
    setView('workbench');
  };

  const startGeneration = (request: SocialCreationWorkbenchSubmit) => {
    const primaryMaterial = request.uploadedMaterials[0];
    const distinctProducts = request.productMappings.filter((mapping, index, mappings) =>
      mapping.productId && mappings.findIndex(item => item.productId === mapping.productId) === index);
    if (request.creationPath === 'material_processing') {
      try {
        localStorage.setItem('ow_video_kickoff', JSON.stringify({
          source: 'material_library',
          productInfo: request.productName,
          script: request.initialScript,
          initialGeneration: request.initialGeneration,
          generatedVideo: primaryMaterial ? {
            id: primaryMaterial.id,
            title: primaryMaterial.name,
            url: primaryMaterial.url,
            poster: primaryMaterial.poster,
            duration: primaryMaterial.duration,
            material: primaryMaterial,
          } : undefined,
          materialRole: primaryMaterial ? 'hook' : undefined,
        }));
      } catch { /* local handoff is optional */ }
    }

    onLaunchStudio({
      ...(sourceRequest || {}),
      requestId: request.requestId,
      replicationStep: request.replicationStep,
      confirmedSpeech: request.confirmedSpeech,
      continueProjectId: request.draftProjectId || sourceRequest?.continueProjectId,
      themeId: sourceRequest?.themeId || 'product_value',
      mode: 'instant',
      creationPath: request.creationPath,
      materialInput: primaryMaterial ? 'ready' : launch?.materialInput || 'none',
      managedMode: 'one_click_managed',
      prefill: {
        ...(sourceRequest?.prefill || {}),
        title: request.title,
        topic: sourceRequest?.prefill?.topic || request.title,
        productId: request.productId,
        productName: request.productName,
        referenceLinks: request.referenceLinks,
      },
      sourceContext: sourceRequest?.sourceContext,
      identityMappings: {
        selectedProductIds: distinctProducts.map(mapping => mapping.productId),
        selectedProductNames: distinctProducts.map(mapping => mapping.productName),
        products: request.productMappings,
        brand: request.brandMapping,
      },
      presenterAssetId: request.presenterAssetId || sourceRequest?.presenterAssetId,
      specialRequirements: request.specialRequirements,
    });
  };

  const selectViralReplication = () => {
    setChooserOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    url.searchParams.delete('productId');
    url.searchParams.delete('productRef');
    window.history.replaceState(window.history.state, '', url);
    onNavigate('socialInspiration');
  };

  if (taskOnly) {
    return <SocialContentWorkspace onNavigate={onNavigate} onNavigateWithTask={onNavigateWithTask} />;
  }

  if (resumeChecking) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-white" role="status" aria-live="polite">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-white px-5 py-4 text-sm font-semibold text-text-secondary">
          <Loader2 size={18} className="animate-spin text-blue-600" aria-hidden="true" />
          正在恢复真实制作进度…
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 bg-ink">
      {view === 'workbench' && launch ? (
        productionMode === 'video' ? <SocialCreationWorkbench
            key={`${launch.creationPath}:${seed?.referenceTitle || 'new'}`}
            mode={launch.creationPath}
            seed={sourceRequest ? { ...seed, ...seedFromRequest(sourceRequest) } : seed}
            stageProfile={stageProfile || undefined}
            onOpenChooser={() => setProductionMode(null)}
            onShowCreations={() => setView('creations')}
            onGenerate={startGeneration}
          /> : productionMode === 'image' ? <SocialImageWorkbench
            key={`image:${launch.creationPath}:${seed?.referenceTitle || 'new'}`}
            creationPath={launch.creationPath}
            referenceTitle={seed?.referenceTitle}
            referenceThumbnail={seed?.referenceThumbnail}
            referenceMediaUrl={seed?.referenceMediaUrl}
            initialTask={imageTask}
            onShowCreations={() => setView('creations')}
          /> : <div className="flex h-full min-h-0 flex-col bg-white">
            <LsPageHeader title="选择生产模式" extra={<><Button onClick={() => setView('creations')}>我的创作</Button><Button onClick={() => setChooserOpen(true)}>切换制作方式</Button></>} />
            <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
              <section className="w-full max-w-3xl" aria-labelledby="production-mode-heading">
                <h2 id="production-mode-heading" className="text-center text-xl font-semibold text-text-primary">这次要制作什么内容？</h2>
                <p className="mt-2 text-center text-sm text-text-secondary">先选择视频或图片；图片模式下一步再确认产品海报、品牌新闻、轮播图或 GIF。</p>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <button type="button" onClick={() => setProductionMode('video')} className="flex min-h-44 flex-col rounded-lg border border-border bg-white p-5 text-left transition-colors hover:border-blue-400 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30">
                    <span className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-blue-600"><Video size={20} /></span>
                    <strong className="mt-5 text-base font-semibold text-text-primary">视频模式</strong>
                    <span className="mt-2 text-sm leading-6 text-text-secondary">逐句口播、分镜、钩子、数字人与成片合成。</span>
                  </button>
                  <button type="button" onClick={() => setProductionMode('image')} className="flex min-h-44 flex-col rounded-lg border border-border bg-white p-5 text-left transition-colors hover:border-violet-400 hover:bg-violet-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30">
                    <span className="flex h-10 w-10 items-center justify-center rounded-md bg-violet-50 text-violet-600"><FileImage size={20} /></span>
                    <strong className="mt-5 text-base font-semibold text-text-primary">图片模式</strong>
                    <span className="mt-2 text-sm leading-6 text-text-secondary">单图、产品海报、品牌新闻、轮播图与 GIF，并联合生成帖子配文。</span>
                  </button>
                </div>
              </section>
            </main>
          </div>
      ) : (
        <div className="h-full min-h-0 overflow-y-auto">
          <main className="mx-auto max-w-[1440px] px-4 py-5 sm:px-8 sm:py-7">
            <LsPageHeader title="我的创作" description="查看正在生成的任务、制作进度和待验收内容。" extra={<Button type="primary" onClick={() => setChooserOpen(true)} icon={<ImagePlus size={15} />}>新建内容</Button>} />
            <SocialContentHistoryHome onRequestCreate={() => setChooserOpen(true)} onOpenImageProject={task => {
              setLaunch({ creationPath: task.creationPath, materialInput: task.materialIds.length ? 'ready' : 'none', managedMode: 'one_click_managed' });
              setImageTask(task);
              setProductionMode('image');
              setView('workbench');
            }} />
          </main>
        </div>
      )}

      {chooserOpen && <SocialContentLanding onStart={startCreation} onSelectViralReplication={selectViralReplication} onClose={() => setChooserOpen(false)} />}
    </div>
  );
}

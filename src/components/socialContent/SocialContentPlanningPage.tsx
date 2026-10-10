import { useEffect, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { Button } from 'antd';
import LsPageHeader from '../ui/LsPageHeader';
import type { Page } from '../../App';
import SocialContentWorkspace, { type SocialContentCreateRequest } from './SocialContentWorkspace';
import SocialContentLanding, { type SocialContentLaunchOptions } from './SocialContentLanding';
import SocialCreationWorkbench, {
  type SocialCreationWorkbenchSeed,
  type SocialCreationWorkbenchSubmit,
} from './SocialCreationWorkbench';
import SocialContentHistoryHome from './SocialContentHistoryHome';
import { loadSocialContentStage, readSocialContentStage, type SocialContentStageProfile } from '../../lib/socialContentStage';

type PlanningView = 'workbench' | 'creations';

function creationPathFromRequest(request: SocialContentCreateRequest): SocialContentLaunchOptions['creationPath'] {
  return request.creationPath || (request.sourceContext ? 'viral_replication' : 'material_processing');
}

function seedFromRequest(request?: SocialContentCreateRequest | null): SocialCreationWorkbenchSeed | undefined {
  if (!request) return undefined;
  return {
    continueTaskId: request.continueTaskId,
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
    setChooserOpen(false);
    setView('workbench');
  }, [initialCreateRequest]);

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
      continueProjectId: request.draftProjectId,
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
      presenterAssetId: request.presenterAssetId || undefined,
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

  return (
    <div className="h-full min-h-0 bg-ink">
      {view === 'workbench' && launch ? (
        <SocialCreationWorkbench
          key={`${launch.creationPath}:${seed?.referenceTitle || 'new'}`}
          mode={launch.creationPath}
          seed={sourceRequest ? { ...seed, ...seedFromRequest(sourceRequest) } : seed}
          stageProfile={stageProfile || undefined}
          onOpenChooser={() => setChooserOpen(true)}
          onShowCreations={() => setView('creations')}
          onGenerate={startGeneration}
        />
      ) : (
        <div className="h-full min-h-0 overflow-y-auto">
          <main className="mx-auto max-w-[1440px] px-4 py-5 sm:px-8 sm:py-7">
            <LsPageHeader title="我的创作" description="查看正在生成的任务、制作进度和待验收内容。" extra={<Button type="primary" onClick={() => setChooserOpen(true)} icon={<ImagePlus size={15} />}>新建内容</Button>} />
            <SocialContentHistoryHome onRequestCreate={() => setChooserOpen(true)} />
          </main>
        </div>
      )}

      {chooserOpen && <SocialContentLanding onStart={startCreation} onSelectViralReplication={selectViralReplication} onClose={() => setChooserOpen(false)} />}
    </div>
  );
}

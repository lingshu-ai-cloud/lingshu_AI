import { useEffect, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import type { Page } from '../../App';
import SocialContentLanding, { type SocialContentLaunchOptions } from './SocialContentLanding';
import SocialContentWorkspace, { type SocialContentCreateRequest } from './SocialContentWorkspace';
import SocialCreationWorkbench, {
  type SocialCreationWorkbenchSeed,
  type SocialCreationWorkbenchSubmit,
} from './SocialCreationWorkbench';
import SocialContentStageOnboarding from './SocialContentStageOnboarding';
import { loadSocialContentStage, readSocialContentStage, saveSocialContentStage, type SocialContentStageProfile } from '../../lib/socialContentStage';

type PlanningView = 'workbench' | 'creations';

function creationPathFromRequest(request: SocialContentCreateRequest): SocialContentLaunchOptions['creationPath'] {
  return request.creationPath || (request.sourceContext ? 'viral_replication' : 'material_processing');
}

function seedFromRequest(request?: SocialContentCreateRequest | null): SocialCreationWorkbenchSeed | undefined {
  if (!request) return undefined;
  return {
    referenceTitle: request.sourceContext?.referenceTitle,
    referenceThumbnail: request.sourceContext?.referenceThumbnail,
    referenceLinks: request.prefill?.referenceLinks,
    productId: request.prefill?.productId,
    productName: request.prefill?.productName,
  };
}

export default function SocialContentPlanningPage({
  onNavigate,
  onNavigateWithTask,
  taskOnly = false,
  initialCreateRequest,
}: {
  taskOnly?: boolean;
  onNavigate: (page: Page) => void;
  onNavigateWithTask: (page: Page, taskId: string) => void;
  initialCreateRequest?: SocialContentCreateRequest | null;
}) {
  const cachedStage = readSocialContentStage();
  const [view, setView] = useState<PlanningView>(initialCreateRequest ? 'workbench' : 'creations');
  const [chooserOpen, setChooserOpen] = useState(Boolean(cachedStage) && !taskOnly && !initialCreateRequest);
  const [stageOnboardingOpen, setStageOnboardingOpen] = useState(!taskOnly && !cachedStage);
  const [stageSaving, setStageSaving] = useState(false);
  const [stageProfile, setStageProfile] = useState<SocialContentStageProfile | null>(cachedStage);
  const [launch, setLaunch] = useState<SocialContentLaunchOptions | null>(() => initialCreateRequest ? {
    creationPath: creationPathFromRequest(initialCreateRequest),
    materialInput: initialCreateRequest.materialInput || 'ready',
    managedMode: initialCreateRequest.managedMode || 'one_click_managed',
  } : null);
  const [seed, setSeed] = useState<SocialCreationWorkbenchSeed | undefined>(() => seedFromRequest(initialCreateRequest));
  const [quickStartRequest, setQuickStartRequest] = useState<SocialCreationWorkbenchSubmit | null>(null);

  useEffect(() => {
    if (taskOnly) return;
    let active = true;
    void loadSocialContentStage().then((profile) => {
      if (!active) return;
      setStageProfile(profile);
      setStageOnboardingOpen(!profile);
      if (profile && !initialCreateRequest) setChooserOpen(true);
    });
    return () => { active = false; };
  }, [initialCreateRequest, taskOnly]);

  useEffect(() => {
    if (!initialCreateRequest) return;
    setLaunch({
      creationPath: creationPathFromRequest(initialCreateRequest),
      materialInput: initialCreateRequest.materialInput || 'ready',
      managedMode: initialCreateRequest.managedMode || 'one_click_managed',
    });
    setSeed(seedFromRequest(initialCreateRequest));
    setChooserOpen(false);
    setView('workbench');
  }, [initialCreateRequest]);

  const startCreation = (options: SocialContentLaunchOptions) => {
    setLaunch(options);
    setSeed(undefined);
    setChooserOpen(false);
    setView('workbench');
  };

  const startGeneration = (request: SocialCreationWorkbenchSubmit) => {
    setQuickStartRequest(request);
    setView('creations');
  };

  if (taskOnly) {
    return <SocialContentWorkspace onNavigate={onNavigate} onNavigateWithTask={onNavigateWithTask} defaultCreateMode="instant" />;
  }

  return (
    <div className="h-full min-h-0 bg-[#f6f8f5]">
      {view === 'workbench' && launch ? (
        <SocialCreationWorkbench
          key={`${launch.creationPath}:${seed?.referenceTitle || 'new'}`}
          mode={launch.creationPath}
          seed={seed}
          stageProfile={stageProfile || undefined}
          onOpenChooser={() => setChooserOpen(true)}
          onShowCreations={() => setView('creations')}
          onGenerate={startGeneration}
        />
      ) : (
        <div className="h-full min-h-0 overflow-y-auto">
          <main className="mx-auto max-w-[1440px] px-4 py-5 sm:px-8 sm:py-7">
            <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
              <div><p className="text-[10px] font-black uppercase tracking-[0.14em] text-accent">内容制作</p><h1 className="mt-1 text-xl font-black text-text-primary">我的创作</h1><p className="mt-1 text-xs text-text-muted">查看正在生成的任务、制作进度和待验收内容。</p></div>
              <button type="button" onClick={() => setChooserOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#173d31] px-4 py-2.5 text-xs font-black text-white shadow-sm hover:bg-[#245644]"><ImagePlus size={15} />新建内容</button>
            </header>
            <SocialContentWorkspace
              onNavigate={onNavigate}
              onNavigateWithTask={onNavigateWithTask}
              defaultCreateMode="instant"
              quickStartRequest={quickStartRequest}
              onQuickStartSettled={() => setQuickStartRequest(null)}
              onRequestCreate={() => setChooserOpen(true)}
            />
          </main>
        </div>
      )}

      {chooserOpen && <SocialContentLanding onStart={startCreation} onClose={() => setChooserOpen(false)} />}
      {stageOnboardingOpen && <SocialContentStageOnboarding busy={stageSaving} onConfirm={async (id) => { setStageSaving(true); const saved=await saveSocialContentStage(id); setStageProfile(saved.profile); setStageOnboardingOpen(false); setStageSaving(false); if (!initialCreateRequest) setChooserOpen(true); }} />}
    </div>
  );
}

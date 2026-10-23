import { StudioReviewIssueActions, StudioBatchReviewDialog } from './studioLazyPanels.js';
import { salesPresenterRecognition } from '../../../shared/contracts/presenterShotRecognition';
import { fileToDataUrl } from '../../lib/studioFileInputs';
import { Suspense } from 'react';
import { authHeader } from '../../lib/auth';
import { createScriptGapTask } from '../../lib/scriptGapQueue';
import { patchShot } from '../../lib/shotProduction';
import { newDigitalHumanRequirements } from '../../lib/digitalHumanPlan';
import { buildAiProductOptions } from './studioProductSelection.js';
import type { EnterpriseProfileLite } from './studioWorkspaceContracts.js';
import type { StudioShotLibraryViewInputs } from './studioShotLibraryViewInputs.js';

export function renderStudioShotLibrary(input: StudioShotLibraryViewInputs) {
  const {
    batchReviewIssues, batchReviewFrames, storyboardSlots,
    batchReviewReadyShots, batchReviewGeneratingShots, batchReviewPendingShots,
    activeProductionView, aigcBudgetPreview, batchReviewBusy,
    batchShotBusy, storyboardGenerating, batchReviewError,
    renderReadiness, productionFor, sourcePlanFor,
    storyboardTopicFor, presenterEvidenceFor, collectSpec,
    saveStudioProjectVersioned, projectId, projectTitle,
    projectRevisionRef, setProjectId, productionDefaults,
    selectedProductOptions, canRequestShootingFor, batchShotResults,
    productionJobs, productionKey, shotProductions,
    storyboardSourcePlans, activeAssemblyId, setShotProductions,
    setStoryboardSourcePlans, setBatchShotResults, storyboardAssignments,
    setStoryboardAssignments, setProductOptions, refreshMaterials,
    runBatchShotJobs, selectBatchReviewIssue, shootingSlots,
    shootingTasks, activeProductLabel, activeVideoTheme,
    ratio, setShootingTasks, savingProj,
    autosaveInFlightRef, ttsLoading, setBatchReviewError,
    setBatchReviewBusy, saveProject, latestRenderReadinessRef,
    activeSteps, setCanvasView, setStepIdx,
    setBatchReviewOpen,
  } = input;

  return (
    <Suspense fallback={<div role="status" className="p-6 text-sm text-text-secondary">正在打开分镜审核…</div>}><StudioBatchReviewDialog
      issues={batchReviewIssues}
      frames={batchReviewFrames}
      totalShots={storyboardSlots.length}
      readyShots={batchReviewReadyShots}
      generatingShots={batchReviewGeneratingShots}
      pendingShots={batchReviewPendingShots}
      estimatedCostCny={activeProductionView?.aggregate.cost.expectedCny ?? undefined}
      upperBoundCostCny={activeProductionView?.aggregate.cost.upperBoundCny ?? aigcBudgetPreview?.estimatedCostCny}
      busy={batchReviewBusy || batchShotBusy || Object.values(storyboardGenerating).some(Boolean)}
      error={batchReviewError}
      canSubmit={renderReadiness.ready && !batchReviewIssues.length && !batchReviewGeneratingShots}
      submitLabel="进入成片渲染和导出"
      renderIssueActions={issue => {
        const slot = storyboardSlots.find(item => item.id === issue.id);
        if (!slot) return null;
        const shot = productionFor(slot); const plan = sourcePlanFor(slot);
        const isDigital = storyboardTopicFor(slot) === 'presenter' && salesPresenterRecognition(presenterEvidenceFor(slot)) === 'confirmed';
        const missingProductImage = /缺少可读取的图片/.test(issue.detail || '');
        if (!missingProductImage && !(isDigital && ['这一镜还不能提交生成', '数字人方案待确认', '数字人素材待生成', '数字人任务已提交'].includes(issue.question))) return null;
        const saveSpec = async (spec: ReturnType<typeof collectSpec>) => {
          const saved = await saveStudioProjectVersioned({ id: projectId || undefined, title: projectTitle, status: 'draft', spec });
          if (!saved.ok || !saved.project?.id) throw new Error('草稿保存失败，请重试');
          projectRevisionRef.current = saved.project.updatedAt; setProjectId(saved.project.id);
        };
        return <Suspense key={issue.id} fallback={<div role="status" className="p-3 text-xs text-text-muted">正在打开分镜处理项…</div>}><StudioReviewIssueActions digital={isDigital && !missingProductImage}
          requirements={shot.digitalHuman || newDigitalHumanRequirements()} presenterId={shot.presenterId || ''}
          presenters={productionDefaults.presenters} products={selectedProductOptions} productIds={plan.productIds || []}
          allowShooting={canRequestShootingFor(slot.id)}
          busy={batchReviewBusy || batchShotBusy || Boolean(storyboardGenerating[slot.id])}
          submitted={batchShotResults.some(item => item.slotId === slot.id && item.state === 'submitted' && productionJobs.find(job => job.id === item.jobId)?.status !== 'failed')}
          onSaveDigital={async (requirements, presenterId) => {
            if (shot.locked) throw new Error('请先解锁分镜');
            const key = productionKey(slot.id);
            const next = { ...shotProductions, [key]: patchShot(shot, { source: 'avatar', presenterId, contentType: 'enterprise_presenter', digitalHuman: requirements }) };
            const plans = { ...storyboardSourcePlans, [slot.id]: { ...plan, userSource: 'avatar' as const, mode: 'auto' as const, error: '', confirmed: false } };
            const spec = collectSpec(); await saveSpec({ ...spec, shotProductions: next, storyboardSourcePlans: plans,
              storyboardAssemblies: spec.storyboardAssemblies.map(item => item.id === activeAssemblyId ? { ...item, sourcePlans: plans } : item) });
            setShotProductions(next); setStoryboardSourcePlans(plans);
            setBatchShotResults(current => current.filter(item => item.slotId !== slot.id));
          }}
          onSaveProducts={async ids => {
            if (shot.locked) throw new Error('请先解锁分镜');
            const next = { ...storyboardSourcePlans, [slot.id]: { ...plan, productIds: ids,
                firstFrameMaterialId: undefined, firstFrameUrl: undefined, firstFrameRequestId: undefined,
                firstFrameFingerprint: undefined, firstFrameConfirmed: false, generatedClipId: undefined, quality: undefined, confirmed: false } };
            const spec = collectSpec(); await saveSpec({ ...spec, storyboardSourcePlans: next,
              storyboardAssemblies: spec.storyboardAssemblies.map(item => item.id === activeAssemblyId ? { ...item, sourcePlans: next } : item) });
            setStoryboardSourcePlans(next);
          }}
          onChangeType={async topic => {
            if (shot.locked) throw new Error('请先解锁分镜');
            const next = { ...storyboardSourcePlans, [slot.id]: { ...plan, shotTopic: topic, userSource: undefined, mode: 'ai' as const,
                sceneType: topic === 'factory' ? 'factory' as const : topic === 'product' ? 'product' as const : 'usage' as const,
                productIds: undefined, firstFrameMaterialId: undefined, firstFrameUrl: undefined, firstFrameRequestId: undefined,
                firstFrameConfirmed: false, generatedClipId: undefined, quality: undefined, confirmed: false, error: '' } };
            const assignments = { ...storyboardAssignments }; delete assignments[slot.id];
            const productions = { ...shotProductions, [productionKey(slot.id)]: patchShot(shot, { source: 'ai', adoptedId: undefined, candidates: [] }) };
            const spec = collectSpec(); await saveSpec({ ...spec, storyboardSourcePlans: next, storyboardAssignments: assignments, shotProductions: productions,
              storyboardAssemblies: spec.storyboardAssemblies.map(item => item.id === activeAssemblyId ? { ...item, sourcePlans: next, assignments } : item) });
            setStoryboardAssignments(assignments); setShotProductions(productions);
            setStoryboardSourcePlans(next); setBatchShotResults(current => current.filter(item => item.slotId !== slot.id));
          }}
          onUpload={async (productId, file) => {
            if (!file.type.startsWith('image/')) throw new Error('请选择产品图片');
            const profileResponse = await fetch('/api/overseas/enterprise/profile', { headers: authHeader(), credentials: 'same-origin' });
            if (!profileResponse.ok) throw new Error('无法读取企业产品');
            const profile = await profileResponse.json() as EnterpriseProfileLite & { factVersion?: { contentHash?: string; id?: string } };
            const index = buildAiProductOptions(profile).findIndex(item => item.id === productId);
            const product = selectedProductOptions.find(item => item.id === productId);
            const rawIndex = profile.products?.items?.findIndex((item, i) => `product-${i}-${String(item.name || '').trim()}` === productId) ?? -1;
            if (index < 0 || rawIndex < 0 || !product) throw new Error('产品资料已变化，请刷新后重试');
            const response = await fetch('/api/overseas/enterprise/assets', { method: 'POST', credentials: 'same-origin',
              headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, type: file.type, dataUrl: await fileToDataUrl(file) }) });
            const asset = await response.json(); if (!response.ok || !asset.url) throw new Error(asset.error || '图片上传失败');
            const items = profile.products!.items!.map((item, i) => i === rawIndex ? { ...item, images: [...(item.images || []), { name: asset.name, url: asset.url }] } : item);
            const saved = await fetch('/api/overseas/enterprise/profile', { method: 'PATCH', credentials: 'same-origin',
              headers: { ...authHeader(), 'Content-Type': 'application/json', ...(profile.factVersion?.contentHash || profile.factVersion?.id ? { 'If-Match': profile.factVersion.contentHash || profile.factVersion.id! } : {}) },
              body: JSON.stringify({ products: { ...profile.products, items } }) });
            const result = await saved.json(); if (!saved.ok || !result.ok) throw new Error(result.message || '产品图片绑定失败，请重试');
            const options = buildAiProductOptions(result.profile);
            setProductOptions(current => current.map(item => options.find(option => option.id === item.id) || item));
            await refreshMaterials();
          }} onAction={async action => {
            if (action === 'generate-digital') { await runBatchShotJobs([slot.id]); return; }
            if (action !== 'shoot') { selectBatchReviewIssue(slot.id, action); return; }
            if (!canRequestShootingFor(slot.id)) throw new Error('当前服务端生产方案未开放实拍兜底');
            if (shot.locked) throw new Error('请先解锁分镜');
            const bound = shootingSlots.find(item => item.slotId === slot.id);
            if (!bound) throw new Error('该分镜尚无补拍需求，请打开分镜配置');
            const existing = shootingTasks.find(task => task.sourceProjectId === projectId && task.sourceAssemblyId === activeAssemblyId && task.sourceShotId === bound.id && task.requirements === bound.requirements);
            if (existing) return;
            const next = { ...storyboardSourcePlans, [slot.id]: { ...plan, userSource: 'shoot' as const, mode: 'auto' as const, decided: true, confirmed: false } };
            const assignments = { ...storyboardAssignments }; delete assignments[slot.id];
            const spec = collectSpec();
            const saved = await saveStudioProjectVersioned({ id: projectId || undefined, title: projectTitle, status: 'draft',
              spec: { ...spec, storyboardSourcePlans: next, storyboardAssignments: assignments,
                storyboardAssemblies: spec.storyboardAssemblies.map(item => item.id === activeAssemblyId ? { ...item, sourcePlans: next, assignments } : item) } });
            if (!saved.ok || !saved.project?.id) throw new Error('草稿保存失败，未创建补拍任务');
            projectRevisionRef.current = saved.project.updatedAt; setProjectId(saved.project.id);
            setStoryboardSourcePlans(next); setStoryboardAssignments(assignments);
            const task = await createScriptGapTask({ title: `分镜 ${issue.shotNumber} 补拍`, productLabel: activeProductLabel || '当前产品',
              themeTitle: activeVideoTheme.title, shotBrief: bound.requirements || slot.title, suggestedDurationSec: bound.duration, ratio,
              sourceProjectId: saved.project.id, sourceStoryboardSlotId: slot.id, sourceShotId: bound.id, sourceAssemblyId: activeAssemblyId,
              requirements: bound.requirements, soundMode: shot.sound, expectedNarration: shot.narration });
            setShootingTasks(current => [task, ...current.filter(item => item.id !== task.id)]);
          }} /></Suspense>;
      }}
      onSelectIssueOption={selectBatchReviewIssue}
      onSubmit={() => void (async () => {
        if (!renderReadiness.ready || batchReviewIssues.length || batchReviewGeneratingShots) return;
        if (savingProj || autosaveInFlightRef.current || ttsLoading) { setBatchReviewError('草稿或配音仍在处理中，请稍后进入下一步。'); return; }
        setBatchReviewBusy(true); setBatchReviewError('');
        try {
          if (!await saveProject('draft')) throw new Error('草稿尚未保存成功，请稍后重试。');
          if (!latestRenderReadinessRef.current.ready) throw new Error('保存期间素材状态发生变化，请完成待处理卡片后再进入成片。');
          const previewIndex = activeSteps.findIndex(item => item.id === 'preview');
          if (previewIndex < 0) throw new Error('成片页面尚未准备好，请重试。');
          setCanvasView('creation'); setStepIdx(previewIndex); setBatchReviewOpen(false);
        } catch (error) { setBatchReviewError(error instanceof Error ? error.message : '进入成片页面失败，请重试。'); }
        finally { setBatchReviewBusy(false); }
      })()}
      onClose={() => setBatchReviewOpen(false)}
    /></Suspense>
  );
}

import { ShotProductionPanel } from './studioLazyPanels.js';
import { presenterApi } from '../../lib/presenterApi';
import { salesPresenterRecognition } from '../../../shared/contracts/presenterShotRecognition';
import { mediaType } from '../../lib/studioFileInputs';
import { Suspense } from 'react';
import { studioApi } from '../../lib/studioApi';
import { applyDefaultsToUnlockedAvatarShots, patchShot, presenterCapabilities, recommendShot } from '../../lib/shotProduction';
import { productionApi } from '../../lib/productionApi';
import { storyboardSlotScript } from './studioStoryboardMaterialMatching';
import { newDigitalHumanRequirements } from '../../lib/digitalHumanPlan';
import { shotKeyframeCues } from '../../lib/shotKeyframes';
import { resolveStudioSocialShot } from '../../lib/studioSocialShotIdentity';
import type { StudioProductionEditorViewInputs } from './studioProductionEditorViewInputs.js';

export function renderStudioProductionEditor(input: StudioProductionEditorViewInputs) {
  const {
    projectId, activeAssemblyId, activeVoiceLang,
    lang, productionFor, productionEditorSlot,
    shootingSlots, alignedCuesByLang, voiceoverAudios,
    shotProductionContext, storyboardSlots, canRequestShootingFor,
    productionDefaults, materials, selectedProductOptions,
    productionJobs, productionKey, productionPlans,
    productionFingerprint, socialDigitalHumanPlans, productionExecutions,
    productionSentenceResults, productionRefreshingIds, materialById,
    storyboardAssignments, appearancePreference, productionError,
    digitalHumanNotice, productionBusy, productionCapability,
    seedanceSentenceReadiness, socialViralTask, applyDigitalToSales,
    setApplyDigitalToSales, setShotProductions, storyboardSourcePlans,
    presenterEvidenceFor, setProductionError, setProductionEditorId,
    setDigitalHumanNotice, applyProductionNarration, setProductionDefaults,
    refreshMaterials, saveProductionPlan, prepareProductionSentenceFrames,
    generateProductionSentenceDrafts, runProductionSentenceReplication, pendingPhotoSentenceJob,
    resumeProductionSentenceReplication, reprocessProductionSentenceReplication, reviewProductionSentenceCue,
    retryProductionFailedSentenceCues, generateProductionAvatar, generateStoryboardShot,
    sourcePlanFor, setShootingError, setShootingSlotId,
    setShotLibrarySlotId, adoptProductionCandidate, refreshProductionJob,
    refreshReferenceProduction, cancelReferenceProduction, reconcileProductionCost,
    setProductionExecutions,
  } = input;

  return (
    <Suspense fallback={<div role="status" className="p-6 text-sm text-text-secondary">正在打开镜头制作…</div>}>
      <ShotProductionPanel
        projectId={projectId || undefined}
        assemblyId={activeAssemblyId}
        language={activeVoiceLang || lang}
        shot={productionFor(productionEditorSlot)}
        shotId={shootingSlots.find(item => item.slotId === productionEditorSlot.id)?.id || productionEditorSlot.id}
        scriptNarration={storyboardSlotScript(productionEditorSlot.detail).voice}
        shotDuration={Math.max(0.001, productionEditorSlot.end - productionEditorSlot.start)}
        keyframeCues={shotKeyframeCues({ shotStart: productionEditorSlot.start, shotEnd: productionEditorSlot.end,
          cues: alignedCuesByLang[activeVoiceLang] || voiceoverAudios[activeVoiceLang]?.cues || [],
          fallbackText: productionFor(productionEditorSlot).narration })}
        context={shotProductionContext}
        title={`分镜 ${storyboardSlots.findIndex(item => item.id === productionEditorSlot.id) + 1}`}
        allowShooting={canRequestShootingFor(productionEditorSlot.id)}
        defaults={productionDefaults}
        materials={materials}
        products={selectedProductOptions.map(item => ({ id: item.id, label: item.label }))}
        jobs={productionJobs.filter(job => job.projectId === projectId && `${job.assemblyId}:${job.shotId}` === productionKey(productionEditorSlot.id))}
        savedPlan={productionPlans.find(item => item.projectId === projectId && `${item.assemblyId}:${item.shotId}` === productionKey(productionEditorSlot.id)
          && item.fingerprint === productionFingerprint(productionEditorSlot)
          && item.presenterAssetVersion === Math.max(1, productionDefaults.presenters.find(presenter => presenter.id === productionFor(productionEditorSlot).presenterId)?.assetVersion || 1))}
        sourcePlan={socialDigitalHumanPlans.find(item =>
          resolveStudioSocialShot(storyboardSlots, item)?.id === productionEditorSlot.id)}
        executions={productionExecutions.filter(item => `${item.assemblyId}:${item.shotId}` === productionKey(productionEditorSlot.id)
          && item.fingerprint === productionFingerprint(productionEditorSlot)
          && item.presenterAssetVersion === Math.max(1, productionDefaults.presenters.find(presenter => presenter.id === productionFor(productionEditorSlot).presenterId)?.assetVersion || 1))}
        sentenceResult={productionSentenceResults[productionExecutions.filter(item => `${item.assemblyId}:${item.shotId}` === productionKey(productionEditorSlot.id)
          && item.fingerprint === productionFingerprint(productionEditorSlot)
          && item.provider.startsWith('sentence_first_frame')).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]?.jobId || '']}
        refreshingJobIds={productionRefreshingIds}
        preview={materialById.get(storyboardAssignments[productionEditorSlot.id] || '')}
        reason={recommendShot({ detail: productionEditorSlot.detail, preference: appearancePreference || productionDefaults.preference, locked: productionFor(productionEditorSlot).locked, hasMaterial: Boolean(storyboardAssignments[productionEditorSlot.id]), hasPresenter: productionDefaults.presenters.length > 0 }).reason}
        error={productionError || digitalHumanNotice}
        busy={productionBusy}
        configured={productionCapability.configured}
        capabilityReason={productionCapability.reason}
        toolCapabilities={productionCapability.tools}
        costPerSecond={productionCapability.costPerSecond}
        maxAttemptsPerShot={productionCapability.maxAttemptsPerShot}
        seedanceSentenceAvailable={seedanceSentenceReadiness.ready}
        salesConfiguration={socialViralTask || productionFor(productionEditorSlot).contentType === 'enterprise_presenter'}
        viralReplication={socialViralTask}
        applyToSales={applyDigitalToSales}
        onApplyToSalesChange={socialViralTask ? setApplyDigitalToSales : undefined}
        onChange={patch => {
          try {
            const key = productionKey(productionEditorSlot.id);
            setShotProductions(current => {
              const next = { ...current, [key]: patchShot(current[key] || productionFor(productionEditorSlot), patch) };
              if (socialViralTask && applyDigitalToSales && (patch.presenterId !== undefined || patch.digitalHuman)) {
                for (const slot of storyboardSlots) {
                  if (slot.id === productionEditorSlot.id || productionFor(slot).locked || ['material', 'shoot'].includes(storyboardSourcePlans[slot.id]?.userSource || '') || (salesPresenterRecognition(presenterEvidenceFor(slot)) !== 'confirmed' && storyboardSourcePlans[slot.id]?.userSource !== 'avatar')) continue;
                  const slotKey = productionKey(slot.id); const previous = current[slotKey] || productionFor(slot);
                  const digitalHuman = patch.digitalHuman ? { ...(previous.digitalHuman || newDigitalHumanRequirements()), presenterMode: patch.digitalHuman.presenterMode, workflow: patch.digitalHuman.workflow, replicationMode: patch.digitalHuman.replicationMode, presenterSelected: patch.digitalHuman.presenterSelected, replacementScope: patch.digitalHuman.replacementScope, scene: patch.digitalHuman.scene, action: patch.digitalHuman.action, preserve: patch.digitalHuman.preserve, targetEffect: patch.digitalHuman.targetEffect, method: patch.digitalHuman.method, preferredProvider: patch.digitalHuman.preferredProvider, contentConfirmed: patch.digitalHuman.contentConfirmed } : previous.digitalHuman;
                  next[slotKey] = patchShot(previous, { ...(patch.presenterId !== undefined ? { presenterId: patch.presenterId } : {}), digitalHuman });
                }
              }
              return next;
            });
            setProductionError('');
          } catch (error) { setProductionError(error instanceof Error ? error.message : '镜头设置更新失败'); }
        }}
        onClose={() => { setProductionEditorId(''); setProductionError(''); setDigitalHumanNotice(''); }}
        onNarration={applyProductionNarration}
        onDefaults={async value => { const saved = await productionApi.saveDefaults(value); setProductionDefaults(saved); }}
        onEnrollArkPresenter={async input => {
          const existing=productionDefaults.presenters.find(item=>item.id===input.presenterId);
          if(input.presenterId&&!existing)throw new Error('人物资料已变化，请刷新后重试');
          if(!existing&&!input.name.trim())throw new Error('请填写人物名称');
          const upload=async(file:File,type:'image'|'video')=>(await productionApi.uploadArkMaterial(file,type)).id;
          const photoMaterialId=input.photo?await upload(input.photo,'image'):input.photoMaterialId||'';
          const videoMaterialId=input.video?await upload(input.video,'video'):input.videoMaterialId||'';
          if(!photoMaterialId||!videoMaterialId)throw new Error('请上传或选择本人视频和正面照片');
          const presenterId=existing?.id||crypto.randomUUID();
          const updated:import('../../lib/shotProduction').PresenterAsset=existing?{...existing,referenceMaterialIds:[...new Set([...(existing.referenceMaterialIds||[]),photoMaterialId,videoMaterialId])]}:{id:presenterId,name:input.name.trim(),avatarId:'',voiceId:'',authorized:true,supportsAlpha:false,referenceMaterialIds:[photoMaterialId,videoMaterialId]};
          const saved=await productionApi.saveDefaults({...productionDefaults,presenters:existing?productionDefaults.presenters.map(item=>item.id===presenterId?updated:item):[...productionDefaults.presenters,updated],defaultPresenterId:productionDefaults.defaultPresenterId||presenterId});
          setProductionDefaults(saved);
          await refreshMaterials();
          return productionApi.startArkEnrollment({requestId:input.requestId,presenterId,photoMaterialId,videoMaterialId,subjectAdultConfirmed:true,arkProcessingAuthorized:true});
        }}
        onPresenterAssetsChanged={async()=>{setProductionDefaults(await productionApi.defaults());await refreshMaterials();}}
        onCreatePresenter={async input => {
          const existing = input.presenterId ? productionDefaults.presenters.find(item => item.id === input.presenterId) : undefined;
          if (input.presenterId && !existing) throw new Error('当前人物资产已变化，请刷新后重试');
          const mediaType = input.file.type.startsWith('video/') ? 'video' : input.file.type.startsWith('image/') ? 'image' : null;
          if (!mediaType) throw new Error('请选择人物图片或视频');
          const presenterCapabilities = mediaType === 'image' ? await presenterApi.capabilities() : undefined;
          const uploaded = presenterCapabilities?.localPhotoUpload ? await presenterApi.uploadPhotoMaterial(input.file, input.name) : await studioApi.uploadMaterialFile(input.file,{folder:'presenter',type:mediaType,sourceType:'presenter-inline-upload'});
          if(!uploaded.ok||!uploaded.material?.id)throw new Error(uploaded.error||'人物资产上传失败');
          const presenterId=existing?.id||crypto.randomUUID();const now=new Date().toISOString();
          const presenter:import('../../lib/shotProduction').PresenterAsset=existing?{...existing,referenceMaterialIds:[...new Set([...(existing.referenceMaterialIds||[]),uploaded.material.id])],authorizationConfirmation:{...existing.authorizationConfirmation,subjectAdultConfirmed:input.subjectAdultConfirmed,arkProcessingAuthorized:input.arkProcessingAuthorized||existing.authorizationConfirmation?.arkProcessingAuthorized,heygenProcessingAuthorized:input.heygenProcessingAuthorized||existing.authorizationConfirmation?.heygenProcessingAuthorized}}:{id:presenterId,name:input.name.trim(),avatarId:'',voiceId:'',authorized:true,supportsAlpha:false,referenceMaterialIds:[uploaded.material.id],authorizationConfirmation:{subjectAdultConfirmed:input.subjectAdultConfirmed,arkProcessingAuthorized:input.arkProcessingAuthorized,heygenProcessingAuthorized:input.heygenProcessingAuthorized},arkCertification:{projectName:'default',assetUri:input.arkAssetUri||'',assetType:input.arkAssetUri?mediaType:'',status:input.arkActiveConfirmed?'active':'ark_pending',materialId:uploaded.material.id,...(input.arkActiveConfirmed?{syncedAt:now,verificationSource:'manual_console' as const}:{})}};
          const saved=await productionApi.saveDefaults({...productionDefaults,presenters:existing?productionDefaults.presenters.map(item=>item.id===presenterId?presenter:item):[...productionDefaults.presenters,presenter],defaultPresenterId:productionDefaults.defaultPresenterId||presenterId});
          setProductionDefaults(saved);await refreshMaterials();const created=saved.presenters.find(item=>item.id===presenterId);if(!created)throw new Error('人物已上传，但企业人物回填失败，请刷新后检查原任务');return created;
        }}
        onApplyDefaultsToUnlocked={() => {
          setShotProductions(current => applyDefaultsToUnlockedAvatarShots(current, activeAssemblyId, productionDefaults));
          setDigitalHumanNotice('已将企业默认人物、声音和布局应用到当前视频全部未锁定数字人分镜；人物变化的镜头需要重新确认内容。');
        }}
        onSavePlan={() => void saveProductionPlan()}
        onPrepareSentenceFrames={() => void prepareProductionSentenceFrames()}
        onPreparePhotoFrames={maxCostCny => void prepareProductionSentenceFrames(true, maxCostCny)}
        onGenerateSentenceDrafts={()=>void generateProductionSentenceDrafts()}
        onRunSentenceReplication={maxCostCny => void runProductionSentenceReplication(maxCostCny)}
        pendingPhotoSentenceJob={Boolean(pendingPhotoSentenceJob && pendingPhotoSentenceJob.shotKey === productionKey(productionEditorSlot.id))}
        onResumeSentenceReplication={maxCostCny => void resumeProductionSentenceReplication(maxCostCny)}
        onReprocessSentenceReplication={maxCostCny => void reprocessProductionSentenceReplication(maxCostCny)}
        onReviewSentenceCue={(cueId,decisions,evidence)=>void reviewProductionSentenceCue(cueId,decisions,evidence)}
        onRetryFailedSentenceCues={()=>void retryProductionFailedSentenceCues()}
        onGenerate={() => void generateProductionAvatar()}
        onAi={() => { setProductionEditorId(''); void generateStoryboardShot(productionEditorSlot, { ...sourcePlanFor(productionEditorSlot), mode: 'ai', decided: true, confirmed: false }); }}
        onShoot={() => { setProductionEditorId(''); setShootingError(''); setShootingSlotId(productionEditorSlot.id); }}
        onMaterial={() => { setShotLibrarySlotId(productionEditorSlot.id); setProductionEditorId(''); }}
        aiCandidateApproved={materialId => { const plan = sourcePlanFor(productionEditorSlot); return plan.generatedClipId === materialId && plan.quality?.passed === true && !plan.qualityError; }}
        onAdopt={id => void adoptProductionCandidate(id)}
        onRefresh={id => void refreshProductionJob(id)}
        onRefreshExecution={id => void refreshReferenceProduction(id)}
        onCancelExecution={id => void cancelReferenceProduction(id)}
        onReconcileExecutionCost={id => void reconcileProductionCost(id)}
        onReviewExecution={async (id, decisionsByKey, feedback = '') => {
          try {
            const execution = productionExecutions.find(item => item.id === id);
            if (!execution) return;
            const pending = execution.quality.checks.filter(check => check.mode === 'manual' && check.status === 'pending');
            if (!pending.length || pending.some(check => decisionsByKey[check.key] === undefined)) throw new Error('请逐项完成全部人工验收');
            if (pending.some(check => decisionsByKey[check.key] === false) && !feedback.trim()) throw new Error('存在未通过项目时必须填写具体修改意见');
            const decisions = Object.fromEntries(pending.map(check => [check.key, {
              passed: decisionsByKey[check.key],
              evidence: decisionsByKey[check.key] ? `用户在分镜候选预览中逐项确认通过${feedback.trim() ? `：${feedback.trim()}` : ''}` : `用户修改意见：${feedback.trim()}`,
            }]));
            const reviewed = await productionApi.reviewExecutionQuality(id, decisions, feedback);
            setProductionExecutions(current => [reviewed, ...current.filter(item => item.id !== reviewed.id)]);
          } catch (error) { setProductionError(error instanceof Error ? error.message : '人工验收保存失败'); }
        }}
      />
    </Suspense>
  );
}

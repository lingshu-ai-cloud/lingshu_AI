import type {SocialAssetInventory,SocialAssetSupplyShotRequest} from './socialContentAssetSupply';
import type {BenchmarkMaterialType} from './benchmarkAnalysis';
import {normalizeSceneVisualContract,type SocialSceneVisualContract} from './sceneVisualContract';
import type {SocialMaterialRouting,SocialProductSceneReplicationSpec,SocialShotSourceStrategy} from './contracts/socialContentReplication';

export function affirmativeSocialMaterialDescription(description:string|null|undefined){
 const positive=(description??'').split(/须避免[:：]?|负面提示[:：]?|negative\s*prompt[:：]?|\bavoid[:：]?/i,1)[0]??'';
 return positive.split(/[；;。,.，\n]/).filter(clause=>!/禁止|不得|不能|没有|未见|不含|不出现|避免|\b(?:exclude|no|not|without|never)\b/i.test(clause)).join('；');
}
export function explicitSocialPresenterRequest(description:string){
 const direct=/(?:avatar|数字人).{0,32}(?:talking|speaking|口播|说话)|(?:talking|speaking).{0,32}(?:avatar|数字人)|对镜.{0,12}(?:speaking|说话|口播)|(?:talking|speaking)\s+(?:to|at)\s+(?:the\s+)?camera/i.test(description);
 return direct||/digital\s+twin|数字分身/i.test(description)&&/hook|口播|主讲|说话|talking|speaking|speaker|presenter/i.test(description);
}

/** Free edit routes may keep a trusted match window without enabling generation. */
export function selectVerifiedSocialMaterialSegment(shot:SocialAssetSupplyShotRequest,sourceRefs:string[]){
 const match=shot.localVideoMatch,segment=shot.selectedMaterialSegment;
 if(!segment||match?.semanticMatch!=='verified'||!match.evidenceRef?.trim()||!match.sourceRefs.length||!match.sourceRefs.every(ref=>sourceRefs.includes(ref)))return undefined;
 const requested=String(shot.productRef||shot.visualContract?.product.requestedProductRef||'').normalize('NFKC').trim().toLocaleLowerCase();
 if(shot.materialType==='product'&&requested&&String(match.productRef||'').normalize('NFKC').trim().toLocaleLowerCase()!==requested)return undefined;
 if(!match.sourceRefs.includes(segment.sourceRef)||!segment.segmentId?.trim()||!Number.isFinite(segment.startSeconds)||!Number.isFinite(segment.endSeconds)||segment.startSeconds<0||segment.endSeconds<=segment.startSeconds)throw Error(`material_local_match_segment_invalid:${shot.shotId}`);
 return structuredClone(segment);
}

/** Only explicit new plans call this selector; existing frozen jobs retain their routing. */
export function selectTypeAwareSocialMaterial(input:{shot:SocialAssetSupplyShotRequest;inventory:Required<SocialAssetInventory>;materialType:BenchmarkMaterialType;referenceVisualContract?:SocialSceneVisualContract;presenterRefs:string[];buildProductSpec:()=>SocialProductSceneReplicationSpec}):{strategy:SocialShotSourceStrategy;refs:string[];instruction:string;materialRouting:SocialMaterialRouting;productSceneReplication?:SocialProductSceneReplicationSpec;blocked?:boolean}{
const {shot,inventory,materialType,referenceVisualContract,presenterRefs,buildProductSpec}=input;
      const visible = new Set([...inventory.customerVideoIds,...inventory.factoryEvidenceAssetIds,...inventory.customerCaseEvidenceAssetIds,...inventory.productEffectEvidenceAssetIds]);
      const visual=normalizeSceneVisualContract(shot.visualContract??referenceVisualContract??{productPolicy:shot.productPolicy,productRef:shot.productRef});
      const match = shot.localVideoMatch, requestedProduct = String(visual.product.requestedProductRef || visual.productUsage.productRef || shot.productRef || '').normalize('NFKC').trim().toLocaleLowerCase();
      const verified = match?.semanticMatch === 'verified' && Boolean(match.evidenceRef?.trim())
        && match.sourceRefs.length > 0 && match.sourceRefs.every(ref=>visible.has(ref))
        && (materialType !== 'product' || !requestedProduct || String(match.productRef||'').normalize('NFKC').trim().toLocaleLowerCase() === requestedProduct);
      const refs = verified ? [...new Set(match.sourceRefs)] : [];
      const segment=shot.selectedMaterialSegment;
      if(verified&&segment&&(!refs.includes(segment.sourceRef)||!segment.segmentId?.trim()||!Number.isFinite(segment.startSeconds)||!Number.isFinite(segment.endSeconds)||segment.startSeconds<0||segment.endSeconds<=segment.startSeconds))throw Error(`material_local_match_segment_invalid:${shot.shotId}`);
      const materialRouting: SocialMaterialRouting = {schemaVersion:'social-material-routing.v1',materialType,
        policy: materialType === 'talking_head' ? 'authorized_presenter' : materialType === 'product' ? 'local_first_product_i2v' : 'local_only',
        localMatch:{state:verified?'matched':'missing',sourceRefs:refs,evidenceRef:verified?match!.evidenceRef.trim():null}};
      if (materialType === 'talking_head') return {strategy:'authorized_digital_presenter',refs:presenterRefs,materialRouting,
        instruction:'真人口播使用当前账号授权数字人视频，锁定人物、声音与明确口播文案；能力缺失时停止，不用库存人物或图文替代。'};
      if (refs.length) return {strategy:'customer_real_asset',refs,materialRouting,
        instruction:'按当前镜头语义采用已匹配的本地真实视频；保持原主体及产品事实，不调用画面生成，匹配失败必须停止并保留缺口。'};
      if (materialType !== 'product') return {strategy:'customer_real_asset',refs:[],materialRouting,blocked:true,
        instruction:materialType==='factory'?'工厂镜头仅匹配本地真实工厂素材；无合格片段时停止，不生成虚构工厂。':materialType==='consumer_demo'?'consumer_demo 仅匹配本地真实消费者使用或生活场景；缺口停止，不生成消费者场景或改成数字人口播。':'素材类型或镜头语义未明确，仅允许合格本地匹配；缺口停止，不因账号有产品图或人物资产擅自改走生成。'};
      const spec=buildProductSpec();
      const shortSource=shot.materialRouting?.generation?.durationOrigin==='default_short_shot' && shot.materialRouting.generation.durationSeconds===3 && spec.cameraLock.durationSeconds===3;
      if(shot.productSceneReplication&&!shortSource&&shot.plannedDurationSeconds!==undefined&&(!Number.isFinite(shot.plannedDurationSeconds)||Math.abs(shot.plannedDurationSeconds-spec.cameraLock.durationSeconds)>0.000001))throw Error(`material_frozen_duration_changed:${shot.shotId}`);
      if(!shot.productSceneReplication){if(shot.plannedDurationSeconds!==undefined&&(!Number.isFinite(shot.plannedDurationSeconds)||shot.plannedDurationSeconds<=0))throw Error(`material_planned_duration_invalid:${shot.shotId}`);spec.cameraLock.durationSeconds=shot.plannedDurationSeconds??3;}
      const productImageRefs=[...new Set(spec.productIdentity.groups.flatMap(group=>group.referenceImageIds))];
      // Original pixels remain disabled by default. A previously frozen exact
      // replacement route represents a separately persisted task-level rights
      // decision and must survive plan refresh; the runtime independently
      // verifies the matching immutable handoff before reading any pixels.
      const exactReplacement=shot.materialRouting?.generation?.method==='reference_first_frame_product_replacement_i2v';
      const method=exactReplacement?'reference_first_frame_product_replacement_i2v' as const:'enterprise_authored_product_first_frame_i2v' as const;
      materialRouting.generation={...(shot.materialRouting?.generation ? {videoProvider:shot.materialRouting.generation.videoProvider,videoModel:shot.materialRouting.generation.videoModel,qaModel:shot.materialRouting.generation.qaModel}:{videoProvider:'wan' as const,videoModel:'wan2.6-i2v-flash' as const,qaModel:'qwen3-vl-plus' as const}),method,...(exactReplacement?{}:{firstFrameOrigin:'enterprise_authored_storyboard' as const}),durationSeconds:spec.cameraLock.durationSeconds,durationOrigin:shortSource?'default_short_shot':shot.productSceneReplication?'explicit_frozen':shot.plannedDurationSeconds!==undefined?'planned_timeline':'default_short_shot',productImageRefs,referenceShotId:spec.referenceShotId,referenceSourceId:spec.referenceSourceId??null};
      return {strategy:'aigc_product_scene_replication',refs:productImageRefs,materialRouting,productSceneReplication:spec,blocked:!productImageRefs.length,
        instruction:'先按镜头语义匹配本地真实产品视频；无合格片段时，用企业知识库对应实际产品图替换参考分镜首帧中的产品，再图生视频，默认3秒短镜头。保持实物标签、结构与事实；参考像素与产品素材用途权利未通过时停止，不直生、不用图片缩放替代。'};
}

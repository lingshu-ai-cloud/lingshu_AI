import type {SocialAssetInventory,SocialAssetSupplyShotRequest} from './socialContentAssetSupply';
import type {BenchmarkMaterialType} from './benchmarkAnalysis';
import {normalizeSceneVisualContract,type SocialSceneVisualContract} from './sceneVisualContract';
import type {SocialMaterialRouting,SocialProductSceneReplicationSpec,SocialShotSourceStrategy} from './contracts/socialContentReplication';

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
      if(!shot.productSceneReplication)spec.cameraLock.durationSeconds=3;
      const productImageRefs=[...new Set(spec.productIdentity.groups.flatMap(group=>group.referenceImageIds))];
      materialRouting.generation={method:'reference_first_frame_product_replacement_i2v',durationSeconds:spec.cameraLock.durationSeconds,productImageRefs,referenceShotId:spec.referenceShotId,referenceSourceId:spec.referenceSourceId??null};
      return {strategy:'aigc_product_scene_replication',refs:productImageRefs,materialRouting,productSceneReplication:spec,blocked:!productImageRefs.length,
        instruction:'先按镜头语义匹配本地真实产品视频；无合格片段时，用企业知识库对应实际产品图替换参考分镜首帧中的产品，再图生视频，默认3秒短镜头。保持实物标签、结构与事实；参考像素与产品素材用途权利未通过时停止，不直生、不用图片缩放替代。'};
}

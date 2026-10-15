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
 if(shot.materialType==='product'&&requested&&!['product_local','factory_local','other_local'].includes(String(match.sourceTier||''))
   &&String(match.productRef||'').normalize('NFKC').trim().toLocaleLowerCase()!==requested)return undefined;
 if(!match.sourceRefs.includes(segment.sourceRef)||!segment.segmentId?.trim()||!Number.isFinite(segment.startSeconds)||!Number.isFinite(segment.endSeconds)||segment.startSeconds<0||segment.endSeconds<=segment.startSeconds)throw Error(`material_local_match_segment_invalid:${shot.shotId}`);
 return structuredClone(segment);
}

/** Only explicit new plans call this selector; existing frozen jobs retain their routing. */
export function selectTypeAwareSocialMaterial(input:{shot:SocialAssetSupplyShotRequest;inventory:Required<SocialAssetInventory>;materialType:BenchmarkMaterialType;referenceVisualContract?:SocialSceneVisualContract;presenterRefs:string[];buildProductSpec:()=>SocialProductSceneReplicationSpec}):{strategy:SocialShotSourceStrategy;refs:string[];instruction:string;materialRouting:SocialMaterialRouting;productSceneReplication?:SocialProductSceneReplicationSpec;blocked?:boolean}{
const {shot,inventory,materialType,referenceVisualContract,presenterRefs}=input;
      const visible = new Set([...inventory.customerVideoIds,...inventory.factoryEvidenceAssetIds,...inventory.customerCaseEvidenceAssetIds,...inventory.productEffectEvidenceAssetIds]);
      const visual=normalizeSceneVisualContract(shot.visualContract??referenceVisualContract??{productPolicy:shot.productPolicy,productRef:shot.productRef});
      const match = shot.localVideoMatch, requestedProduct = String(visual.product.requestedProductRef || visual.productUsage.productRef || shot.productRef || '').normalize('NFKC').trim().toLocaleLowerCase();
      const verified = match?.semanticMatch === 'verified' && Boolean(match.evidenceRef?.trim())
        && match.sourceRefs.length > 0 && match.sourceRefs.every(ref=>visible.has(ref))
        && (materialType !== 'product' || !requestedProduct || ['product_local','factory_local','other_local'].includes(String(match.sourceTier||''))
          || String(match.productRef||'').normalize('NFKC').trim().toLocaleLowerCase() === requestedProduct);
      const refs = verified ? [...new Set(match.sourceRefs)] : [];
      const segment=shot.selectedMaterialSegment;
      if(shot.plannedDurationSeconds!==undefined&&(!Number.isFinite(shot.plannedDurationSeconds)||shot.plannedDurationSeconds<=0))
        throw Error(`material_planned_duration_invalid:${shot.shotId}`);
      if(verified&&segment&&(!refs.includes(segment.sourceRef)||!segment.segmentId?.trim()||!Number.isFinite(segment.startSeconds)||!Number.isFinite(segment.endSeconds)||segment.startSeconds<0||segment.endSeconds<=segment.startSeconds))throw Error(`material_local_match_segment_invalid:${shot.shotId}`);
      // Historical frozen product plans remain readable and resumable. New
      // plans never author this branch because only an already frozen request
      // can carry both the old generation contract and its replication spec.
      if(materialType==='product'&&shot.materialRouting?.policy==='local_first_product_i2v'
        &&shot.materialRouting.generation&&shot.productSceneReplication){
        const frozen=structuredClone(shot.materialRouting),generation=frozen.generation!;
        if(shot.plannedDurationSeconds!==undefined&&Math.abs(shot.plannedDurationSeconds-generation.durationSeconds)>0.000001)
          throw Error(`material_frozen_duration_changed:${shot.shotId}`);
        return {strategy:'aigc_product_scene_replication',refs:[...generation.productImageRefs],materialRouting:frozen,
          productSceneReplication:structuredClone(shot.productSceneReplication),blocked:!generation.productImageRefs.length,
          instruction:'历史已冻结产品生成计划按原版本恢复；不得把该兼容分支用于新计划，也不得运行时改变供应商、时长或回退到图片动效。'};
      }
      const materialRouting: SocialMaterialRouting = {schemaVersion:'social-material-routing.v1',materialType,
        policy: materialType === 'talking_head' ? 'authorized_presenter' : 'local_only',
        localMatch:{state:verified?'matched':'missing',sourceRefs:refs,evidenceRef:verified?match!.evidenceRef.trim():null,
          ...(shot.fixedYieldArchetypeId||match?.archetypeId?{archetypeId:shot.fixedYieldArchetypeId??match!.archetypeId}:{}),
          ...(verified&&match?.sourceTier?{sourceTier:match.sourceTier}:{}),
          ...(shot.localMaterialRejections?.length?{rejections:structuredClone(shot.localMaterialRejections.slice(0,20))}:{})}};
      if (materialType === 'talking_head') return {strategy:'authorized_digital_presenter',refs:presenterRefs,materialRouting,
        instruction:'真人口播使用当前账号授权数字人视频，锁定人物、声音与明确口播文案；能力缺失时停止，不用库存人物或图文替代。'};
      if (refs.length) return {strategy:'customer_real_asset',refs,materialRouting,
        instruction:'按当前镜头语义采用已匹配的本地真实视频；保持原主体及产品事实，不调用画面生成，匹配失败必须停止并保留缺口。'};
      const instruction=materialType==='product'
        ? '产品镜头只匹配同 SKU、同镜头原型的本地真实视频；无合格片段时停止并提示补素材或更换参考，不调用产品 I2V、图片动效或跨类素材。'
        : materialType==='factory'
          ? '工厂镜头只匹配同工序、同镜头原型的本地真实工厂视频；无合格片段时停止，不生成或跨类替代工厂。'
          : materialType==='consumer_demo'
            ? 'D2C 镜头只匹配同产品、同动作原型且授权完整的本地真人使用视频；缺口停止，不生成消费者场景或改成数字人口播。'
            : materialType==='general'
              ? '通用镜头只匹配同原型的本地真实视频；无展会、案例、物流、事实承载或品牌收尾片段时停止，不生成动态图形或事实卡。'
              : '素材类型或镜头语义未明确，仅允许合格本地匹配；缺口停止，不因账号存在其他素材而改变类型。';
      return {strategy:'customer_real_asset',refs:[],materialRouting,blocked:true,instruction};
}

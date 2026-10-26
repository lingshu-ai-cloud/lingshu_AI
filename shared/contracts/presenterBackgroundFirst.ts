import type {PresenterBackgroundPlateEvidence,PresenterCompositeFirstFrameArtifact} from './presenterMotherStaging.js';

export interface PresenterStaticQaEvidence {operationId:string;passed:boolean;receiptRef:string;reportHash:string}
/** Full provenance for the new route. v1 approvals never implied that the
 * original benchmark frame was already an empty background. */
export interface PresenterBackgroundFirstEvidence {
 schemaVersion:'presenter-background-first.v2';
 aspectRatio:'9:16'|'16:9'|'1:1';
 sourceFirstFrameSha256:string;
 background:PresenterBackgroundPlateEvidence&{width:number;height:number;operationId:string;receiptRef:string;qa:PresenterStaticQaEvidence};
 composite:PresenterCompositeFirstFrameArtifact&{width:number;height:number;operationId:string;receiptRef:string;qa:PresenterStaticQaEvidence};
}

/** An original scene is planned input, never a benchmark image or a person
 * removal claim. Generated plate and composite retain their real identities. */
export interface PresenterOriginalSceneFirstEvidence {
 schemaVersion:'presenter-background-first.v3';
 aspectRatio:'9:16'|'16:9'|'1:1';
 source:{kind:'original_scene';sceneContractHash:string;promptHash:string};
 background:{artifactRef:string;sha256:string;width:number;height:number;createdAt:string;operationId:string;receiptRef:string;qa:PresenterStaticQaEvidence};
 composite:PresenterCompositeFirstFrameArtifact&{width:number;height:number;operationId:string;receiptRef:string;qa:PresenterStaticQaEvidence};
}

export function isPresenterOriginalSceneFirstEvidence(value:unknown):value is PresenterOriginalSceneFirstEvidence {
 if(!value||typeof value!=='object')return false;
 const item=value as PresenterOriginalSceneFirstEvidence,bg=item.background,fg=item.composite;
 const sha=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 const text=(value:unknown)=>typeof value==='string'&&Boolean(value.trim())&&value===value.trim()&&value.length<=2000;
 const qa=(value:PresenterStaticQaEvidence|undefined)=>Boolean(value&&value.passed===true&&text(value.operationId)&&text(value.receiptRef)&&sha(value.reportHash));
 if(item.schemaVersion!=='presenter-background-first.v3'||item.source?.kind!=='original_scene'||Object.keys(item.source).some(key=>!['kind','sceneContractHash','promptHash'].includes(key))
  ||!sha(item.source.sceneContractHash)||!sha(item.source.promptHash)||!['9:16','16:9','1:1'].includes(item.aspectRatio)||!bg||!fg
  ||'sourceFirstFrameSha256' in item||'sourceFirstFrameSha256' in bg||'personRemovalMethod' in bg
  ||![bg.sha256,fg.sha256,fg.plateSha256].every(sha)
  ||![bg.artifactRef,bg.operationId,bg.receiptRef,fg.artifactRef,fg.operationId,fg.receiptRef,fg.presenterAssetId].every(text)
  ||![bg.createdAt,fg.createdAt].every(value=>typeof value==='string'&&Number.isFinite(Date.parse(value)))
  ||!Number.isSafeInteger(fg.presenterAssetVersion)||fg.presenterAssetVersion<1||!qa(bg.qa)||!qa(fg.qa))return false;
 const [w,h]=item.aspectRatio.split(':').map(Number);
 if([bg,fg].some(frame=>!Number.isSafeInteger(frame.width)||!Number.isSafeInteger(frame.height)||frame.width<64||frame.height<64||Math.abs(frame.width*h!-frame.height*w!)>Math.max(w!,h!)))return false;
 return fg.plateSha256===bg.sha256&&new Set([bg.operationId,bg.qa.operationId,fg.operationId,fg.qa.operationId]).size===4;
}

export function isPresenterBackgroundFirstEvidence(value:unknown):value is PresenterBackgroundFirstEvidence{
 if(!value||typeof value!=='object')return false;
 const item=value as PresenterBackgroundFirstEvidence,bg=item.background,fg=item.composite;
 const sha=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 const text=(value:unknown)=>typeof value==='string'&&Boolean(value.trim())&&value===value.trim()&&value.length<=2000;
 const qa=(value:PresenterStaticQaEvidence|undefined)=>Boolean(value&&value.passed===true&&text(value.operationId)&&text(value.receiptRef)&&sha(value.reportHash));
 if(item.schemaVersion!=='presenter-background-first.v2'||!['9:16','16:9','1:1'].includes(item.aspectRatio)||!bg||!fg||!sha(item.sourceFirstFrameSha256)
  ||![bg.sha256,bg.sourceFirstFrameSha256,fg.sha256,fg.plateSha256].every(sha)
  ||![bg.artifactRef,bg.personRemovalMethod,bg.operationId,bg.receiptRef,fg.artifactRef,fg.operationId,fg.receiptRef,fg.presenterAssetId].every(text)
  ||![bg.createdAt,fg.createdAt].every(value=>typeof value==='string'&&Number.isFinite(Date.parse(value)))
  ||!Number.isSafeInteger(fg.presenterAssetVersion)||fg.presenterAssetVersion<1||!qa(bg.qa)||!qa(fg.qa))return false;
 const [w,h]=item.aspectRatio.split(':').map(Number);
 if([bg,fg].some(frame=>!Number.isSafeInteger(frame.width)||!Number.isSafeInteger(frame.height)||frame.width<64||frame.height<64||Math.abs(frame.width*h!-frame.height*w!)>Math.max(w!,h!)))return false;
 return bg.sourceFirstFrameSha256===item.sourceFirstFrameSha256&&fg.plateSha256===bg.sha256
  &&new Set([bg.operationId,bg.qa.operationId,fg.operationId,fg.qa.operationId]).size===4;
}

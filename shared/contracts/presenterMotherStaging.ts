import {createHash} from 'node:crypto';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const SHA=/^[a-f0-9]{64}$/;
const required=(value:string,name:string)=>{const result=value.trim();if(!result)throw Error(`presenter_staging_${name}_missing`);return result;};

/** Identity-only presenter binding. Scene/background data belongs exclusively
 * to composition and plate evidence, never to the reusable person asset. */
export interface PresenterIdentityBinding {tenantId:string;presenterAssetId:string;assetVersion:number;authorizationRef:string;providerPresenterId:string;providerVoiceId:string;providerVersion:string;defaultForTenant:boolean}
export interface PresenterMotherReferenceComposition {referenceShotId:string;referenceFirstFrameUrl:string;background:string;framing:string;camera:string;composition:string}
export interface PresenterBackgroundPlateEvidence {artifactRef:string;sha256:string;sourceFirstFrameSha256:string;personRemovalMethod:string;createdAt:string}
export interface PresenterCompositeFirstFrameArtifact {artifactRef:string;sha256:string;plateSha256:string;presenterAssetId:string;presenterAssetVersion:number;createdAt:string}
export interface PresenterCompositeConfirmationReceipt {schemaVersion:'presenter-composite-confirmation.v1';tenantId:string;taskId:string;segmentId:string;stagingHash:string;compositeSha256:string;confirmedByUserId:string;confirmedAt:string;confirmationSource:'explicit_user_action';recordHash:string}
export interface PresenterDynamicQaReceipt {providerReceiptHash:string;outputSha256:string;identitySimilarity:number;identityThreshold:number;lipSyncScore:number;lipSyncThreshold:number;qaArtifactRef:string;passed:boolean;recordHash:string}
export interface PresenterMotherStage {
 schemaVersion:'presenter-mother-stage.v1';tenantId:string;taskId:string;segmentId:string;memberSlotIds:string[];segmentContentHash:string;
 presenter:PresenterIdentityBinding;compositions:PresenterMotherReferenceComposition[];backgroundPlate:PresenterBackgroundPlateEvidence|null;
 compositeFirstFrame:PresenterCompositeFirstFrameArtifact|null;confirmation:PresenterCompositeConfirmationReceipt|null;dynamicQa:PresenterDynamicQaReceipt|null;stagingHash:string;
}

export function freezePresenterMotherStage(input:Omit<PresenterMotherStage,'schemaVersion'|'backgroundPlate'|'compositeFirstFrame'|'confirmation'|'dynamicQa'|'stagingHash'>):PresenterMotherStage{
 const presenter={...input.presenter,tenantId:required(input.presenter.tenantId,'presenter_tenant'),presenterAssetId:required(input.presenter.presenterAssetId,'presenter_asset'),authorizationRef:required(input.presenter.authorizationRef,'authorization'),providerPresenterId:required(input.presenter.providerPresenterId,'provider_presenter'),providerVoiceId:required(input.presenter.providerVoiceId,'provider_voice'),providerVersion:required(input.presenter.providerVersion,'provider_version')};
 if(presenter.tenantId!==input.tenantId||!Number.isSafeInteger(presenter.assetVersion)||presenter.assetVersion<1||presenter.defaultForTenant!==true)throw Error('presenter_staging_identity_binding_invalid');
 if(!input.memberSlotIds.length||new Set(input.memberSlotIds).size!==input.memberSlotIds.length||input.compositions.length!==input.memberSlotIds.length||!SHA.test(input.segmentContentHash))throw Error('presenter_staging_group_invalid');
 const body={schemaVersion:'presenter-mother-stage.v1' as const,tenantId:required(input.tenantId,'tenant'),taskId:required(input.taskId,'task'),segmentId:required(input.segmentId,'segment'),memberSlotIds:[...input.memberSlotIds],segmentContentHash:input.segmentContentHash,presenter,compositions:structuredClone(input.compositions),backgroundPlate:null,compositeFirstFrame:null,confirmation:null,dynamicQa:null};
 return{...body,stagingHash:hash(body)};
}
export function attachPresenterCompositeArtifacts(stage:PresenterMotherStage,backgroundPlate:PresenterBackgroundPlateEvidence,compositeFirstFrame:PresenterCompositeFirstFrameArtifact):PresenterMotherStage{
 if(![backgroundPlate.sha256,backgroundPlate.sourceFirstFrameSha256,compositeFirstFrame.sha256,compositeFirstFrame.plateSha256].every(value=>SHA.test(value))||compositeFirstFrame.plateSha256!==backgroundPlate.sha256||compositeFirstFrame.presenterAssetId!==stage.presenter.presenterAssetId||compositeFirstFrame.presenterAssetVersion!==stage.presenter.assetVersion)throw Error('presenter_staging_composite_binding_invalid');
 const body={...stage,backgroundPlate:{...backgroundPlate},compositeFirstFrame:{...compositeFirstFrame},confirmation:null,dynamicQa:null};delete (body as Partial<PresenterMotherStage>).stagingHash;return{...body,stagingHash:hash(body)} as PresenterMotherStage;
}
export function issuePresenterCompositeConfirmation(stage:PresenterMotherStage,input:{tenantId:string;taskId:string;segmentId:string;stagingHash:string;compositeSha256:string;confirmedByUserId:string;confirmedAt:string;confirmationSource:'explicit_user_action'}):PresenterMotherStage{
 if(!stage.compositeFirstFrame||input.confirmationSource!=='explicit_user_action'||input.tenantId!==stage.tenantId||input.taskId!==stage.taskId||input.segmentId!==stage.segmentId||input.stagingHash!==stage.stagingHash||input.compositeSha256!==stage.compositeFirstFrame.sha256||!input.confirmedByUserId||!Number.isFinite(Date.parse(input.confirmedAt)))throw Error('presenter_staging_explicit_confirmation_invalid');
 const receiptBody={schemaVersion:'presenter-composite-confirmation.v1' as const,...input};const confirmation={...receiptBody,recordHash:hash(receiptBody)};return{...stage,confirmation};
}
export function assertPresenterDynamicGenerationAllowed(stage:PresenterMotherStage,scope:{tenantId:string;taskId:string;segmentId:string}):void{
 const receipt=stage.confirmation;let receiptHash='';if(receipt){const{recordHash:_,...body}=receipt;receiptHash=hash(body);}
 if(!stage.backgroundPlate||!stage.compositeFirstFrame||!receipt||scope.tenantId!==stage.tenantId||scope.taskId!==stage.taskId||scope.segmentId!==stage.segmentId||receipt.stagingHash!==stage.stagingHash||receipt.compositeSha256!==stage.compositeFirstFrame.sha256||receipt.confirmationSource!=='explicit_user_action'||receipt.recordHash!==receiptHash)throw Error(`user_input_required:presenter_composite_confirmation:${stage.segmentId}`);
}
export function attachPresenterDynamicQa(stage:PresenterMotherStage,input:Omit<PresenterDynamicQaReceipt,'passed'|'recordHash'>):PresenterMotherStage{
 assertPresenterDynamicGenerationAllowed(stage,{tenantId:stage.tenantId,taskId:stage.taskId,segmentId:stage.segmentId});
 if(![input.providerReceiptHash,input.outputSha256].every(value=>SHA.test(value))||input.identityThreshold<=0||input.lipSyncThreshold<=0)throw Error('presenter_staging_dynamic_qa_invalid');
 const body={...input,passed:input.identitySimilarity>=input.identityThreshold&&input.lipSyncScore>=input.lipSyncThreshold};
 if(!body.passed)throw Error(`presenter_staging_dynamic_qa_failed:${stage.segmentId}`);
 return{...stage,dynamicQa:{...body,recordHash:hash(body)}};
}

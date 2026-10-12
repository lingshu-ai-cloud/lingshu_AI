import { createHash } from 'node:crypto';
import { verifyFrozenPresenterMotherSegments, type FrozenPresenterMotherSegments } from '../../shared/contracts/presenterMotherSegments.js';

export interface PresenterMotherProviderRequest {
  taskId: string;
  segmentId: string;
  segmentHash: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  spokenText: string;
  memberSlotIds: string[];
}

export interface PresenterMotherProviderResult {
  providerId: string;
  providerReceiptRef: string;
  outputRef: string;
  outputSha256: string;
  durationSeconds: number;
  dynamicQa: {
    identitySimilarity:number;
    identityThreshold:number;
    lipSyncScore?:number|null;
    lipSyncThreshold?:number|null;
    lipSyncStatus?:'passed'|'skipped_unconfigured';
    receiptRef:string;
    reportHash:string;
  };
}

export interface PresenterMotherExecutionReceipt {
  segmentId: string;
  segmentHash: string;
  providerId: string;
  providerReceiptRef: string;
  outputRef: string;
  outputSha256: string;
  durationSeconds: number;
  dynamicQa: PresenterMotherProviderResult['dynamicQa'] & {passed:true};
  receiptHash: string;
}

export interface PresenterSlotCropReceipt {
  slotId: string;
  referenceShotId: string;
  segmentId: string;
  segmentHash: string;
  providerReceiptHash: string;
  sourceOutputRef: string;
  sourceOutputSha256: string;
  cropStartSeconds: number;
  cropEndSeconds: number;
  durationSeconds: number;
  receiptHash: string;
}

export interface PresenterMotherExecutionResult {
  schemaVersion: 'presenter-mother-execution.v1';
  taskId: string;
  groupingHash: string;
  providerReceipts: PresenterMotherExecutionReceipt[];
  slotCropReceipts: PresenterSlotCropReceipt[];
  recordHash: string;
}

const HASH = /^[a-f0-9]{64}$/;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Pure orchestration seam: callers own budget admission, cache lookup and the
 * actual provider implementation. This helper guarantees one invocation per
 * frozen mother segment and derives immutable per-slot crop receipts. */
export async function executePresenterMotherSegments(input: {
  grouping: FrozenPresenterMotherSegments;
  provider: (request: PresenterMotherProviderRequest) => Promise<PresenterMotherProviderResult>;
}): Promise<PresenterMotherExecutionResult> {
  if (!verifyFrozenPresenterMotherSegments(input.grouping)) throw new Error('presenter_mother_grouping_invalid');
  const providerReceipts: PresenterMotherExecutionReceipt[] = [];
  const slotCropReceipts: PresenterSlotCropReceipt[] = [];
  for (const group of input.grouping.groups) {
    const provided = await input.provider({
      taskId: input.grouping.taskId,
      segmentId: group.segmentId,
      segmentHash: group.contentHash,
      startSeconds: group.startSeconds,
      endSeconds: group.endSeconds,
      durationSeconds: group.durationSeconds,
      spokenText: group.mergedSpokenText,
      memberSlotIds: [...group.memberSlotIds],
    });
    const qa=provided.dynamicQa;
    const lipSyncPassed=qa?.lipSyncStatus==='skipped_unconfigured'||(
      Number.isFinite(qa?.lipSyncScore)&&Number.isFinite(qa?.lipSyncThreshold)
      && Number(qa!.lipSyncScore)>=Number(qa!.lipSyncThreshold)
    );
    const qaPassed=Boolean(qa&&HASH.test(qa.reportHash)&&qa.receiptRef.trim()&&Number.isFinite(qa.identitySimilarity)&&Number.isFinite(qa.identityThreshold)&&qa.identitySimilarity>=qa.identityThreshold&&lipSyncPassed);
    if (!provided.providerId.trim() || !provided.providerReceiptRef.trim() || !provided.outputRef.trim() || !HASH.test(provided.outputSha256)||!qaPassed
      || !Number.isFinite(provided.durationSeconds) || provided.durationSeconds + .001 < group.durationSeconds) {
      throw new Error(`${qa&&!qaPassed?'presenter_mother_dynamic_qa_failed':'presenter_mother_provider_result_invalid'}:${group.segmentId}`);
    }
    const receiptBody = {
      segmentId: group.segmentId,
      segmentHash: group.contentHash,
      providerId: provided.providerId,
      providerReceiptRef: provided.providerReceiptRef,
      outputRef: provided.outputRef,
      outputSha256: provided.outputSha256,
      durationSeconds: provided.durationSeconds,
      dynamicQa:{...qa,passed:true as const},
    };
    const receipt = { ...receiptBody, receiptHash: digest(receiptBody) };
    providerReceipts.push(receipt);
    for (const member of group.members) {
      const cropBody = {
        slotId: member.slotId,
        referenceShotId: member.referenceShotId,
        segmentId: group.segmentId,
        segmentHash: group.contentHash,
        providerReceiptHash: receipt.receiptHash,
        sourceOutputRef: receipt.outputRef,
        sourceOutputSha256: receipt.outputSha256,
        cropStartSeconds: member.startSeconds - group.startSeconds,
        cropEndSeconds: member.endSeconds - group.startSeconds,
        durationSeconds: member.endSeconds - member.startSeconds,
      };
      slotCropReceipts.push({ ...cropBody, receiptHash: digest(cropBody) });
    }
  }
  const body = {
    schemaVersion: 'presenter-mother-execution.v1' as const,
    taskId: input.grouping.taskId,
    groupingHash: input.grouping.recordHash,
    providerReceipts,
    slotCropReceipts,
  };
  return { ...body, recordHash: digest(body) };
}

export function verifyPresenterMotherExecutionResult(value: PresenterMotherExecutionResult): boolean {
  if(value.schemaVersion!=='presenter-mother-execution.v1'||!value.taskId||!HASH.test(value.groupingHash)||!HASH.test(value.recordHash)||!value.providerReceipts.length||!value.slotCropReceipts.length)return false;
  const providers=new Map<string,PresenterMotherExecutionReceipt>();
  for(const receipt of value.providerReceipts){
    const {receiptHash,...body}=receipt;
    const qa=receipt.dynamicQa;
    const lipSyncPassed=qa?.lipSyncStatus==='skipped_unconfigured'||(
      Number.isFinite(qa?.lipSyncScore)&&Number.isFinite(qa?.lipSyncThreshold)
      && Number(qa!.lipSyncScore)>=Number(qa!.lipSyncThreshold)
    );
    if(providers.has(receipt.segmentId)||!HASH.test(receipt.segmentHash)||!HASH.test(receipt.outputSha256)||!qa||qa.passed!==true||!HASH.test(qa.reportHash)||!qa.receiptRef||qa.identitySimilarity<qa.identityThreshold||!lipSyncPassed||receiptHash!==digest(body))return false;
    providers.set(receipt.segmentId,receipt);
  }
  const slots=new Set<string>();
  for(const crop of value.slotCropReceipts){
    const {receiptHash,...body}=crop,provider=providers.get(crop.segmentId);
    if(slots.has(crop.slotId)||!provider||crop.segmentHash!==provider.segmentHash||crop.providerReceiptHash!==provider.receiptHash||crop.sourceOutputRef!==provider.outputRef||crop.sourceOutputSha256!==provider.outputSha256||crop.cropStartSeconds<0||crop.cropEndSeconds<=crop.cropStartSeconds||crop.cropEndSeconds>provider.durationSeconds+.001||crop.durationSeconds!==crop.cropEndSeconds-crop.cropStartSeconds||receiptHash!==digest(body))return false;
    slots.add(crop.slotId);
  }
  const {recordHash,...body}=value;return recordHash===digest(body);
}

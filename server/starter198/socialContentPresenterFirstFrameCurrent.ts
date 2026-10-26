import type { DataStore } from '../storage/datastore.js';
import type { SocialTaskBudgetScope } from '../lib/socialContentTaskBudget.js';
import { readConfirmedPresenterFirstFrameApproval, type PresenterFirstFrameApprovalContract } from './socialContentPresenterFirstFrameApproval.js';
import { currentPresenterFirstFrameAssetProvenanceHash,currentOriginalScenePresenterProvenanceHash } from './socialContentPresenterFirstFrameRuntime.js';
import { verifyNativeHeyGenCatalogueApprovalCurrent } from './socialContentNativeHeyGenFirstFrame.js';
import {assertPresenterBackgroundAssets} from './socialContentPresenterBackgroundFirst.js';
import {MEDIA_ROOT} from './socialContentAutoProduction.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {tenantAssetDir} from '../lib/assetAccess.js';
import type {PresenterOriginalSceneFirstEvidence} from '../../shared/contracts/presenterBackgroundFirst.js';

async function assertOriginalSceneBytes(evidence:PresenterOriginalSceneFirstEvidence,tenantId:string,mediaRoot:string){
 const root=await fs.realpath(tenantAssetDir(mediaRoot,tenantId));
 for(const artifact of [evidence.background,evidence.composite]){
  const url=new URL(artifact.artifactRef,'http://local.invalid');
  if(url.origin!=='http://local.invalid'||url.search||url.hash||!url.pathname.startsWith('/media/'))throw Error('presenter_original_scene_artifact_not_owned');
  const file=path.resolve(mediaRoot,decodeURIComponent(url.pathname.slice('/media/'.length))),actual=await fs.realpath(file);
  if(!actual.startsWith(root+path.sep)||(await fs.lstat(file)).isSymbolicLink())throw Error('presenter_original_scene_artifact_not_owned');
  const bytes=await fs.readFile(actual);
  if(createHash('sha256').update(bytes).digest('hex')!==artifact.sha256)throw Error('presenter_original_scene_artifact_changed');
  const metadata=await sharp(bytes,{failOn:'error'}).metadata();
  if(metadata.width!==artifact.width||metadata.height!==artifact.height)throw Error('presenter_original_scene_artifact_changed');
 }
}

/** Shared budget/execution read boundary. Native catalogue portraits prove
 * provider identity and owned source bytes; composite frames retain their
 * distinct presenter/product/background provenance requirement. Neither path
 * creates an approval or upgrades source-only review into visual/lip QA. */
export async function readCurrentConfirmedPresenterFirstFrame(store: DataStore, input: {
  scope: SocialTaskBudgetScope; groupId: string; presenterGroupContractHash: string; presenterAssetId: string;
}, options: { mediaRoot?: string; readAssetProvenance?: typeof currentPresenterFirstFrameAssetProvenanceHash; readOriginalSceneProvenance?:typeof currentOriginalScenePresenterProvenanceHash } = {}) {
  const rows = await store.list<any>('social_presenter_first_frame_approvals', { where: {
    tenant_id: input.scope.tenantId, task_id: input.scope.taskId, run_id: input.scope.runId,
    plan_hash: input.scope.planHash, group_id: input.groupId,
  }, perPage: 2 });
  if (rows.totalItems !== 1 || rows.items.length !== 1) return null;
  const approval = rows.items[0]?.payload as PresenterFirstFrameApprovalContract | undefined;
  if (!approval || approval.recordHash !== rows.items[0]?.record_hash) return null;
  // Validate the original immutable approval + original confirmation before
  // consulting current asset metadata. Physical IDs remain authoritative even
  // when the same voice gains an explicit Orca/native execution route.
  const confirmed = await readConfirmedPresenterFirstFrameApproval(store, input);
  if (!confirmed) return null;
  if(approval.schemaVersion==='social-presenter-first-frame-approval.v3'){
    try{
      await assertOriginalSceneBytes(approval.originalScene,input.scope.tenantId,options.mediaRoot??MEDIA_ROOT);
      const expectedAssetProvenanceHash=await(options.readOriginalSceneProvenance||currentOriginalScenePresenterProvenanceHash)(store,{tenantId:input.scope.tenantId,approval});
      return expectedAssetProvenanceHash?readConfirmedPresenterFirstFrameApproval(store,{...input,expectedAssetProvenanceHash}):null;
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  }
  if(approval.backgroundFirst){try{await assertPresenterBackgroundAssets(approval.backgroundFirst,input.scope.tenantId,options.mediaRoot??MEDIA_ROOT);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
  if (approval.sourceMode === 'heygen_catalog_native') {
    try { return await verifyNativeHeyGenCatalogueApprovalCurrent(store, input.scope, approval, options.mediaRoot) ? confirmed : null; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  const expectedAssetProvenanceHash = await (options.readAssetProvenance || currentPresenterFirstFrameAssetProvenanceHash)(store, { tenantId: input.scope.tenantId, approval });
  return expectedAssetProvenanceHash ? readConfirmedPresenterFirstFrameApproval(store, { ...input, expectedAssetProvenanceHash }) : null;
}

/** Missing retained parent bytes may be recovered through the existing paid
 * receipt. Invalid identities/QA never authorize regeneration or cache reuse. */
export async function canReusePresenterMotherCheckpoint(verify:()=>Promise<void>):Promise<boolean>{
 try{await verify();return true;}catch(error){
  if(error instanceof Error&&error.message==='presenter_mother_cached_qa_bytes_unavailable')return false;
  throw error;
 }
}
/** Attach to the existing whole-track write boundary for receipt-only replay. */
export function assertPresenterMotherRecoveryReadOnly():never{
 throw Error('presenter_mother_parent_recovery_requires_existing_receipt');
}

export const materialPanelId=(programId:string,packageId:string,version:number)=>`weekly-material-panel:${programId}:${packageId}:${version}`;
export const materialRequestPanelId=(programId:string,packageId:string,version:number,requestId:string)=>`weekly-material-request:${programId}:${packageId}:${version}:${requestId}`;
export const materialActionPanelId=(programId:string,packageId:string,version:number,requestId:string,action:'upload'|'verification')=>`${materialRequestPanelId(programId,packageId,version,requestId)}:${action}`;
/** Locate a unique real request/action inside the current surface; never substitute the other action. */
export function openMaterialPanelRequest(container:Pick<HTMLElement,'querySelectorAll'>|null,programId:string,packageId:string,version:number,requestId:string,action?:'upload'|'verification'):boolean {
  if(!container||!programId||!packageId||!requestId||!Number.isSafeInteger(version)||version<1||(action!==undefined&&!['upload','verification'].includes(action)))return false;
  const id=action?materialActionPanelId(programId,packageId,version,requestId,action):materialRequestPanelId(programId,packageId,version,requestId);
  const matches=Array.from(container.querySelectorAll<HTMLElement>('[id]')).filter(node=>node.id===id);
  if(matches.length!==1)return false;
  const target=matches[0]!;
  if(action&&(target.dataset.materialProgram!==programId||target.dataset.materialPackage!==packageId||target.dataset.materialVersion!==String(version)||target.dataset.materialRequest!==requestId||target.dataset.materialAction!==action))return false;
  let parent=target.parentElement;while(parent){if(parent.tagName==='DETAILS')(parent as HTMLDetailsElement).open=true;parent=parent.parentElement;}
  target.scrollIntoView({behavior:'smooth',block:'start'});
  if(action){const control=target.querySelector<HTMLElement>('input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled])');(control??target).focus({preventScroll:true});}
  return true;
}

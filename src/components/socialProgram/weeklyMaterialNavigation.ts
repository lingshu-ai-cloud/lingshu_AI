export const materialPanelId=(programId:string,packageId:string,version:number)=>`weekly-material-panel:${programId}:${packageId}:${version}`;
export const materialRequestPanelId=(programId:string,packageId:string,version:number,requestId:string)=>`weekly-material-request:${programId}:${packageId}:${version}:${requestId}`;
/** Locate only the actual panel in the current surface; duplicate IDs in hidden pages are not used. */
export function openMaterialPanelRequest(container:Pick<HTMLElement,'querySelectorAll'>|null,programId:string,packageId:string,version:number,requestId:string):boolean {
  if(!container||!requestId||!Number.isSafeInteger(version)||version<1)return false;
  const id=materialRequestPanelId(programId,packageId,version,requestId);
  const target=Array.from(container.querySelectorAll<HTMLElement>('[id]')).find(node=>node.id===id);
  if(!target)return false;
  target.scrollIntoView({behavior:'smooth',block:'start'});return true;
}

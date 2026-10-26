import type { StarterRecord } from './repository.js';
import { socialJson, socialObject, socialText } from './socialContentValidation.js';
import { socialContentFileDownloadUrl } from './socialContentFilePrimitives.js';

/** Only the final-render artifact's archived cover is a video cover. */
export function socialContentTaskCover(rows:StarterRecord[],tenantId:string,taskId:string):string|null {
  const current=rows.filter(row=>row.tenant_id===tenantId&&row.task_id===taskId&&row.artifact_kind==='short_video'&&row.status!=='superseded')
    .sort((a,b)=>Date.parse(socialText(b.updated_at))-Date.parse(socialText(a.updated_at)))[0];
  if(!current)return null;
  const content=socialObject(socialJson(current.content)),storage=socialObject(content?.mediaStorage),cover=socialObject(storage?.cover);
  const id=socialText(cover?.fileId);
  return /^socialfile_[a-f0-9]{24}$/.test(id)&&/^[a-f0-9]{64}$/.test(socialText(cover?.sha256))?socialContentFileDownloadUrl(id):null;
}

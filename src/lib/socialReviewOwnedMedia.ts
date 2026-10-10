import {authHeader,getToken} from './auth';
export interface OwnedReviewMedia{taskId:string;artifactId:string;previewUrl:string;fileSha256:string}
/** Reviews always inspect the exact owned artifact bytes, never a submitted URL. */
export async function loadOwnedReviewMedia(c:OwnedReviewMedia,signal?:AbortSignal):Promise<Blob>{
 const path=`/api/overseas/starter-198/social-content/tasks/${encodeURIComponent(c.taskId)}/artifacts/${encodeURIComponent(c.artifactId)}/media`;
 if(c.previewUrl!==path||!/^[a-f0-9]{64}$/.test(c.fileSha256))throw Error('审核视频来源不完整。');
 const token=getToken(),res=await fetch(path,{headers:authHeader(),credentials:'same-origin',cache:'no-store',redirect:'error',signal});
 if(!res.ok||!res.headers.get('content-type')?.toLowerCase().startsWith('video/'))throw Error('审核视频文件不可用。');
 const max=110*1024*1024;if(Number(res.headers.get('content-length'))>max||!res.body)throw Error('审核视频文件大小异常。');
 const reader=res.body.getReader(),parts:Uint8Array<ArrayBuffer>[]= [];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error('审核视频文件过大。');}parts.push(new Uint8Array(value));}
 const blob=new Blob(parts,{type:res.headers.get('content-type')!}),digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()),sha=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
 if(!size||sha!==c.fileSha256||getToken()!==token)throw Error('审核视频与当前成片不一致。');return blob;
}

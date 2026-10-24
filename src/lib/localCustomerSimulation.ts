import {authHeader} from './auth';
import type {CustomerProfile} from '../types/customer';
export function localCustomerPreviewEnabled(){return import.meta.env?.VITE_LINGSHU_LOCAL_PREVIEW==='1';}
export async function saveLocalCustomerDraft(customerId:string,pendingDraft:string|null){
 if(!localCustomerPreviewEnabled())return;
 const response=await fetch('/api/overseas/customer-simulation/drafts',{method:'POST',headers:{...authHeader(),'Content-Type':'application/json'},body:JSON.stringify({customerId,pendingDraft})});
 if(!response.ok)throw Error('本地草稿持久保存失败，输入已保留，请稍后再保存。');
}
export async function readLocalCustomerDrafts(signal:AbortSignal):Promise<Array<{customerId:string;patch:Partial<CustomerProfile>}>>{
 if(!localCustomerPreviewEnabled())return [];
 const authorization=authHeader().Authorization;
 try{const response=await fetch('/api/overseas/customer-simulation/drafts',{headers:authHeader(),signal});if(!response.ok||authorization!==authHeader().Authorization)return [];const data=await response.json();return Array.isArray(data.items)?data.items.map((item:{customerId:string;patch:Partial<CustomerProfile>})=>({...item,patch:{...item.patch,pendingDraft:item.patch.pendingDraft||undefined}})):[];}catch{return [];}
}

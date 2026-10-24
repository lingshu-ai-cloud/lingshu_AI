import { authHeader } from './auth';
/** Retain a request identity through timeout/reload; replay reads the original durable result. */
export async function fetchCustomerReply(input: Record<string, unknown>, manual: boolean) {
  const scope = authHeader().Authorization || '';
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([scope,input])));
  const key = `lingshu:customer-reply:${Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}`;
  let prior: {id:string;settled:boolean}|null = null;
  try { prior = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { /* SSR/test or disabled session storage */ }
  const requestId = prior && (!manual || !prior.settled) ? prior.id : crypto.randomUUID();
  const save = (settled: boolean) => { try { sessionStorage.setItem(key, JSON.stringify({id:requestId,settled})); } catch { /* requestId is still returned */ } };
  save(false);
  let response:Response;
  try{response = await fetch('/api/overseas/agents/conversion/draft', {
    method:'POST',headers:{'Content-Type':'application/json',...authHeader()},body:JSON.stringify({...input,requestId}),signal:AbortSignal.timeout(125_000),
  });}catch(error){throw Object.assign(new Error('草稿请求结果未确认，请读取原请求。'),{requestId,cause:error});}
  const data=await response.json().catch(()=>({}));
  if (response.ok && response.status!==202) save(true);
  return {response,data,requestId};
}
export async function readCustomerReply(requestId:string) {
  const response=await fetch(`/api/overseas/agents/conversion/draft/${encodeURIComponent(requestId)}`,{headers:authHeader(),signal:AbortSignal.timeout(15_000)});
  const data=await response.json();if(!response.ok)throw Error(data.error||'customer_reply_read_failed');return data;
}

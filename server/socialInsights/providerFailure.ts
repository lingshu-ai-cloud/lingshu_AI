/** Only an explicit, durable provider refusal proves that no Actor was accepted. */
export function apifyMonthlyLimitRefusal(receipts: unknown[] | undefined, runId: string | undefined): boolean {
 if (runId || !Array.isArray(receipts)) return false;
 return receipts.some(receipt=>{
  if(!receipt || typeof receipt!=='object')return false;
  const row=receipt as Record<string,unknown>;
  if(row.phase!=='actor_submit'||row.httpStatus!==403||typeof row.responseBody!=='string')return false;
  try{
   const parsed=JSON.parse(row.responseBody),error=parsed?.error;
   return error?.type==='platform-feature-disabled'&&typeof error?.message==='string'&&/Monthly usage hard limit exceeded/i.test(error.message);
  }catch{return false;}
 });
}
export const monthlyLimitError = () => ({code:'social_insight_apify_monthly_limit',message:'Apify 账号已达到月度使用上限，采集被平台拒绝，尚未取得素材。请提高账号月度上限后再发起新查询；本任务不会自动重发。'});

/** A completed Actor may still report no search queries completed. */
export function apifySearchUncompleted(receipts: unknown[] | undefined, runId: string | undefined): boolean {
 if (!runId || !Array.isArray(receipts)) return false;
 return receipts.some(receipt => {
  if (!receipt || typeof receipt !== 'object') return false;
  const row = receipt as Record<string, unknown>;
  if (row.phase !== 'actor_poll' || row.httpStatus !== 200 || row.runId !== runId || typeof row.responseBody !== 'string') return false;
  try { const data = JSON.parse(row.responseBody)?.data; const m = /^Scraped\s+(\d+)\/(\d+)\s+search queries\b/i.exec(String(data?.statusMessage || '').trim()); return data?.id === runId && data?.status === 'SUCCEEDED' && !!m && Number(m[1]) === 0 && Number(m[2]) > 0; } catch { return false; }
 });
}

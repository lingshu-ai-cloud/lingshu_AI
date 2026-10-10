import {useEffect,useRef,useState} from 'react';
import {getToken} from '../../lib/auth';
import {weeklyCustomerRunApi} from '../../lib/weeklyCustomerRunApi';
import type {WeeklyCustomerExceptionRequest} from '../../../shared/contracts/weeklyCustomerKnowledgeQuote';
import type {WeeklyNativeSendRecoveryScope} from '../../../shared/contracts/weeklyNativeSendRecovery';
import WeeklyCustomerKnowledgeQuotePanel from './WeeklyCustomerKnowledgeQuotePanel';
export default function BoundWeeklyCustomerKnowledgeQuotePanel({onChanged,...scope}:WeeklyNativeSendRecoveryScope&{onChanged?:(requests:WeeklyCustomerExceptionRequest[])=>void}){
 const token=getToken(),identity=JSON.stringify([scope,token]),live=useRef(identity);live.current=identity;
 const [bound,setBound]=useState<{identity:string;runId:string|null}|null>(null),[error,setError]=useState<string|null>(null),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;setBound(null);setError(null);void weeklyCustomerRunApi.candidates(scope.programId,scope.packageId,scope.packageVersion).then(result=>{if(active&&live.current===identity)setBound({identity,runId:result.boundRunId});}).catch(cause=>{if(active&&live.current===identity)setError(cause instanceof Error?cause.message:'真实客服运行读取失败。');});return()=>{active=false;};},[identity,revision]);
 const actual=bound?.identity===identity?bound:null;
 return <div><button type="button" className="mb-2 text-xs underline" onClick={()=>setRevision(n=>n+1)}>只读刷新本周客服绑定</button>{error&&<p role="alert" className="text-xs text-amber-800">{error}</p>}{actual?.runId?<WeeklyCustomerKnowledgeQuotePanel key={`${identity}:${actual.runId}`} programId={scope.programId} packageId={scope.packageId} packageVersion={scope.packageVersion} runId={actual.runId} onChanged={requests=>{if(live.current!==identity||getToken()!==token)return;if(requests.some(r=>r.scope.tenantId!==scope.tenantId||r.scope.programId!==scope.programId||r.scope.packageId!==scope.packageId||r.scope.packageVersion!==scope.packageVersion||r.scope.runId!==actual.runId))throw Error('补齐任务与本周真实客服运行不一致。');onChanged?.(requests);}}/>:actual?<p className="text-xs text-amber-800">尚未绑定本周客服生产运行，知识与报价补齐保持未就绪。</p>:<p className="text-xs text-slate-500">正在读取本周真实客服绑定…</p>}</div>;
}

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Space } from 'antd';
import { readCustomerReply } from '../../lib/customerReplyRequest';
import { authHeader } from '../../lib/auth';
import type { DraftResult } from './customerReplyPreparation';
export default function CustomerReplyRecovery({meta,onRecovered}:{meta:DraftResult|null;onRecovered:(result:DraftResult)=>void}){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');const live=useRef(true);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  if(!meta?.requestId||!meta.status||meta.status==='succeeded'||meta.status==='waiting_human')return null;
  const requestId=meta.requestId;
  const label=meta.status==='degraded'?'当前为降级草稿，请核对后再使用。':'原草稿请求尚未取得确定结果，已保留请求记录。';
  async function read(){const identity=authHeader().Authorization;setBusy(true);setMessage('');try{const data=await readCustomerReply(requestId);if(!live.current||authHeader().Authorization!==identity)return;
    if(data.status==='pending'){setMessage('原请求仍在核对中，本次没有重新生成。');return;}
    onRecovered({...data,draft:data.translatedDraft||data.draft||'',originalDraft:data.draft||''});
  }catch(error){if(live.current)setMessage(error instanceof Error?error.message:'无法读取原请求');}finally{if(live.current)setBusy(false);}}
  return <Alert type="warning" showIcon title={label} description={<Space wrap><span>{message}</span><Button loading={busy} onClick={()=>void read()}>读取原草稿结果</Button></Space>}/>;
}

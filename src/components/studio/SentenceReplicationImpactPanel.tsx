import { useEffect, useState } from 'react';
import { productionApi } from '../../lib/productionApi';
import type { ShotProduction } from '../../lib/shotProduction';

type Preview = Awaited<ReturnType<typeof productionApi.sentenceReplicationPreview>>;
export default function SentenceReplicationImpactPanel({projectId,assemblyId,shotId,language,shot}: {
  projectId?:string; assemblyId?:string; shotId?:string; language?:string; shot:ShotProduction;
}) {
  const [preview,setPreview]=useState<Preview|null>(null);
  const [error,setError]=useState('');
  const snapshot=JSON.stringify(shot);
  useEffect(()=>{
    let live=true; setPreview(null);setError('');
    if(!projectId || !assemblyId || !shotId) return;
    const timer=setTimeout(()=>{
      void productionApi.sentenceReplicationPreview({projectId,assemblyId,shotId,language,shot:JSON.parse(snapshot)})
        .then(result=>{if(live)setPreview(result);}).catch(reason=>{if(live)setError(reason instanceof Error?reason.message:String(reason));});
    },350);
    return ()=>{live=false;clearTimeout(timer);};
  },[projectId,assemblyId,shotId,language,snapshot]);
  return <section aria-label="修改影响与费用" className="space-y-2 rounded-lg border bg-violet-50 p-3 text-xs">
    <h3 className="font-bold">修改影响与费用</h3>
    {!projectId ? <p>保存草稿后可查看逐镜修改影响与费用。</p> : error ? <p role="alert">{error}</p> : !preview ? <p>正在计算…</p> : <>
      {preview.impacts.map((item,index)=><p key={item.cueId}><b>镜头 {index+1}：</b>{item.reason}</p>)}
      <p className="font-bold">{preview.estimatedCostCny===null ? preview.estimateError : `预计新增生成费用 ¥${preview.estimatedCostCny.toFixed(2)}`}</p>
      <p className="text-text-muted">费用为提交前估算，以供应商账单为准；只有输入一致且通过质量验收的视频会自动复用。更换字幕、音乐或剪辑顺序时可沿用人物视频。</p>
    </>}
    <p className="text-text-muted">成片字幕使用生成视频的实测时间码；缺少时间码时请先测量原声字幕。</p>
  </section>;
}

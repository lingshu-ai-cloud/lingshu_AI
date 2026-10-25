import { useEffect, useState } from 'react';
import { Alert, Button, InputNumber, Select, Spin, Upload } from 'antd';
import type { AssistantCreationPortal } from '../../../shared/contracts/assistantCreationPortal';
import { studioApi, type Material } from '../../lib/studioApi';
import { AuthenticatedVideo, AuthenticatedImage } from '../inspiration/InspirationMedia';

export default function AssistantHookPicker({ portal, update, current }: {
  portal:AssistantCreationPortal; update:(patch:Partial<AssistantCreationPortal>)=>void; current:()=>boolean;
}) {
  const [items,setItems]=useState<Material[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [page,setPage]=useState(1),[total,setTotal]=useState(0),[revision,setRevision]=useState(0),[uploading,setUploading]=useState(false);
  const [selected,setSelected]=useState(portal.hook?.materialId||''),[preview,setPreview]=useState('');
  const [start,setStart]=useState(portal.hook?.startSeconds||0),[end,setEnd]=useState(portal.hook?.endSeconds||3);
  const [usage,setUsage]=useState<'editable'|'reference_only'>(portal.hook?.usage||'reference_only');
  useEffect(()=>{
    let active=true;setLoading(true);setError('');
    void studioApi.listMaterialLibrary('all',{page,pageSize:12}).then(result=>{
      if(!active||!current())return;
      setItems(result.items.filter(item=>item.type==='video'));setTotal(result.total||0);
      if(result.status!=='ready')setError('部分素材暂时不可用，可重试或上传自己的片段。');
    }).catch(cause=>{if(active&&current())setError(cause instanceof Error?cause.message:'素材读取失败');})
      .finally(()=>{if(active&&current())setLoading(false);});return()=>{active=false;};
  },[page,revision]);
  const selectedItem=items.find(item=>item.id===selected);
  const duration=selectedItem?.duration||0;
  return <section aria-label="选择开场片段" className="space-y-3">
    <p className="text-sm">从已有候选中选一个开场，或上传自己的视频片段。</p>
    {error&&<Alert type="warning" title={error} action={<Button onClick={()=>setRevision(v=>v+1)}>重试</Button>}/>}
    {loading&&<Spin size="small"/>}
    <div className="replication-thumbnails" role="group" aria-label="开场候选">
      {items.map(item=><button type="button" key={item.id} aria-pressed={item.id===selected} aria-label={`选择开场：${item.name}`}
        className={`replication-thumbnail overflow-hidden rounded-lg border ${item.id===selected?'border-accent ring-2 ring-accent':'border-border'}`}
        onClick={()=>{setSelected(item.id);setStart(0);setEnd(Math.min(3,item.duration||3));setUsage('reference_only');}}
        onMouseEnter={()=>setPreview(item.id)} onMouseLeave={()=>setPreview('')} onFocus={()=>setPreview(item.id)} onBlur={()=>setPreview('')}>
        <div className="relative h-24 bg-surface-2">{item.poster ? <AuthenticatedImage src={item.poster} alt={item.name} className="absolute inset-0 h-full w-full object-cover"/> : <span className="absolute inset-0 grid place-items-center text-xs text-text-muted">视频片段</span>}
          {preview===item.id&&item.url&&<AuthenticatedVideo apiUrl={item.url} previewActive controls={false} className="absolute inset-0 h-full w-full object-cover"
            onMetadata={metadata=>{if(current()&&Number.isFinite(metadata.duration)&&metadata.duration>0)setItems(previous=>previous.map(row=>row.id===item.id?{...row,duration:metadata.duration}:row));}}/>}</div>
        <span className="block truncate px-1 py-1 text-xs" title={item.name}>{item.name}</span>
      </button>)}
    </div>
    {!loading&&!error&&!items.length&&<p className="text-xs text-text-secondary">这一批没有视频片段，可继续换批或上传。</p>}
    <div className="flex flex-wrap justify-between gap-2"><Button disabled={loading||total<=12} onClick={()=>{setSelected('');setPage(page*12>=total?1:page+1);}}>换一批</Button>
      <Upload accept="video/mp4,video/quicktime,video/webm" showUploadList={false} disabled={uploading} beforeUpload={file=>{
        setUploading(true);setError('');void studioApi.uploadMaterialFile(file,{type:'video',sourceType:'upload'}).then(result=>{
          if(!current())return;if(!result.ok||!result.material)throw Error(result.error||'上传失败');
          setItems(previous=>[result.material,...previous]);setSelected(result.material.id);setUsage('reference_only');
        }).catch(cause=>{if(current())setError(cause instanceof Error?cause.message:'上传失败');}).finally(()=>setUploading(false));return false;
      }}><Button loading={uploading}>上传自己的片段</Button></Upload></div>
    {selectedItem&&<>
      <p className="text-xs text-text-secondary">已选：{selectedItem.name}。确认片段范围和用途。</p>
      <div className="flex flex-wrap items-center gap-2"><label>开始（秒） <InputNumber aria-label="开场开始秒数" min={0} max={duration||undefined} value={start} onChange={v=>setStart(v??0)}/></label>
        <label>结束（秒） <InputNumber aria-label="开场结束秒数" min={0} max={duration||undefined} value={end} onChange={v=>setEnd(v??0)}/></label></div>
      <Select className="w-full" aria-label="开场用途" value={usage} onChange={setUsage} options={[
        {value:'reference_only',label:'只参考结构，画面需重新制作'},
        ...(selectedItem.usage==='editable'?[{value:'editable',label:'使用企业已有可编辑素材'}]:[]),
      ]}/>
      {!duration&&<p className="text-xs text-text-secondary">视频时长尚未读取，暂不能确认片段。请在素材库补充或重新上传。</p>}
    </>}
    <div className="flex justify-end"><Button type="primary" disabled={!selectedItem||!duration||end<=start||end>duration||uploading} onClick={()=>{
      if(selectedItem&&current())update({hook:{materialId:selectedItem.id,name:selectedItem.name.slice(0,160),startSeconds:start,endSeconds:end,duration,usage},sceneStep:'brief'});
    }}>确认这个开场</Button></div>
  </section>;
}

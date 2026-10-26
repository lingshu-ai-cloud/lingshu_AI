import { useState } from 'react';
import { Film } from 'lucide-react';
import type { CreationTaskRow } from '../../lib/creationTaskWorkspace';
import { AuthenticatedImage } from '../inspiration/InspirationMedia';

export default function CreationTaskCover({row}:{row:CreationTaskRow}) {
  const [failed,setFailed]=useState<string[]>([]);
  const sources=[...new Set([row.cover,...(row.productImages||[])].filter(Boolean))];
  const src=sources.find(url=>!failed.includes(url));
  if(!src)return <Film size={22} aria-label="暂无产品照片或成片封面"/>;
  const label=src===row.summary?.preview?.coverUrl?'成片封面':'产品照片';
  return <AuthenticatedImage key={src} src={src} alt={`${row.title} · ${label}`} className="h-full w-full object-contain" onError={()=>setFailed(urls=>[...urls,src])}/>;
}

import { useState } from 'react';
import { Button } from 'antd';
import { AuthenticatedVideo } from '../inspiration/InspirationMedia';
import { LsMediaStateFrame, type LsMediaState } from '../ui/LsExperiencePrimitives';
import type { CreationShot } from '../../../shared/contracts/contentCreationDialogue';

export default function ContentCreationShotPreview({ shot }: { shot: CreationShot }) {
  const [state, setState] = useState<LsMediaState>('loading');
  const [revision, setRevision] = useState(0);
  if (!shot.previewUrl) return <p>暂无独立片段预览；保留时间范围与来源证据。</p>;
  return <div>
    <LsMediaStateFrame state={state} label={state === 'error' ? '片段加载失败，可重试或查看来源' : '正在读取分镜片段'} className="min-h-40">
      <AuthenticatedVideo key={revision} apiUrl={`${shot.previewUrl}#t=${shot.start},${shot.end}`} controls loadOnMount preload="metadata"
        className="w-full max-h-[45dvh] object-contain" onReady={() => setState('ready')} onError={() => setState('error')}/>
    </LsMediaStateFrame>
    {state === 'error' && <Button onClick={() => { setState('loading'); setRevision(value => value + 1); }}>重试片段</Button>}
  </div>;
}

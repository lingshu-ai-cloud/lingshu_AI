import { useEffect, useRef, useState } from 'react';

/** Key this component by URL so errors never leak across output versions. */
export default function RenderedVideoPlayer({ src, onActivate }: { src: string; onActivate: () => void }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const activateRef = useRef(onActivate);
  useEffect(() => { activateRef.current(); }, []);
  return <div className="absolute inset-0 bg-black">
    <video key={attempt} src={src} controls playsInline preload="metadata"
      aria-label="实际导出的成片" className="h-full w-full object-contain"
      onError={() => setFailed(true)} />
    {failed && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 p-5 text-center text-xs text-white">
      <p>成片加载失败，未切换为素材模拟预览。文件可能已失效或无法解码；重试无效时，请保存并重新打开草稿刷新访问地址。</p>
      <button type="button" className="rounded-lg border border-white/50 px-3 py-2" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>重新加载成片</button>
    </div>}
  </div>;
}

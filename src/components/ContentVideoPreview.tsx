import { useEffect, useRef, useState } from 'react';

type Props = { src: string; poster?: string; className?: string };

function assetIdentity(src: string) {
  const url = new URL(src, window.location.href);
  url.searchParams.delete('assetToken');
  return url.href;
}

// A new file mounts a new player; a renewed access token does not.
export default function ContentVideoPreview(props: Props) {
  return <Player key={assetIdentity(props.src)} {...props} />;
}

function Player({ src, poster, className }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [playbackSrc, setPlaybackSrc] = useState(src);
  const [failed, setFailed] = useState(false);
  const playing = useRef(false);
  const resume = useRef<{ time: number; playing: boolean } | null>(null);

  function retry() {
    const element = video.current;
    if (!element?.error || src === playbackSrc) return;
    resume.current ??= { time: element.currentTime, playing: playing.current };
    setFailed(false);
    setPlaybackSrc(src);
  }

  // Keep the mounted media source stable across library polls, including while
  // paused. If access expires, use the latest signed URL and restore playback.
  useEffect(() => { retry(); }, [src, playbackSrc]);

  return <>
    <video ref={video} controls preload={resume.current ? 'metadata' : 'none'} poster={poster} src={playbackSrc} className={className}
      onPlay={() => { playing.current = true; }}
      onPause={() => { if (!video.current?.error) playing.current = false; }}
      onEnded={() => { playing.current = false; }}
      onError={() => { setFailed(true); retry(); }}
      onLoadedMetadata={() => {
        const element = video.current;
        const position = resume.current;
        if (!element || !position) return;
        resume.current = null;
        element.currentTime = position.time;
        if (position.playing) void element.play().catch(() => { playing.current = false; });
      }}
    />
    {failed && <p role="status" className="text-xs text-red-600">视频暂时无法播放，请刷新重试或下载 MP4 查看。</p>}
  </>;
}

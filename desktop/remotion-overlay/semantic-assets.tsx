import React, { useState } from 'react';
import { Gif } from '@remotion/gif';
import { Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import cropData from './asset-crops.json';

export type SemanticAssetKind = 'key_fact' | 'reveal' | 'warning' | 'urgency' | 'cta';

const Rays: React.FC<{ progress: number; color?: string }> = ({ progress, color = '#FFE531' }) => {
  const rays = Array.from({ length: 10 }, (_, index) => index * 36);
  return <svg viewBox="0 0 240 240" width="100%" height="100%" style={{ overflow: 'visible' }}>
    <g transform={`translate(120 120) scale(${.76 + progress * .24})`} opacity={progress}>
      {rays.map(angle => <path key={angle} d="M-9 -72 L9 -72 L15 -116 L-15 -116 Z"
        transform={`rotate(${angle})`} fill={color} stroke="#171717" strokeWidth="4" strokeLinejoin="round" />)}
    </g>
  </svg>;
};

const Warning: React.FC<{ progress: number }> = ({ progress }) => <svg viewBox="0 0 220 220" width="100%" height="100%">
  <g transform={`translate(110 110) scale(${.6 + progress * .4})`} opacity={progress}>
    <path d="M0-94 78 70-78 70Z" fill="#FFD05F" stroke="#3C260E" strokeWidth="12" strokeLinejoin="round" />
    <path d="M0-48V22" stroke="white" strokeWidth="18" strokeLinecap="round" />
    <circle cy="50" r="10" fill="white" />
  </g>
</svg>;

const Lightning: React.FC<{ progress: number }> = ({ progress }) => <svg viewBox="0 0 220 220" width="100%" height="100%">
  <g transform={`translate(110 110) rotate(${-9 + progress * 9}) scale(${.55 + progress * .45})`} opacity={progress}>
    <path d="M20-102-64 17-10 8-39 104 72-26 15-13Z" fill="#E84217" stroke="#4B160A" strokeWidth="8" strokeLinejoin="round" />
  </g>
</svg>;

const Megaphone: React.FC<{ progress: number }> = ({ progress }) => <svg viewBox="0 0 260 220" width="100%" height="100%">
  <g transform={`translate(20 22) scale(${.72 + progress * .28})`} opacity={progress} stroke="#111827" strokeWidth="8" strokeLinejoin="round">
    <path d="M25 84 116 35v125L25 112Z" fill="#D8EEFF" />
    <ellipse cx="122" cy="97" rx="42" ry="65" fill="#9FD3F5" />
    <path d="m38 113 20 57h38l-14-77" fill="#FFC83D" />
    {[0, 1, 2].map(i => <path key={i} d={`M172 ${54 + i * 42} 224 ${36 + i * 42}`} stroke="#FFC83D" strokeLinecap="round" />)}
  </g>
</svg>;

const FILES: Record<SemanticAssetKind, { file: string; animated: boolean }> = {
  key_fact: { file: 'burst-rays-yellow-static.png', animated: false },
  reveal: { file: 'burst-rays-yellow.gif', animated: true },
  warning: { file: 'emphasis-rays-yellow.gif', animated: true },
  urgency: { file: 'lightning-orange.gif', animated: true },
  cta: { file: 'megaphone-blue-yellow.gif', animated: true },
};
type Crop = { x: number; y: number; width: number; height: number };
const CROPS = cropData.assets as Record<string, Crop>;

const SvgFallback: React.FC<{ kind: SemanticAssetKind; progress: number }> = ({ kind, progress }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const loop = (Math.sin(frame / fps * Math.PI * 3) + 1) / 2;
  if (kind === 'warning') return <Warning progress={progress} />;
  if (kind === 'urgency') return <Lightning progress={Math.min(1, progress * (.9 + loop * .1))} />;
  if (kind === 'cta') return <Megaphone progress={progress} />;
  const breathe = interpolate(loop, [0, 1], [.94, 1.04]);
  return <div style={{ width: '100%', height: '100%', transform: `scale(${breathe}) rotate(${kind === 'reveal' ? frame / fps * 3 : 0}deg)` }}>
    <Rays progress={progress} color={kind === 'reveal' ? '#FFF15A' : '#FFE531'} />
  </div>;
};

/** Runtime uses the user's original transparent assets. The SVGs above are
 * deliberately mounted only after an asset load error. @remotion/gif selects
 * the image from the current video frame, so rendering does not depend on the
 * browser's wall clock. */
export const SemanticAsset: React.FC<{ kind: SemanticAssetKind; progress: number }> = ({ kind, progress }) => {
  const [failed, setFailed] = useState(false);
  const asset = FILES[kind];
  if (failed) return <SvgFallback kind={kind} progress={progress} />;
  const crop = CROPS[asset.file] || { x: 0, y: 0, width: 1, height: 1 };
  const style: React.CSSProperties = {
    position: 'absolute', left: `${-crop.x / crop.width * 100}%`, top: `${-crop.y / crop.height * 100}%`,
    width: `${100 / crop.width}%`, height: `${100 / crop.height}%`, objectFit: 'fill', opacity: progress,
  };
  return <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
    {asset.animated
      ? <Gif src={staticFile(asset.file)} fit="fill" loopBehavior="loop" style={style} onError={() => setFailed(true)} />
      : <Img src={staticFile(asset.file)} style={style} onError={() => setFailed(true)} />}
  </div>;
};

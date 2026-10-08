import React, { useState } from 'react';
import { Gif } from '@remotion/gif';
import { Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import playbackData from './asset-playback.json';

export type SemanticAssetKind = 'key_fact' | 'reveal' | 'warning' | 'urgency' | 'cta';
export type MotionRole = 'surround' | 'point_to' | 'adjacent' | 'caption_companion' | 'corner_badge';

export const ASSET_REGISTRY: Record<MotionRole, { id: string; family: 'rays' | 'directional' | 'badge'; allowedRoles: MotionRole[] }> = {
  surround: { id: 'surround_rays', family: 'rays', allowedRoles: ['surround'] },
  point_to: { id: 'pointer_shard', family: 'directional', allowedRoles: ['point_to'] },
  adjacent: { id: 'adjacent_badge', family: 'badge', allowedRoles: ['adjacent'] },
  caption_companion: { id: 'caption_accent', family: 'directional', allowedRoles: ['caption_companion'] },
  corner_badge: { id: 'corner_badge', family: 'badge', allowedRoles: ['corner_badge'] },
};

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

const RoleGraphic: React.FC<{ role: Exclude<MotionRole, 'surround'>; progress: number; text: string; direction: string }> = ({ role, progress, text, direction }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const breathe = 1 + Math.sin(frame / fps * Math.PI * 2.4) * .025;
  const rotate = direction === 'left' ? 180 : direction === 'top' ? -90 : direction === 'bottom' ? 90 : 0;
  const number = text.match(/\d+(?:[.,]\d+)?%?/)?.[0] || (role === 'corner_badge' ? '!' : '•');
  if (role === 'point_to') return <svg viewBox="0 0 240 180" width="100%" height="100%"><g opacity={progress}
    transform={`translate(120 90) rotate(${rotate}) scale(${(.72 + progress * .28) * breathe})`}>
    <path d="M-98-25H32V-58L104 0 32 58V25H-98Z" fill="#FFE36A" stroke="#3B3420" strokeWidth="8" strokeLinejoin="round" />
    <path d="M-80 0H40" stroke="white" strokeWidth="8" strokeLinecap="round" opacity=".7" /></g></svg>;
  if (role === 'caption_companion') return <svg viewBox="0 0 260 100" width="100%" height="100%"><g opacity={progress}
    transform={`translate(10 12) scale(${.82 + progress * .18},1)`}>
    <path d="M4 60C55 30 132 82 238 38" fill="none" stroke="#FFE36A" strokeWidth="13" strokeLinecap="round" />
    <path d="m218 13 11 16 20 2-15 13 4 20-18-10-18 10 5-20-15-13 20-2Z" fill="#FFF4A5" /></g></svg>;
  const corner = role === 'corner_badge';
  return <svg viewBox="0 0 220 180" width="100%" height="100%"><g opacity={progress}
    transform={`translate(110 90) scale(${(.68 + progress * .32) * breathe})`}>
    {corner ? <path d="M-91-62H65L91-36V62H-91Z" fill="#FFF7D1" stroke="#403A2B" strokeWidth="7" strokeLinejoin="round" />
      : <circle r="72" fill="#FFE36A" stroke="#403A2B" strokeWidth="8" />}
    <text x="0" y="17" textAnchor="middle" fontFamily="Source Han Sans SC, sans-serif" fontWeight="800"
      fontSize={number.length > 4 ? 42 : 58} fill="#302C24">{number}</text></g></svg>;
};

const FILES: Record<SemanticAssetKind, { file: string; animated: boolean }> = {
  key_fact: { file: 'burst-rays-yellow-static.png', animated: false },
  reveal: { file: 'burst-rays-yellow.gif', animated: true },
  warning: { file: 'emphasis-rays-yellow.gif', animated: true },
  urgency: { file: 'lightning-orange.gif', animated: true },
  cta: { file: 'megaphone-blue-yellow.gif', animated: true },
};
type Playback = { frameCount: number; frameDelayMs: number; effectiveStartFrame: number; effectiveEndFrame: number; holdFrame: number; holdAsset: string; durationMs: number; alphaCoverage: number[] };
const PLAYBACK = playbackData.assets as Record<string, Playback>;

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
export const SemanticAsset: React.FC<{ kind: SemanticAssetKind; progress: number; role: MotionRole; text?: string; direction?: string; eventDurationFrames: number }> = ({ kind, role, progress, eventDurationFrames, text = '', direction = 'right' }) => {
  const [failed, setFailed] = useState(false);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (role !== 'surround') return <RoleGraphic role={role} progress={progress} text={text} direction={direction} />;
  const asset = FILES[kind];
  if (failed) return <SvgFallback kind={kind} progress={progress} />;
  const playback = PLAYBACK[asset.file];
  const playbackRate = Math.max(1, (playback?.durationMs || 1000) / Math.max(1, eventDurationFrames / fps * 1000 * .72));
  const effectiveStartOffset = Math.round((playback?.effectiveStartFrame || 0) * (playback?.frameDelayMs || 0) / 1000 * fps / playbackRate);
  const playFrames = Math.max(1, Math.ceil((playback?.durationMs || 1000) / 1000 * fps / playbackRate));
  const style: React.CSSProperties = {
    position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: progress,
  };
  return <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
    {asset.animated && frame < playFrames
      ? <Gif src={staticFile(asset.file)} fit="fill" loopBehavior="pause-after-finish"
        from={-effectiveStartOffset} playbackRate={playbackRate}
        style={style} onError={() => setFailed(true)} />
      : <Img src={staticFile(asset.animated ? playback.holdAsset : asset.file)} style={style} onError={() => setFailed(true)} />}
  </div>;
};

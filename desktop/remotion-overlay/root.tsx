import React from 'react';
import { AbsoluteFill, Composition, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { SemanticAsset, type SemanticAssetKind } from './semantic-assets';

type Point = { x: number; y: number };
type OverlayEvent = { id: string; type: 'key_fact' | 'reveal' | 'cta'; assetKind: SemanticAssetKind; startMs: number; endMs: number; text: string; placement: Point & { source: string }; subjectAnchor?: Point };
type OverlayProps = { durationFrames: number; fps: number; width: number; height: number; profile: string; events: OverlayEvent[] };

const colors: Record<string, { accent: string; ink: string; panel: string }> = {
  d2c_dialogue: { accent: '#FFD83D', ink: '#23142E', panel: '#FFF3A8' },
  talking_head: { accent: '#FFE04E', ink: '#171717', panel: '#FFF6B8' },
  factory_process: { accent: '#4CB3F0', ink: '#081923', panel: '#D9F1FF' },
  product_showcase: { accent: '#CFFF6C', ink: '#14231F', panel: '#E9FFC0' },
};

const EventCard: React.FC<{ event: OverlayEvent; profile: string }> = ({ event, profile }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const palette = colors[profile] || colors.talking_head;
  const enter = spring({ frame, fps, config: event.type === 'key_fact'
    ? { damping: 11, stiffness: 250, mass: .65 }
    : event.type === 'reveal' ? { damping: 15, stiffness: 180, mass: .8 }
      : { damping: 12, stiffness: 220, mass: .7 }, durationInFrames: Math.round(.45 * fps) });
  const duration = Math.max(1, Math.round((event.endMs - event.startMs) / 1000 * fps));
  const exit = interpolate(frame, [Math.max(0, duration - .2 * fps), duration], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  const pulse = event.type === 'cta' && frame > .35 * fps ? 1 + Math.sin((frame / fps - .35) * Math.PI * 3.4) * .065 : 1;
  const isFact = event.type === 'key_fact';
  const x = `${event.placement.x * 100}%`;
  const y = `${event.placement.y * 100}%`;
  const assetAnchor = event.subjectAnchor || event.placement;
  const assetSize = width * (event.assetKind === 'cta' ? .28 : event.assetKind === 'key_fact' || event.assetKind === 'reveal' ? .36 : .22);
  const slide = interpolate(enter, [0, 1], [event.placement.x < .5 ? -24 : 24, 0]);
  return <>
    <div style={{ position: 'absolute', left: `${assetAnchor.x * 100}%`, top: `${assetAnchor.y * 100}%`, width: assetSize, height: assetSize,
      transform: `translate(-50%, -50%) scale(${enter * pulse})`, opacity: exit, transformOrigin: 'center' }}>
      <SemanticAsset kind={event.assetKind} progress={enter} />
    </div>
    <div style={{
      position: 'absolute', left: x, top: y, transform: `translate(calc(-50% + ${slide}px), -50%) scale(${enter})`, opacity: exit,
      padding: `${width * .009}px ${width * .018}px`, borderRadius: width * .012,
      background: 'rgba(16,16,16,.76)', color: event.assetKind === 'urgency' ? '#FF6A3D' : palette.accent,
      borderLeft: `${Math.max(3, width * .006)}px solid ${event.assetKind === 'urgency' ? '#E84217' : palette.accent}`,
      fontFamily: 'Source Han Sans SC, PingFang SC, sans-serif', fontSize: width * (isFact ? .046 : .043),
      fontWeight: 800, lineHeight: 1.12, maxWidth: width * .46, textAlign: 'left', whiteSpace: 'normal', wordBreak: 'keep-all',
    }}>{event.text}</div>
  </>;
};

const Overlay: React.FC<OverlayProps> = ({ events, profile }) => {
  const { fps } = useVideoConfig();
  return <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
    {events.map(event => {
      const from = Math.max(0, Math.round(event.startMs / 1000 * fps));
      const durationInFrames = Math.max(1, Math.round((event.endMs - event.startMs) / 1000 * fps));
      return <Sequence key={event.id} from={from} durationInFrames={durationInFrames} layout="none">
        <EventCard event={event} profile={profile} />
      </Sequence>;
    })}
  </AbsoluteFill>;
};

const defaults: OverlayProps = { durationFrames: 600, fps: 30, width: 720, height: 1280, profile: 'talking_head', events: [] };

export const OverlayRoot: React.FC = () => <Composition
  id="EmphasisOverlay"
  component={Overlay}
  durationInFrames={defaults.durationFrames}
  fps={defaults.fps}
  width={defaults.width}
  height={defaults.height}
  defaultProps={defaults}
  calculateMetadata={({ props }) => ({
    durationInFrames: props.durationFrames,
    fps: props.fps,
    width: props.width,
    height: props.height,
    props,
  })}
/>;

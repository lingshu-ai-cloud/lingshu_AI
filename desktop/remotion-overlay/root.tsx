import React from 'react';
import { AbsoluteFill, Composition, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { SemanticAsset, type SemanticAssetKind } from './semantic-assets';

type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };
type OverlayEvent = { id: string; type: 'key_fact' | 'reveal' | 'cta'; assetKind: SemanticAssetKind; startMs: number; endMs: number; text: string; placement: Point & { source: string }; layout: { asset: Rect; label: Rect; mode: string }; presentationMode: 'label' | 'graphic_only'; targetRelation: 'surround' | 'point_to' | 'adjacent'; shotId?: string; playbackKey: string; subjectAnchor?: Point };
type OverlayProps = { durationFrames: number; fps: number; width: number; height: number; profile: string; events: OverlayEvent[] };

const EventCard: React.FC<{ event: OverlayEvent }> = ({ event }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const enter = spring({ frame, fps, config: event.type === 'key_fact'
    ? { damping: 11, stiffness: 250, mass: .65 }
    : event.type === 'reveal' ? { damping: 15, stiffness: 180, mass: .8 }
      : { damping: 12, stiffness: 220, mass: .7 }, durationInFrames: Math.round(.45 * fps) });
  const duration = Math.max(1, Math.round((event.endMs - event.startMs) / 1000 * fps));
  const exit = interpolate(frame, [Math.max(0, duration - .2 * fps), duration], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  const pulse = event.type === 'cta' && frame > .35 * fps ? 1 + Math.sin((frame / fps - .35) * Math.PI * 3.4) * .065 : 1;
  const isFact = event.type === 'key_fact';
  const { asset: assetRect, label: labelRect } = event.layout;
  const slide = interpolate(enter, [0, 1], [labelRect.x < .5 ? -18 : 18, 0]);
  return <>
    <div style={{ position: 'absolute', left: `${assetRect.x * 100}%`, top: `${assetRect.y * 100}%`, width: `${assetRect.width * 100}%`, height: `${assetRect.height * 100}%`,
      transform: `scale(${enter * pulse})`, opacity: exit, transformOrigin: labelRect.x < assetRect.x ? 'right center' : 'left center' }}>
      <SemanticAsset kind={event.assetKind} progress={enter} eventDurationFrames={duration} />
    </div>
    {event.presentationMode === 'label' && <div style={{
      position: 'absolute', left: `${labelRect.x * 100}%`, top: `${labelRect.y * 100}%`, width: `${labelRect.width * 100}%`, minHeight: `${labelRect.height * 100}%`,
      transform: `translateX(${slide}px) scale(${enter})`, opacity: exit, boxSizing: 'border-box',
      padding: `${width * .009}px ${width * .016}px`, borderRadius: width * .012,
      background: 'rgba(255,255,255,.88)', color: '#2B2B2B', border: `1px solid rgba(43,43,43,.16)`,
      boxShadow: `0 ${width * .005}px ${width * .018}px rgba(0,0,0,.16)`,
      fontFamily: 'Source Han Sans SC, PingFang SC, sans-serif', fontSize: width * (isFact ? .042 : .04),
      fontWeight: 750, lineHeight: 1.14, display: 'flex', alignItems: 'center', textAlign: 'left', whiteSpace: 'normal', wordBreak: 'keep-all',
    }}>{event.text}</div>}
  </>;
};

const Overlay: React.FC<OverlayProps> = ({ events }) => {
  const { fps } = useVideoConfig();
  return <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
    {events.map(event => {
      const from = Math.max(0, Math.round(event.startMs / 1000 * fps));
      const durationInFrames = Math.max(1, Math.round((event.endMs - event.startMs) / 1000 * fps));
      return <Sequence key={`${event.id}:${event.playbackKey}`} from={from} durationInFrames={durationInFrames} layout="none">
        <EventCard event={event} />
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

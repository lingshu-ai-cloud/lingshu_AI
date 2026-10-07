import React from 'react';
import { AbsoluteFill, Composition, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

type OverlayEvent = { id: string; type: 'key_fact' | 'reveal' | 'cta'; startMs: number; endMs: number; text: string };
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
  const enter = spring({ frame, fps, config: { damping: 13, stiffness: 240, mass: .7 }, durationInFrames: Math.round(.45 * fps) });
  const duration = Math.max(1, Math.round((event.endMs - event.startMs) / 1000 * fps));
  const exit = interpolate(frame, [Math.max(0, duration - .2 * fps), duration], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  const pulse = event.type === 'cta' ? 1 + Math.sin(frame / fps * Math.PI * 3) * .035 : 1;
  const isFact = event.type === 'key_fact';
  const isReveal = event.type === 'reveal';
  return <div style={{
    position: 'absolute', left: '50%', top: isReveal ? '61%' : '67%',
    translate: '-50% -50%', scale: enter * pulse, rotate: isFact ? `${interpolate(enter, [0, 1], [-7, -2])}deg` : '0deg',
    opacity: exit, padding: isFact ? `${width * .025}px ${width * .042}px` : `${width * .022}px ${width * .039}px`,
    borderRadius: isFact ? width * .03 : 999, background: palette.panel, color: palette.ink,
    border: `${Math.max(2, width * .007)}px solid ${palette.ink}`,
    boxShadow: `${width * .014}px ${width * .017}px 0 ${palette.ink}`,
    fontFamily: 'Source Han Sans SC, PingFang SC, sans-serif',
    fontSize: width * (isFact ? .081 : .067), fontWeight: 900, lineHeight: 1.05, whiteSpace: 'nowrap',
  }}>
    <span style={{ color: palette.ink }}>{isFact ? '✦ ' : event.type === 'cta' ? '▶ ' : '✓ '}</span>{event.text}
  </div>;
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

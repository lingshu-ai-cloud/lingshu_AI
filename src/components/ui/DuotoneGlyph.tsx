export type DuotoneGlyphKind =
  | 'home' | 'inspiration' | 'create' | 'publish' | 'monitor'
  | 'ads' | 'campaign' | 'agent' | 'customers' | 'orders'
  | 'enterprise' | 'memory' | 'schedule' | 'integration' | 'permissions';

export default function DuotoneGlyph({ kind, active = false, size = 28 }: { kind: DuotoneGlyphKind; active?: boolean; size?: number }) {
  const common = {
    stroke: '#10244a',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  const teal = active ? '#2fd1c5' : '#8fe4d8';
  const lavender = active ? '#8b7cf6' : '#b8b0fb';
  const shape = (() => {
    if (kind === 'home') return <><path d="M5 11.5 12 5l7 6.5V20h-5v-5h-4v5H5Z" fill={teal} {...common}/><path d="M4 12 12 4.5 20 12" {...common}/></>;
    if (kind === 'inspiration') return <><path d="M8 13.5c-1.2-1-2-2.4-2-4A6 6 0 0 1 18 9.5c0 1.7-.7 3-2 4-.8.7-1.2 1.2-1.3 2.3H9.3C9.2 14.7 8.8 14.2 8 13.5Z" fill={teal} {...common}/><path d="M9.5 19h5M10 16h4M12 2v1.5M4.5 5l1.1 1M19.5 5l-1.1 1" {...common}/></>;
    if (kind === 'create') return <><rect x="4" y="5" width="12" height="15" rx="2.5" fill="#fff" {...common}/><path d="m13.5 16 5.8-5.8 1.5 1.5-5.8 5.8-2.3.7Z" fill={lavender} {...common}/><path d="M7.5 9h5M7.5 12h3.5" {...common}/></>;
    if (kind === 'publish') return <><path d="m4 11 16-6-5 15-3.3-6.2Z" fill={teal} {...common}/><path d="m11.7 13.8 3.7-3.5" {...common}/></>;
    if (kind === 'monitor') return <><path d="M4 19V9M9 19V12M14 19V5M19 19V8" {...common}/><rect x="6.8" y="12" width="4.2" height="7" rx="1" fill={teal}/><rect x="16.8" y="8" width="4.2" height="11" rx="1" fill={lavender}/></>;
    if (kind === 'ads' || kind === 'campaign') return <><path d="M5 12h3l8-4v9l-8-4H5Z" fill={kind === 'campaign' ? lavender : teal} {...common}/><path d="m8 14 1.2 5h3L11 14M19 9.5c1.3 1.1 1.3 3.9 0 5" {...common}/></>;
    if (kind === 'agent') return <><rect x="5" y="7" width="14" height="12" rx="4" fill={teal} {...common}/><path d="M12 7V4M9 12h.01M15 12h.01M9.5 16h5M3 11v4M21 11v4" {...common}/></>;
    if (kind === 'customers') return <><circle cx="9" cy="9" r="3" fill={teal} {...common}/><circle cx="16.5" cy="10" r="2.5" fill={lavender} {...common}/><path d="M4 20c.3-4 2.1-6 5-6s4.7 2 5 6M13 15c3.8-.5 6 1.2 6.5 4.5" {...common}/></>;
    if (kind === 'orders') return <><rect x="5" y="4" width="14" height="16" rx="2.5" fill="#fff" {...common}/><path d="M8 4.5h8V8H8ZM8 12h8M8 16h5" fill={lavender} {...common}/></>;
    if (kind === 'enterprise') return <><path d="M5 20V7l7-3v16M12 9h7v11" fill="#fff" {...common}/><path d="M8 9h1M8 12h1M8 15h1M15 12h1M15 15h1" stroke={teal} strokeWidth="2.4" strokeLinecap="round"/></>;
    if (kind === 'memory') return <><path d="M8 5a3 3 0 0 0-3 3v2a3 3 0 0 0 0 5v1a3 3 0 0 0 5 2.2V5.8A3 3 0 0 0 8 5ZM16 5a3 3 0 0 1 3 3v2a3 3 0 0 1 0 5v1a3 3 0 0 1-5 2.2V5.8A3 3 0 0 1 16 5Z" fill={lavender} {...common}/><path d="M10 8h4M10 12h4M10 16h4" {...common}/></>;
    if (kind === 'schedule') return <><rect x="4" y="6" width="16" height="14" rx="3" fill="#fff" {...common}/><path d="M4 10h16M8 4v4M16 4v4" {...common}/><circle cx="12" cy="15" r="2.5" fill={teal} {...common}/></>;
    if (kind === 'permissions') return <><path d="M12 3 19 6v5c0 4.5-2.8 7.7-7 10-4.2-2.3-7-5.5-7-10V6Z" fill={lavender} {...common}/><path d="m9 12 2 2 4-4" {...common}/></>;
    return <><path d="M8 8h-2a3 3 0 0 0 0 6h3M16 8h2a3 3 0 0 1 0 6h-3" {...common}/><path d="M9 12h6" stroke={teal} strokeWidth="3" strokeLinecap="round"/></>;
  })();
  return <span aria-hidden="true" className={`duotone-glyph ${active ? 'duotone-glyph--active' : ''}`} style={{ width: size, height: size }}><svg viewBox="0 0 24 24" width="100%" height="100%" fill="none">{shape}</svg></span>;
}

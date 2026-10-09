import type { CSSProperties } from 'react';

export const CHART_TOOLTIP_STYLE: CSSProperties = {
  border: '1px solid #e4e4e7',
  borderRadius: 8,
  background: 'rgba(255, 255, 255, 0.98)',
  boxShadow: '0 10px 30px rgba(24, 24, 27, 0.1)',
  color: '#171717',
  fontSize: 11,
  lineHeight: 1.5,
  padding: '9px 11px',
};

export const CHART_CURSOR_STYLE = { fill: 'rgba(54, 162, 235, 0.06)' } as const;

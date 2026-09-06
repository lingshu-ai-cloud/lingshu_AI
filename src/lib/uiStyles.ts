import type { CSSProperties } from 'react';

export const CHART_TOOLTIP_STYLE: CSSProperties = {
  border: '1px solid #dfe8e1',
  borderRadius: 8,
  background: 'rgba(255, 255, 255, 0.98)',
  boxShadow: '0 14px 36px rgba(23, 61, 49, 0.12)',
  color: '#173d31',
  fontSize: 11,
  lineHeight: 1.5,
  padding: '9px 11px',
};

export const CHART_CURSOR_STYLE = { fill: 'rgba(22, 155, 98, 0.06)' } as const;

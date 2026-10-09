/** Implementation of PRD v2.3 §§3.3, 3.6–3.8. Durations are milliseconds. */
const spring = (stiffness: number) => ({
  type: 'spring' as const,
  mass: 1,
  stiffness,
  damping: 2 * 0.9 * Math.sqrt(stiffness),
});

export const lsMotion = {
  duration: { instant: 0, fast: 150, exit: 200, enter: 250, standard: 300, slow: 400 },
  ease: {
    standard: [0.2, 0, 0, 1] as [number, number, number, number],
    enter: [0, 0, 0, 1] as [number, number, number, number],
    exit: [0.3, 0, 1, 1] as [number, number, number, number],
  },
  spring: { fast: spring(1400), standard: spring(700), slow: spring(300) },
} as const;

export const lsFonts = {
  sans: '"SF Pro Text","PingFang SC","Noto Sans SC",ui-sans-serif,system-ui,sans-serif',
  mono: '"SFMono-Regular",ui-monospace,monospace',
} as const;

export const lsTypography = {
  display: { size: 36, line: 44, weight: 600 },
  headline: { size: 28, line: 36, weight: 600 },
  'title-large': { size: 20, line: 28, weight: 600 },
  'title-medium': { size: 16, line: 24, weight: 600 },
  'title-small': { size: 14, line: 22, weight: 600 },
  'body-large': { size: 16, line: 24, weight: 400 },
  'body-medium': { size: 14, line: 22, weight: 400 },
  'body-small': { size: 12, line: 18, weight: 400 },
  'label-large': { size: 14, line: 20, weight: 600 },
  'label-medium': { size: 12, line: 18, weight: 500 },
  'label-small': { size: 11, line: 18, weight: 500 },
  metric: { size: 24, line: 32, weight: 600 },
} as const;

export const lsCssVariables: Record<string, string> = {
  '--font-sans': lsFonts.sans,
  '--font-display': lsFonts.sans,
  '--font-mono': lsFonts.mono,
  ...Object.fromEntries(Object.entries(lsMotion.duration).map(([name, value]) => [`--ls-motion-${name}`, `${value}ms`])),
  ...Object.fromEntries(Object.entries(lsMotion.ease).map(([name, value]) => [`--ls-ease-${name}`, `cubic-bezier(${value.join(', ')})`])),
  ...Object.fromEntries(Object.entries(lsTypography).flatMap(([name, token]) => [
    [`--ls-type-${name}-size`, `${token.size}px`],
    [`--ls-type-${name}-line`, `${token.line}px`],
    [`--ls-type-${name}-weight`, String(token.weight)],
  ])),
  // Existing shared components keep these aliases while adopting semantic roles.
  '--ls-type-h1-size': 'var(--ls-type-headline-size)',
  '--ls-type-h1-line': 'var(--ls-type-headline-line)',
  '--ls-type-h2-size': 'var(--ls-type-title-large-size)',
  '--ls-type-h2-line': 'var(--ls-type-title-large-line)',
  '--ls-type-h3-size': 'var(--ls-type-title-medium-size)',
  '--ls-type-h3-line': 'var(--ls-type-title-medium-line)',
  '--ls-type-body-size': 'var(--ls-type-body-medium-size)',
  '--ls-type-body-line': 'var(--ls-type-body-medium-line)',
  '--ls-type-meta-size': 'var(--ls-type-body-small-size)',
  '--ls-type-meta-line': 'var(--ls-type-body-small-line)',
};

const tokenDeclarations = Object.entries(lsCssVariables).map(([name, value]) => `${name}:${value};`).join('');
const reducedMotionDeclarations = Object.keys(lsMotion.duration).map(name => `--ls-motion-${name}:0ms;`).join('');
const typographyClasses = Object.keys(lsTypography).map(name => `
.ls-type-${name}{font-family:var(--font-sans);font-size:var(--ls-type-${name}-size);line-height:var(--ls-type-${name}-line);font-weight:var(--ls-type-${name}-weight);letter-spacing:normal;}${name === 'metric' ? '.ls-type-metric{font-variant-numeric:tabular-nums;}' : ''}`).join('');

/** Root-scoped variables also reach Ant portals and independently mounted workspaces. */
export const lsDesignTokenCss = `:root{${tokenDeclarations}}${typographyClasses}@media(prefers-reduced-motion:reduce){:root{${reducedMotionDeclarations}}}`;

/** Generated base values come from shared/design/tokens.json. */
import { lsFonts, lsMotion, lsTypography, lsSharedCssVariables } from './designTokens.generated';
export { lsFonts, lsMotion, lsTypography, lsColors, lsDimensions } from './designTokens.generated';

export const lsCssVariables: Record<string, string> = {
  ...lsSharedCssVariables,
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

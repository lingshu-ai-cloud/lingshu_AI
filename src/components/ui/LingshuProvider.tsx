import { App, ConfigProvider, type ThemeConfig } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useInsertionEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { lsDesignTokenCss, lsFonts, lsMotion, lsTypography } from '../../lib/designTokens';
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion';
import { registerMotionPolicy, settleMotionRoot } from '../../lib/motionPolicy';

export const lingshuTheme: ThemeConfig = {
  cssVar: { key: 'lingshu' },
  token: {
    colorPrimary: '#2563eb', colorLink: '#2563eb', colorInfo: '#2563eb',
    colorSuccess: '#168568', colorWarning: '#a16207', colorError: '#dc3545',
    colorText: '#171717', colorTextSecondary: '#52525b', colorTextTertiary: '#71717a',
    colorBgLayout: '#ffffff', colorBgContainer: '#FFFFFF', colorBgElevated: '#FFFFFF',
    colorFillSecondary: '#f5f5f5', colorBgMask: 'rgba(24, 24, 27, .32)',
    colorBorder: '#d4d4d8', colorBorderSecondary: '#e4e4e7',
    fontFamily: lsFonts.sans,
    fontSize: lsTypography['body-medium'].size,
    fontSizeSM: lsTypography['body-small'].size,
    fontSizeLG: lsTypography['body-large'].size,
    lineHeight: lsTypography['body-medium'].line / lsTypography['body-medium'].size,
    lineHeightSM: lsTypography['body-small'].line / lsTypography['body-small'].size,
    lineHeightLG: lsTypography['body-large'].line / lsTypography['body-large'].size,
    fontSizeHeading1: lsTypography.headline.size, lineHeightHeading1: lsTypography.headline.line / lsTypography.headline.size,
    fontSizeHeading2: lsTypography['title-large'].size, lineHeightHeading2: lsTypography['title-large'].line / lsTypography['title-large'].size,
    fontSizeHeading3: lsTypography['title-medium'].size, lineHeightHeading3: lsTypography['title-medium'].line / lsTypography['title-medium'].size,
    fontSizeHeading4: lsTypography['title-small'].size, lineHeightHeading4: lsTypography['title-small'].line / lsTypography['title-small'].size,
    fontSizeHeading5: lsTypography['title-small'].size, lineHeightHeading5: lsTypography['title-small'].line / lsTypography['title-small'].size,
    fontWeightStrong: lsTypography['title-medium'].weight, borderRadius: 8,
    motionDurationFast: `${lsMotion.duration.fast}ms`,
    motionDurationMid: `${lsMotion.duration.enter}ms`,
    motionDurationSlow: `${lsMotion.duration.standard}ms`,
    motionEaseInOut: `cubic-bezier(${lsMotion.ease.standard.join(', ')})`,
    motionEaseInOutCirc: `cubic-bezier(${lsMotion.ease.standard.join(', ')})`,
    motionEaseOut: `cubic-bezier(${lsMotion.ease.enter.join(', ')})`,
    motionEaseOutCirc: `cubic-bezier(${lsMotion.ease.enter.join(', ')})`,
    motionEaseOutQuint: `cubic-bezier(${lsMotion.ease.enter.join(', ')})`,
    motionEaseOutBack: `cubic-bezier(${lsMotion.ease.enter.join(', ')})`,
    motionEaseInQuint: `cubic-bezier(${lsMotion.ease.exit.join(', ')})`,
    motionEaseInBack: `cubic-bezier(${lsMotion.ease.exit.join(', ')})`,
    controlHeight: 36, controlHeightSM: 32, controlHeightLG: 40,
    boxShadow: '0 16px 48px rgba(24, 24, 27, .14)',
    boxShadowSecondary: '0 10px 30px rgba(24, 24, 27, .10)',
    zIndexPopupBase: 1000,
  },
  components: {
    Button: { primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none', fontWeight: 600, paddingInline: 16, borderRadius: 6 },
    Menu: { itemBg: 'transparent', subMenuItemBg: 'transparent', itemSelectedBg: '#f4f4f5', itemSelectedColor: '#171717', itemHoverBg: '#fafafa', itemColor: '#52525b', itemHeight: 40, itemBorderRadius: 6 },
    Card: { bodyPadding: 20, headerPadding: 20, headerHeight: 52 },
    Table: { headerBg: '#fafafa', headerColor: '#171717', borderColor: '#e4e4e7', rowHoverBg: '#fafafa', rowSelectedBg: '#eff6ff', cellPaddingBlockMD: 12 },
    Tabs: { inkBarColor: '#2563eb', itemSelectedColor: '#2563eb', horizontalItemGutter: 24 },
    Input: { activeBorderColor: '#2563eb', hoverBorderColor: '#93c5fd', activeShadow: '0 0 0 3px rgba(37, 99, 235, .12)' },
    Select: { optionSelectedBg: '#eff6ff', optionSelectedColor: '#171717', optionActiveBg: '#f5f5f5' },
    Segmented: { trackBg: '#f5f5f5', itemSelectedBg: '#FFFFFF', itemSelectedColor: '#171717' },
    Modal: { borderRadiusLG: 10 },
    Tooltip: { colorBgSpotlight: '#171717' },
    Layout: { bodyBg: '#ffffff', headerBg: '#FFFFFF', headerColor: '#171717', siderBg: '#FFFFFF', lightSiderBg: '#FFFFFF', triggerBg: '#FFFFFF', triggerColor: '#52525b' },
    Avatar: { groupBorderColor: '#FFFFFF', groupOverlapping: -8, groupSpace: 4 },
    Progress: { defaultColor: '#2563eb', remainingColor: '#e4e4e7', circleTextColor: '#171717', lineBorderRadius: 999 },
    Skeleton: { gradientFromColor: '#f4f4f5', gradientToColor: '#fafafa', blockRadius: 8 },
    Collapse: { headerBg: '#FFFFFF', contentBg: '#FFFFFF', borderlessContentBg: '#FFFFFF', headerPadding: '14px 16px', contentPadding: '0 16px 16px' },
    Pagination: { itemBg: '#FFFFFF', itemActiveBg: '#eff6ff', itemActiveColor: '#2563eb', itemActiveColorHover: '#1d4ed8', itemLinkBg: '#FFFFFF' },
    Steps: { iconSize: 28, iconSizeSM: 22, dotSize: 8, dotCurrentSize: 10, navArrowColor: '#a1a1aa' },
    Spin: { dotSize: 22, dotSizeSM: 14, dotSizeLG: 32 },
    Image: { previewOperationColor: '#FFFFFF', previewOperationHoverColor: '#93C5FD', progressAnimationDuration: '1.2s' },
    Alert: { borderRadius: 8, defaultPadding: '10px 14px', withDescriptionPadding: '14px 16px' },
    Drawer: { footerPaddingBlock: 12, footerPaddingInline: 20 },
  },
};

export default function LingshuProvider({ children }: { children: ReactNode }) {
  const reducedMotion = usePrefersReducedMotion();
  const appRoot = useRef<HTMLElement>(null);
  useInsertionEffect(() => registerMotionPolicy(reducedMotion), [reducedMotion]);
  useLayoutEffect(() => {
    if (reducedMotion) settleMotionRoot(appRoot.current);
  }, [reducedMotion]);
  const theme = useMemo(() => ({ ...lingshuTheme, token: { ...lingshuTheme.token, motion: !reducedMotion } }), [reducedMotion]);
  const transition = useMemo(() => ({ type: 'tween' as const, duration: reducedMotion ? 0 : lsMotion.duration.enter / 1000, ease: lsMotion.ease.enter, skipAnimations: reducedMotion }), [reducedMotion]);
  return (
    <ConfigProvider locale={zhCN} theme={theme}>
      <style data-ls-design-tokens>{lsDesignTokenCss}</style>
      {/* Motion captures these two flags on mount. The scoped global policy above
          handles live OS changes, including opacity, without remounting editors
          or leaving elements permanently static after reduced motion is disabled. */}
      <MotionConfig reducedMotion="never" transition={transition} skipAnimations={false}>
        <App ref={appRoot} className="ls-design-system">{children}</App>
      </MotionConfig>
    </ConfigProvider>
  );
}

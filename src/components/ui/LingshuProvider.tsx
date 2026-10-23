import { App, ConfigProvider, theme as antTheme, type ThemeConfig } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useInsertionEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { lsDesignTokenCss, lsFonts, lsMotion, lsTypography, lsColors, lsDimensions } from '../../lib/designTokens';
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion';
import { registerMotionPolicy, settleMotionRoot } from '../../lib/motionPolicy';
import { useAppearance } from '../../lib/appearance';

export const lingshuTheme: ThemeConfig = {
  cssVar: { key: 'lingshu' },
  token: {
    colorPrimary: lsColors['primary'], colorLink: lsColors['primary'], colorInfo: lsColors['primary'],
    colorSuccess: lsColors['success'], colorWarning: lsColors['warning'], colorError: lsColors['error'],
    colorText: lsColors['text'], colorTextSecondary: lsColors['text-secondary'], colorTextTertiary: lsColors['text-tertiary'],
    colorBgLayout: lsColors['bg'], colorBgContainer: lsColors['bg'], colorBgElevated: lsColors['bg'],
    colorFillSecondary: lsColors['fill'], colorBgMask: lsColors['mask'],
    colorBorder: lsColors['border'], colorBorderSecondary: lsColors['border-secondary'],
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
    fontWeightStrong: lsTypography['title-medium'].weight, borderRadius: lsDimensions.radius.panel,
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
    controlHeight: lsDimensions.control.default, controlHeightSM: lsDimensions.control.small, controlHeightLG: lsDimensions.control.large,
    boxShadow: lsDimensions.shadow.overlay,
    boxShadowSecondary: lsDimensions.shadow.secondary,
    zIndexPopupBase: 1000,
  },
  components: {
    Button: { primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none', fontWeight: 600, paddingInline: 16, borderRadius: lsDimensions.radius.control },
    Menu: { itemBg: 'transparent', subMenuItemBg: 'transparent', itemSelectedBg: lsColors['selected'], itemSelectedColor: lsColors['text'], itemHoverBg: lsColors['hover'], itemColor: lsColors['text-secondary'], itemHeight: 40, itemBorderRadius: 6 },
    Card: { bodyPadding: 20, headerPadding: 20, headerHeight: 52 },
    Table: { headerBg: lsColors['hover'], headerColor: lsColors['text'], borderColor: lsColors['border-secondary'], rowHoverBg: lsColors['hover'], rowSelectedBg: lsColors['info-bg'], cellPaddingBlockMD: 12 },
    Tabs: { inkBarColor: lsColors['primary'], itemSelectedColor: lsColors['primary'], horizontalItemGutter: 24 },
    Input: { activeBorderColor: lsColors['primary'], hoverBorderColor: lsColors['primary-hover'], activeShadow: '0 0 0 3px rgba(37, 99, 235, .12)' },
    Select: { optionSelectedBg: lsColors['info-bg'], optionSelectedColor: lsColors['text'], optionActiveBg: lsColors['fill'] },
    Segmented: { trackBg: lsColors['fill'], itemSelectedBg: lsColors['bg'], itemSelectedColor: lsColors['text'] },
    Modal: { borderRadiusLG: lsDimensions.radius.overlay },
    Tooltip: { colorBgSpotlight: lsColors['text'] },
    Layout: { bodyBg: lsColors['bg'], headerBg: lsColors['bg'], headerColor: lsColors['text'], siderBg: lsColors['bg'], lightSiderBg: lsColors['bg'], triggerBg: lsColors['bg'], triggerColor: lsColors['text-secondary'] },
    Avatar: { groupBorderColor: lsColors['bg'], groupOverlapping: -8, groupSpace: 4 },
    Progress: { defaultColor: lsColors['primary'], remainingColor: lsColors['border-secondary'], circleTextColor: lsColors['text'], lineBorderRadius: 999 },
    Skeleton: { gradientFromColor: lsColors['selected'], gradientToColor: lsColors['hover'], blockRadius: 8 },
    Collapse: { headerBg: lsColors['bg'], contentBg: lsColors['bg'], borderlessContentBg: lsColors['bg'], headerPadding: '14px 16px', contentPadding: '0 16px 16px' },
    Pagination: { itemBg: lsColors['bg'], itemActiveBg: lsColors['info-bg'], itemActiveColor: lsColors['primary'], itemActiveColorHover: '#1d4ed8', itemLinkBg: lsColors['bg'] },
    Steps: { iconSize: 28, iconSizeSM: 22, dotSize: 8, dotCurrentSize: 10, navArrowColor: lsColors['disabled'] },
    Spin: { dotSize: 22, dotSizeSM: 14, dotSizeLG: 32 },
    Image: { previewOperationColor: lsColors['bg'], previewOperationHoverColor: lsColors['primary-hover'], progressAnimationDuration: '1.2s' },
    Alert: { borderRadius: lsDimensions.radius.panel, defaultPadding: '10px 14px', withDescriptionPadding: '14px 16px' },
    Drawer: { footerPaddingBlock: 12, footerPaddingInline: 20 },
  },
};

export default function LingshuProvider({ children }: { children: ReactNode }) {
  const reducedMotion = usePrefersReducedMotion();
  const { appearance } = useAppearance();
  const appRoot = useRef<HTMLElement>(null);
  useInsertionEffect(() => registerMotionPolicy(reducedMotion), [reducedMotion]);
  useLayoutEffect(() => {
    if (reducedMotion) settleMotionRoot(appRoot.current);
  }, [reducedMotion]);
  useLayoutEffect(() => {
    document.documentElement.dataset.lingshuAppearance = appearance;
    return () => { delete document.documentElement.dataset.lingshuAppearance; };
  }, [appearance]);
  const theme = useMemo<ThemeConfig>(() => ({
    ...lingshuTheme,
    algorithm: appearance === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: {
      ...lingshuTheme.token,
      ...(appearance === 'dark' ? {
        colorText: '#f6f6f7', colorTextSecondary: '#c6c6ca', colorTextTertiary: '#999ba2',
        colorBgLayout: '#111214', colorBgContainer: '#202123', colorBgElevated: '#292a2d',
        colorBorder: '#37383c', colorBorderSecondary: '#303135', colorFillSecondary: '#292a2d',
      } : {}),
      motion: !reducedMotion,
    },
    components: appearance === 'dark' ? {
      ...lingshuTheme.components,
      Menu: { itemBg: 'transparent', subMenuItemBg: 'transparent', itemSelectedBg: '#2b2b2d', itemSelectedColor: '#fff', itemHoverBg: '#242426', itemColor: '#c6c6ca', itemHeight: 48, itemBorderRadius: 10 },
      Segmented: { trackBg: '#242426', itemSelectedBg: '#f8fafc', itemSelectedColor: '#171717' },
      Table: { headerBg: '#292a2d', headerColor: '#f6f6f7', borderColor: '#37383c', rowHoverBg: '#292a2d', rowSelectedBg: '#242b3f', cellPaddingBlockMD: 12 },
      Tabs: { inkBarColor: '#d9e9ff', itemSelectedColor: '#f6f6f7', horizontalItemGutter: 24 },
      Layout: { bodyBg: '#111214', headerBg: '#111214', headerColor: '#f6f6f7', siderBg: '#171719', lightSiderBg: '#171719', triggerBg: '#171719', triggerColor: '#c6c6ca' },
      Select: { ...lingshuTheme.components?.Select, optionSelectedBg: '#242b3f', optionSelectedColor: '#f6f6f7', optionActiveBg: '#292a2d' },
      Collapse: { ...lingshuTheme.components?.Collapse, headerBg: '#202123', contentBg: '#202123', borderlessContentBg: '#202123' },
      Pagination: { ...lingshuTheme.components?.Pagination, itemBg: '#202123', itemLinkBg: '#202123', itemActiveBg: '#242b3f', itemActiveColor: '#91baff', itemActiveColorHover: '#b7d2ff' },
      Progress: { ...lingshuTheme.components?.Progress, remainingColor: '#37383c', circleTextColor: '#f6f6f7' },
      Skeleton: { ...lingshuTheme.components?.Skeleton, gradientFromColor: '#292a2d', gradientToColor: '#37383c' },
      Avatar: { ...lingshuTheme.components?.Avatar, groupBorderColor: '#202123' },
      Tooltip: { colorBgSpotlight: '#37383c' },
    } : lingshuTheme.components,
  }), [appearance, reducedMotion]);
  const transition = useMemo(() => ({ type: 'tween' as const, duration: reducedMotion ? 0 : lsMotion.duration.enter / 1000, ease: lsMotion.ease.enter, skipAnimations: reducedMotion }), [reducedMotion]);
  return (
    <ConfigProvider locale={zhCN} theme={theme}>
      <style data-ls-design-tokens>{lsDesignTokenCss}</style>
      {/* Motion captures these two flags on mount. The scoped global policy above
          handles live OS changes, including opacity, without remounting editors
          or leaving elements permanently static after reduced motion is disabled. */}
      <MotionConfig reducedMotion="never" transition={transition} skipAnimations={false}>
        <App ref={appRoot} className="ls-design-system" data-appearance={appearance}>{children}</App>
      </MotionConfig>
    </ConfigProvider>
  );
}

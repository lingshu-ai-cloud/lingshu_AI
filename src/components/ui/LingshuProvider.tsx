import { App, ConfigProvider, type ThemeConfig } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

export const lingshuTheme: ThemeConfig = {
  cssVar: { key: 'lingshu' },
  token: {
    colorPrimary: '#117F51', colorLink: '#117F51', colorInfo: '#356CAE',
    colorSuccess: '#147A51', colorWarning: '#A45A3B', colorError: '#B74D43',
    colorText: '#173D31', colorTextSecondary: '#53695F', colorTextTertiary: '#617169',
    colorBgLayout: '#F6F8F5', colorBgContainer: '#FFFFFF', colorBgElevated: '#FFFFFF',
    colorFillSecondary: '#F1F6F2', colorBgMask: 'rgba(23,61,49,.32)',
    colorBorder: '#C8D9CE', colorBorderSecondary: '#DFE8E1',
    fontFamily: '"SF Pro Text","PingFang SC","Noto Sans SC",ui-sans-serif,system-ui,sans-serif',
    fontSize: 14, fontWeightStrong: 600, borderRadius: 8,
    controlHeight: 36, controlHeightSM: 32, controlHeightLG: 40,
    boxShadow: '0 16px 48px rgba(23,61,49,.14)',
    boxShadowSecondary: '0 10px 30px rgba(23,61,49,.10)',
    zIndexPopupBase: 1000,
  },
  components: {
    Button: { primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none', fontWeight: 600, paddingInline: 16, borderRadius: 6 },
    Menu: { itemBg: 'transparent', subMenuItemBg: 'transparent', itemSelectedBg: '#EAF6F2', itemSelectedColor: '#117F51', itemHoverBg: '#F1F6F2', itemHeight: 40, itemBorderRadius: 6 },
    Card: { bodyPadding: 20, headerPadding: 20, headerHeight: 52 },
    Table: { headerBg: '#F1F6F2', headerColor: '#173D31', borderColor: '#DFE8E1', rowHoverBg: '#F8FAF7', rowSelectedBg: '#EAF6F2', cellPaddingBlockMD: 12 },
    Tabs: { inkBarColor: '#117F51', itemSelectedColor: '#117F51', horizontalItemGutter: 24 },
    Input: { activeBorderColor: '#117F51', hoverBorderColor: '#75AD91', activeShadow: '0 0 0 3px rgba(17,127,81,.12)' },
    Select: { optionSelectedBg: '#EAF6F2', optionSelectedColor: '#173D31', optionActiveBg: '#F1F6F2' },
    Segmented: { trackBg: '#F1F6F2', itemSelectedBg: '#FFFFFF', itemSelectedColor: '#173D31' },
    Modal: { borderRadiusLG: 10 },
    Tooltip: { colorBgSpotlight: '#173D31' },
    Layout: { bodyBg: '#F6F8F5', headerBg: '#FFFFFF', headerColor: '#173D31', siderBg: '#FFFFFF', lightSiderBg: '#FFFFFF', triggerBg: '#FFFFFF', triggerColor: '#53695F' },
    Avatar: { groupBorderColor: '#FFFFFF', groupOverlapping: -8, groupSpace: 4 },
    Progress: { defaultColor: '#117F51', remainingColor: '#E8EFEA', circleTextColor: '#173D31', lineBorderRadius: 999 },
    Skeleton: { gradientFromColor: '#EEF3EF', gradientToColor: '#F8FAF8', blockRadius: 8 },
    Collapse: { headerBg: '#FFFFFF', contentBg: '#FFFFFF', borderlessContentBg: '#FFFFFF', headerPadding: '14px 16px', contentPadding: '0 16px 16px' },
    Pagination: { itemBg: '#FFFFFF', itemActiveBg: '#EAF6F2', itemActiveColor: '#117F51', itemActiveColorHover: '#0D6A43', itemLinkBg: '#FFFFFF' },
    Steps: { iconSize: 28, iconSizeSM: 22, dotSize: 8, dotCurrentSize: 10, navArrowColor: '#91A29A' },
    Spin: { dotSize: 22, dotSizeSM: 14, dotSizeLG: 32 },
    Image: { previewOperationColor: '#FFFFFF', previewOperationHoverColor: '#86C968', progressAnimationDuration: '1.2s' },
    Alert: { borderRadius: 8, defaultPadding: '10px 14px', withDescriptionPadding: '14px 16px' },
    Drawer: { footerPaddingBlock: 12, footerPaddingInline: 20 },
  },
};

export default function LingshuProvider({ children }: { children: ReactNode }) {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const theme = useMemo(() => ({ ...lingshuTheme, token: { ...lingshuTheme.token, motion: !reducedMotion } }), [reducedMotion]);
  return <ConfigProvider locale={zhCN} theme={theme}><App className="ls-design-system">{children}</App></ConfigProvider>;
}

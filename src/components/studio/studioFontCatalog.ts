import { type CoverStyle } from '../../lib/studioApi';


export const COVER_FONTS: { id: CoverStyle['font']; label: string; css: string }[] = [
  { id: 'sans',    label: '黑体', css: `'PingFang SC','Microsoft YaHei',ui-sans-serif,sans-serif` },
  { id: 'impact',  label: '粗黑', css: `'Arial Black',Impact,'Heiti SC','Microsoft YaHei',sans-serif` },
  { id: 'serif',   label: '衬线', css: `Georgia,'Songti SC','SimSun',serif` },
  { id: 'rounded', label: '圆润', css: `'Arial Rounded MT Bold','PingFang SC','Microsoft YaHei',sans-serif` },
  { id: 'mono',    label: '等宽', css: `ui-monospace,Menlo,Consolas,monospace` },
];

export const fontCss = (id: CoverStyle['font']) => COVER_FONTS.find(f => f.id === id)?.css ?? COVER_FONTS[0].css;

export const SUBTITLE_FONTS: { id: CoverStyle['font']; label: string; css: string }[] = [
  { id: 'sans', label: '思源黑体', css: 'Source Han Sans SC' },
  { id: 'impact', label: '站酷庆科黄油体', css: 'ZCOOL QingKe HuangYou' },
  { id: 'rounded', label: '得意黑', css: 'Smiley Sans Oblique' },
];

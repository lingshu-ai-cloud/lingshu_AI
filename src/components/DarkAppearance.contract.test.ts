import assert from 'node:assert/strict';
import fs from 'node:fs';

const creatorStyles = fs.readFileSync(new URL('../styles/creator-workspace.css', import.meta.url), 'utf8');
const baseStyles = fs.readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const assistantLauncher = fs.readFileSync(new URL('./assistant/AssistantLauncher.tsx', import.meta.url), 'utf8');
const formField = fs.readFileSync(new URL('./smartBusiness/DigitalEmployeeFormField.tsx', import.meta.url), 'utf8');
const business = fs.readFileSync(new URL('./SmartBusinessDashboard.tsx', import.meta.url), 'utf8');
const calendarStyles = fs.readFileSync(new URL('./ui/calendar.css', import.meta.url), 'utf8');
const managedStyles = fs.readFileSync(new URL('./adManagedWorkspace.css', import.meta.url), 'utf8');
const experiencePrimitives = fs.readFileSync(new URL('./ui/LsExperiencePrimitives.tsx', import.meta.url), 'utf8');
const workspacePageShell = fs.readFileSync(new URL('./WorkspacePageShell.tsx', import.meta.url), 'utf8');

assert.match(
  creatorStyles,
  /html\[data-lingshu-appearance='dark'\] body :where\(div, main, section, article, aside, nav, header, footer, form, fieldset, details, summary, li, th, td\)\.bg-white/,
  '夜间主题必须覆盖侧栏、导航、标题栏及门户层，不得留下大片白底',
);
assert.match(creatorStyles, /\[class~='bg-white\/80'\]/, '半透明白色信息条必须映射到深色 Surface');
assert.match(creatorStyles, /\.bg-neutral-50, \.bg-neutral-100, \.bg-zinc-50/, '旧版中性浅色工具类必须在夜间映射到深色 Surface');
assert.match(creatorStyles, /\[class~='bg-\[#f6f8f5\]'\]/, '旧版硬编码浅色工作台背景必须在夜间映射到深色 Surface');
assert.match(creatorStyles, /\.bg-amber-50[\s\S]*?color-mix\(in srgb, #f4c778/, '语义提示条在夜间保留警示色且使用深色表面');
assert.match(creatorStyles, /color-scheme: dark/, '夜间主题须同步原生滚动条配色');
assert.match(creatorStyles, /::-webkit-scrollbar-track \{ background: transparent; \}/, '夜间滚动条轨道不得形成右侧白线');
assert.match(creatorStyles, /\.ls-customer-list-row\.is-selected \{\s*background: color-mix/, '夜间客户列表选中态须使用深色主题表面');
assert.match(creatorStyles, /html\[data-lingshu-appearance='dark'\] \.ls-design-system \.bg-text-primary \{\s*background-color: var\(--color-surface-2\)/, '夜间反色提示与助手头像不得变成浅底白字');
assert.match(baseStyles, /\.workspace-canvas\s*\{[^}]*background:\s*var\(--color-ink\)/, '共享工作区画布必须跟随外观 Token，不能在夜间保留白底');
assert.match(baseStyles, /\.data-strip\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--color-surface\)/, '信息条必须跟随 Surface Token');
assert.match(baseStyles, /\.home-insight-panel\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--color-insight\)/, '经营洞察面板不得在夜间保留浅色底');
assert.match(creatorStyles, /html\[data-lingshu-appearance='dark'\] :where\(\.auth-shell, \.auth-panel, \.auth-form-card, \.auth-field\)/, '登录页应在夜间使用深色表单背景');
assert.doesNotMatch(assistantLauncher, /!bg-white/, '灵小枢展开和收起入口不能强制白底');
assert.match(assistantLauncher, /data-global-assistant="edge-launcher"[\s\S]*?!bg-surface/, '收起后的灵小枢入口必须使用主题表面');
assert.match(formField, /border-border bg-surface-2[^"\n]*text-text-primary/, '新手引导输入框必须使用日夜共享表面与文字 Token');
assert.match(creatorStyles, /--color-insight-soft: color-mix/, '插件页信息条夜间必须使用深色语义表面');
assert.match(creatorStyles, /--ls-text-primary: var\(--ls-text\)/, '旧版投流页面标题须继承夜间文字 Token');
assert.match(creatorStyles, /\.bg-accent\.text-white \{ color: var\(--color-ink\)/, '亮蓝实心按钮在夜间不得使用低对比度白字');
assert.match(creatorStyles, /\.ant-segmented:not\(\.creator-mode-switch\) \.ant-segmented-item-selected/, '常规分段控件选中项须使用深色背景');
assert.match(calendarStyles, /--fc-classic-background: var\(--color-surface/, '排产日历的大面积网格背景必须使用主题表面');
assert.match(calendarStyles, /html\[data-lingshu-appearance='dark'\] \.ls-calendar :where\(/, '日历表头、卡片和事件必须有夜间适配');
assert.match(managedStyles, /html\[data-lingshu-appearance='dark'\] \.managed-workspace/, '投流托管信息条、统计和表单必须有夜间适配');
assert.match(experiencePrimitives, /railColor=\{props\.railColor \|\| 'var\(--color-surface-2\)'\}/, '进度条轨道不得在夜间强制浅色');
assert.doesNotMatch(workspacePageShell, /bg-\[#f8faf7\]|bg-white/, '脚本库等共享管理页面不得用固定浅色背景');

const interpretationStart = business.indexOf('return <section aria-label="经营解读"');
assert.ok(interpretationStart >= 0, '经营总览须保留经营解读区');
const interpretationHeader = business.slice(interpretationStart, interpretationStart + 260);
assert.match(interpretationHeader, /border-t border-border/, '经营解读应作为内容分隔区而非大块浅色卡片');
assert.doesNotMatch(interpretationHeader, /bg-neutral-50|bg-white/, '经营解读在夜间模式不得出现浅色底框');

console.log('Dark appearance surface contracts passed');

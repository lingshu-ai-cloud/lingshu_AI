import assert from 'node:assert/strict';
import fs from 'node:fs';

const creatorStyles = fs.readFileSync(new URL('../styles/creator-workspace.css', import.meta.url), 'utf8');
const business = fs.readFileSync(new URL('./SmartBusinessDashboard.tsx', import.meta.url), 'utf8');

assert.match(
  creatorStyles,
  /:where\(div, section, article, aside, nav, header, footer\)\.bg-white/,
  '夜间主题必须覆盖侧栏、导航和标题栏，不得留下大片白底',
);
assert.match(creatorStyles, /color-scheme: dark/, '夜间主题须同步原生滚动条配色');
assert.match(creatorStyles, /::-webkit-scrollbar-track \{ background: transparent; \}/, '夜间滚动条轨道不得形成右侧白线');
assert.match(creatorStyles, /\.ls-customer-list-row\.is-selected \{\s*background: color-mix/, '夜间客户列表选中态须使用深色主题表面');

const interpretationStart = business.indexOf('return <section aria-label="经营解读"');
assert.ok(interpretationStart >= 0, '经营总览须保留经营解读区');
const interpretationHeader = business.slice(interpretationStart, interpretationStart + 260);
assert.match(interpretationHeader, /border-t border-border/, '经营解读应作为内容分隔区而非大块浅色卡片');
assert.doesNotMatch(interpretationHeader, /bg-neutral-50|bg-white/, '经营解读在夜间模式不得出现浅色底框');

console.log('Dark appearance surface contracts passed');

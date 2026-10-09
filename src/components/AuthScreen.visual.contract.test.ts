import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const componentSource = readFileSync(new URL('./AuthScreen.tsx', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

assert.match(componentSource, /className="auth-visual[^]*?aria-label="灵枢品牌介绍"/);
assert.match(styleSource, /\.auth-visual\s*\{[^}]*background-image:\s*url\('\/lingshu-water\.jpg'\)/, '登录页左侧品牌区必须显示水纹图片');
assert.match(styleSource, /\.auth-panel\s*\{[^}]*background:\s*#fff/, '登录表单区域必须保持纯白');

console.log('AuthScreen visual contract passed');

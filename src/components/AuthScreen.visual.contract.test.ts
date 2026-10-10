import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const componentSource = readFileSync(new URL('./AuthScreen.tsx', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

assert.match(componentSource, /className="auth-visual[^]*?aria-label="灵枢品牌介绍"/);
assert.match(styleSource, /\.auth-visual\s*\{[^}]*background-image:\s*url\('\/lingshu-water\.jpg'\)/, '登录页左侧品牌区必须显示水纹图片');
assert.match(styleSource, /\.auth-panel\s*\{[^}]*background:\s*#fff/, '登录表单区域必须保持纯白');
assert.equal((componentSource.match(/type="checkbox"/g) || []).length, 2, '登录与注册必须分别展示协议同意框');
assert.match(componentSource, /name="legal-consent"[\s\S]*?checked=\{registrationConsent\}[\s\S]*?required/, '注册协议必须默认受控且必选');
assert.match(componentSource, /name="login-legal-consent"[\s\S]*?checked=\{loginConsent\}[\s\S]*?required/, '登录协议必须默认受控且必选');
assert.match(componentSource, /disabled=\{loading \|\| !registrationConsent\}/, '未同意协议时不能注册');
assert.match(componentSource, /disabled=\{loading \|\| !loginConsent\}/, '未同意协议时不能登录');
assert.match(componentSource, /灵小枢（杭州）科技有限公司/, '登录页必须展示运营主体法定名称');
for (const path of ['/privacy', '/terms', '/data-deletion']) {
  assert.match(appSource, new RegExp(`publicPath === '${path.replace('/', '\\/')}'`), `${path} 必须可匿名访问`);
  assert.match(componentSource, new RegExp(`href="${path}"[^>]*target="_blank"`), `${path} 必须从认证页长期可访问`);
}

console.log('AuthScreen visual contract passed');

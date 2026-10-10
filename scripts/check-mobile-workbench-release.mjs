import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_APP_ID = 'wxe47d8e0f74fe1403';
const EXPECTED_API_ORIGIN = 'https://app.lingshu.site';

const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');

const readClientSources = (root) => {
  const base = path.join(root, 'apps/shooting-miniapp');
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(?:js|wxml)$/.test(entry.name)) files.push(absolute);
    }
  };
  visit(base);
  return files.sort().map(file => fs.readFileSync(file, 'utf8')).join('\n');
};

export function checkMobileWorkbenchRelease(root, evidence = process.env) {
  const blockers = [];
  const checks = [];
  const block = (code, message) => blockers.push({ code, message });
  const pass = (code, detail) => checks.push({ code, detail });
  let app;
  let project;
  try { app = JSON.parse(read(root, 'apps/shooting-miniapp/app.json')); }
  catch (error) { block('invalid_app_json', String(error)); }
  try { project = JSON.parse(read(root, 'apps/shooting-miniapp/project.config.json')); }
  catch (error) { block('invalid_project_config', String(error)); }

  if (app) {
    if (app.pages?.[0] !== 'pages/workbench/index') block('wrong_entry_page', '移动工作台必须是第一个页面。');
    else pass('entry_page', app.pages[0]);
    for (const required of ['pages/workbench/index', 'pages/index/index']) {
      if (!app.pages?.includes(required)) block('missing_page', `app.json 缺少 ${required}`);
    }
    const recordDescription = app.permission?.['scope.record']?.desc;
    if (typeof recordDescription !== 'string' || !recordDescription.trim()) {
      block('missing_record_permission_description', 'app.json 必须声明 scope.record 的用户可读用途。');
    } else pass('record_permission_description', recordDescription.trim());
  }
  if (project?.appid !== EXPECTED_APP_ID) block('unexpected_app_id', 'project.config.json 的 AppID 与已确认的小程序不一致。');
  else pass('app_id', EXPECTED_APP_ID);

  let config = '';
  let clientSource = '';
  try {
    config = read(root, 'apps/shooting-miniapp/config.js');
    clientSource = readClientSources(root);
  } catch (error) { block('missing_client_source', String(error)); }
  const origin = config.match(/apiBase\s*:\s*['"]([^'"]+)['"]/)?.[1];
  if (origin !== EXPECTED_API_ORIGIN) block('unexpected_api_origin', `config.js 必须明确指向 ${EXPECTED_API_ORIGIN}`);
  else pass('api_origin', origin);
  if (origin && !origin.startsWith('https://')) block('non_https_api_origin', '小程序 API 必须使用 HTTPS。');

  const networkApis = [...new Set([...clientSource.matchAll(/wx\.(request|uploadFile|downloadFile|connectSocket)\s*\(/g)].map(match => match[1]))].sort();
  if (!networkApis.length) block('network_api_not_detected', '无法从客户端源码确认微信网络 API。');
  else pass('network_domain_types', networkApis.join(','));
  const privacyApis = [...new Set([...clientSource.matchAll(/wx\.(chooseMedia|getRecorderManager|authorize|openSetting|saveVideoToPhotosAlbum|saveImageToPhotosAlbum)\s*\(/g)].map(match => match[1]))].sort();
  for (const required of ['chooseMedia', 'getRecorderManager']) {
    if (!privacyApis.includes(required)) block('privacy_api_not_detected', `无法从客户端源码确认 ${required} 的隐私声明范围。`);
  }
  if (privacyApis.length) pass('privacy_api_inventory', privacyApis.join(','));
  const usesWebView = /<web-view\b/.test(clientSource);
  if (usesWebView) pass('web_view_inventory', 'web-view');
  else block('web_view_not_detected', '行动页需要 OAuth web-view，但源码中未检测到 web-view。');
  const savesToAlbum = privacyApis.some(api => api === 'saveVideoToPhotosAlbum' || api === 'saveImageToPhotosAlbum');
  if (savesToAlbum) pass('photo_album_write_inventory', privacyApis.filter(api => api.startsWith('save')).join(','));
  const apiSource = read(root, 'apps/shooting-miniapp/lib/api.js');
  if (/tenantId|tenant_id|userId|user_id/.test(apiSource)) block('client_scope_parameter', '客户端 API 层不应提交租户或用户作用域。');
  else pass('server_derived_scope', '客户端 API 层未发现租户/用户作用域参数');

  for (const [code, key, message] of [
    ['request_domain_unverified', 'WECHAT_REQUEST_DOMAIN_VERIFIED', `微信公众平台尚无证据证明已配置 request 合法域名 ${EXPECTED_API_ORIGIN}`],
    ['asset_request_domains_unverified', 'WECHAT_ASSET_REQUEST_DOMAINS_VERIFIED', '外部发布素材由动态 HTTPS 地址通过 wx.request 下载；尚无证据证明所有实际素材主机均已配置为 request 合法域名，或统一改由已配置域名代理。'],
    ['business_domain_unverified', 'WECHAT_BUSINESS_DOMAIN_VERIFIED', '社媒 OAuth 使用 web-view；尚无证据证明所有实际授权/回调页面主机均已配置为小程序业务域名。'],
    ['privacy_declaration_unverified', 'WECHAT_PRIVACY_DECLARATION_VERIFIED', '微信公众平台隐私保护指引尚无证据证明已覆盖麦克风、相册/视频选择，以及保存图片/视频到相册的用途。'],
    ['real_device_acceptance_unverified', 'WECHAT_REAL_DEVICE_ACCEPTANCE_VERIFIED', '尚无真机验收证据（登录、三 Tab、录音授权、视频选择/上传、素材保存、OAuth、弱网与版本冲突）。'],
  ]) {
    if (evidence[key] === '1') pass(code.replace('_unverified', '_verified'), key);
    else block(code, message);
  }
  return {
    status: blockers.length ? 'blocked' : 'passed',
    scope: 'read_only_mobile_workbench_release_preflight',
    expectedAppId: EXPECTED_APP_ID,
    expectedApiOrigin: EXPECTED_API_ORIGIN,
    checks,
    blockers,
    limitations: [
      '本检查不登录微信公众平台，不读取生产账号，也不发布小程序。',
      '五个 WECHAT_*_VERIFIED 环境变量只能由人工查验后台配置、实际运行域名清单或完成真机验收后在当次发布流程中提供。',
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = checkMobileWorkbenchRelease(process.cwd());
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'passed') process.exitCode = 2;
}

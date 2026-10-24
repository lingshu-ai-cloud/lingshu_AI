import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import PresenterManager from './PresenterManager.js';

const props = { onClose: () => {}, onSaved: () => {} };
const source = fs.readFileSync('src/components/enterprise/PresenterManager.tsx', 'utf8');

test('presenter onboarding exposes one material upload instead of technical creation modes', () => {
  const html = renderToStaticMarkup(<PresenterManager {...props} />);
  assert.match(html, /人物素材/);
  assert.match(html, /上传清晰正面照片或本人视频/);
  assert.match(html, /系统自动处理/);
  assert.match(html, /提交人物并进入官方授权/);
  assert.match(html, /选择已有声音/);
  assert.match(html, /录入本人声音/);
  assert.match(source, /直接录音（推荐）/);
  assert.match(source, /开始录音/);
  assert.match(source, /完成录音并提交/);
  assert.match(source, /也可直接提交较短的有效录音/);
  assert.match(source, /已完成并选中/);
  assert.match(source, /请继续上传上方人物素材/);
  assert.match(source, /声音可以与人物授权并行处理/);
  assert.doesNotMatch(source, /disabled=\{!name\.trim\(\) \|\| !file \|\| !voiceId/);
  assert.match(source, /还需完成：/);
  assert.match(source, /前往 HeyGen 完成本人授权/);
  assert.doesNotMatch(source, /模拟官方授权|mockConsentCompletionAvailable|mockComplete/);
  assert.match(source, /邀请您创建属于自己的口播角色/);
  assert.match(source, /或上传本人录音/);
  assert.doesNotMatch(source, /recordingSeconds < 15/);
  assert.doesNotMatch(html, /照片形象|视频分身|专家模式|生成 10 个场景/);
});

test('initial onboarding communicates the official-consent gate and default-person outcome', () => {
  const html = renderToStaticMarkup(<PresenterManager {...props} initialConfiguration />);
  assert.match(html, /录入人物资产/);
  assert.match(html, /官方本人授权/);
  assert.match(html, /保存为默认/);
  assert.match(html, /选择已授权人物/);
});

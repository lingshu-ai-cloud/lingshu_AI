import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mixedStoryboardIssues, mixedStoryboardRules } from './mixedStoryboardContract.js';
const materials = [{ name: '电路板视频', duration: 12, observations: ['镜头固定，电路板元件清晰可见'] }];
const avatar = '[0-4s]\n画面：数字人：面对镜头讲述\n台词：我们看一下细节。';
const clip = '[4-12s]\n画面：素材《电路板视频》；源片截取：1-9s；展示元件\n台词：看看这些元件。';
assert.deepEqual(mixedStoryboardIssues(avatar + '\n' + clip, 'heygen', materials), []);
assert.match(mixedStoryboardIssues(clip, 'heygen', materials).join(), /同时包含/);
assert.match(mixedStoryboardIssues(avatar, 'heygen', materials).join(), /同时包含/);
assert.match(mixedStoryboardIssues(avatar + '\n' + clip.replace('1-9s', '10-19s'), 'heygen', materials).join(), /超出素材时长/);
assert.match(mixedStoryboardIssues(avatar + '\n' + clip.replace('1-9s', '9-1s'), 'heygen', materials).join(), /区间无效/);
assert.match(mixedStoryboardIssues(avatar + '\n' + clip.replace('1-9s', ''), 'heygen', materials).join(), /缺少可验证/);
assert.match(mixedStoryboardIssues(avatar + '\n' + clip.replace('展示元件', '建议补拍手指操作同一块板'), 'heygen', materials).join(), /补拍/);
assert.match(mixedStoryboardIssues(avatar + '\n' + clip.replace('展示元件', '手指入画'), 'heygen', materials).join(), /手部动作/);
assert.match(mixedStoryboardIssues(avatar + '\n' + clip.replace('展示元件', '同一块电路板'), 'heygen', materials).join(), /同一物件/);
assert.deepEqual(mixedStoryboardIssues(clip, 'material', materials), []);
assert.match(mixedStoryboardRules('heygen', materials), /不是成片时间轴/);
const source = fs.readFileSync(new URL('./studio.ts', import.meta.url), 'utf8');
assert.match(source, /const scriptSystemPrompt = `\$\{presentationRule\}\\n\$\{mixedRules\}/);
assert.match(source, /const mixedIssues = mixedStoryboardIssues\(script, presentationMode, normalizedMaterialInfos\)/);
assert.match(source, /const materialHardIssues = Array\.from\(new Set\(\[\s*\.\.\.mixedIssues/);
console.log('Mixed storyboard contract: passed');

const negativeAvatar = avatar.replace('面对镜头讲述', '面对镜头讲述；不指向、不模拟操作；无手持物');
const negativeClip = clip.replace('1-9s', '1.0s-9.0s').replace('展示元件', '展示元件，无手部入镜、无手部或工具介入');
assert.deepEqual(mixedStoryboardIssues(negativeAvatar + '\n' + negativeClip, 'heygen', materials), []);
assert.match(mixedStoryboardIssues(avatar + '\n' + clip.replace('展示元件', '无工具但手指入画'), 'heygen', materials).join(), /手部动作/);
assert.match(mixedStoryboardIssues(avatar + '\n' + clip.replace('展示元件', '手指入画'), 'heygen', [{ ...materials[0], observations: ['无手部入镜'] }]).join(), /手部动作/);

// Actual Qwen response: negative constraints and units on both endpoints are valid.
const realDraft = JSON.parse(fs.readFileSync(new URL('./mixedStoryboardRealResponse.fixture.json', import.meta.url), 'utf8')).script;
const realMaterials = [{ name: '电路板背面走线与焊点', duration: 32.28, observations: ['绿色电路板背面走线与焊点的移动特写'] }, { name: '电路板元件特写', duration: 16.36, observations: ['电路板正面元件与插槽移动特写'] }];
assert.deepEqual(mixedStoryboardIssues(realDraft, 'heygen', realMaterials), ['第1镜数字人不能虚构产品操作']);
const withoutInjectedIdentity = realDraft.replace(/；展示 电路板[^\n]*/, '');
assert.deepEqual(mixedStoryboardIssues(withoutInjectedIdentity, 'heygen', realMaterials), []);

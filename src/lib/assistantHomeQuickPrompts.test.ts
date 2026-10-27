import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSISTANT_HOME_PROMPT_GROUPS,
  ASSISTANT_HOME_PROMPTS,
  ASSISTANT_HOME_QUICK_LAUNCHERS,
  assistantHomePromptById,
  isAssistantHomeQuickTaskText,
} from './assistantHomeQuickPrompts';
import { mergeAssistantHomePrompt, normalizeAssistantHomePromptDetail } from '../components/assistant/useAssistantHomeAnchor';

test('home prompt catalog exposes every approved capability with stable unique ids', () => {
  assert.equal(ASSISTANT_HOME_PROMPTS.length, 68);
  assert.equal(new Set(ASSISTANT_HOME_PROMPTS.map(entry => entry.id)).size, ASSISTANT_HOME_PROMPTS.length);
  assert.deepEqual(ASSISTANT_HOME_PROMPT_GROUPS.map(group => group.id), [
    'operations', 'inspiration', 'content', 'publishing', 'ads', 'customer', 'enterprise',
  ]);
  for (const entry of ASSISTANT_HOME_PROMPTS) {
    assert.ok(entry.label.trim(), `${entry.id} must have a label`);
    assert.ok(entry.summary.trim().length >= 12, `${entry.id} must explain the card`);
    assert.ok(entry.prompt.trim().length >= (['CO-REPLICATE', 'CO-HOOK', 'CO-CAMPAIGN', 'OP-CALENDAR'].includes(entry.id) ? 25 : 60), `${entry.id} must use a complete fixed prompt`);
    assert.ok(ASSISTANT_HOME_PROMPT_GROUPS.some(group => group.id === entry.group), `${entry.id} must use a visible group`);
  }
});

test('the launcher row starts with concrete high-frequency actions', () => {
  assert.deepEqual(
    ASSISTANT_HOME_QUICK_LAUNCHERS.slice(0, 4).map(entry => entry.label),
    ['查看当前周计划', '查看外部资讯', '分析经营数据', '内容创作'],
  );
});

test('launchers expose bounded task cards with a financial source entry', () => {
  assert.equal(new Set(ASSISTANT_HOME_QUICK_LAUNCHERS.map(entry => entry.id)).size, ASSISTANT_HOME_QUICK_LAUNCHERS.length);
  for (const launcher of ASSISTANT_HOME_QUICK_LAUNCHERS) {
    assert.ok(launcher.promptIds.length >= 1 && launcher.promptIds.length <= 7, `${launcher.id} must expose one to seven cards`);
    assert.equal(new Set(launcher.promptIds).size, launcher.promptIds.length, `${launcher.id} must not repeat cards`);
    assert.ok(launcher.promptIds.every(id => assistantHomePromptById(id)), `${launcher.id} must only reference real prompts`);
  }
});

test('external news opens the overview and four distinct news types', () => {
  const launcher = ASSISTANT_HOME_QUICK_LAUNCHERS.find(entry => entry.id === 'external-news');
  assert.ok(launcher);
  assert.deepEqual(
    launcher.promptIds.map(id => assistantHomePromptById(id)?.label),
    ['今日资讯', '重点企业解读', '行业资讯', '社交媒体资讯', '政策与平台资讯', '查询参考汇率', '查询国家贸易数据'],
  );
});

test('the remaining launcher labels are concrete tasks rather than abstract domains', () => {
  assert.deepEqual(
    ASSISTANT_HOME_QUICK_LAUNCHERS.slice(4).map(entry => entry.label),
    ['跟进重点客户', '优化智能投流'],
  );
  assert.deepEqual(ASSISTANT_HOME_QUICK_LAUNCHERS.find(item => item.id === 'customer-followup')!.promptIds, ['CS-01']);
  assert.deepEqual(ASSISTANT_HOME_QUICK_LAUNCHERS.find(item => item.id === 'traffic-optimization')!.promptIds, ['AD-01', 'AD-02']);
});

test('creation retains existing four scenarios and appends the confirmed speech selling point flow', () => {
  const creation = ASSISTANT_HOME_QUICK_LAUNCHERS.find(entry => entry.id === 'viral-script')!;
  assert.deepEqual(creation.promptIds, ['CO-REPLICATE', 'CO-HOOK', 'CO-07', 'CO-13', 'CO-SPEECH-HIGHLIGHT']);
  assert.equal(assistantHomePromptById(creation.promptIds[3])?.label, '借鉴一个爆款图文');
});

test('home prompt events remain fill-only and support explicit append or replace', () => {
  assert.deepEqual(normalizeAssistantHomePromptDetail('  测试提示词  '), { prompt: '测试提示词', mode: 'replace' });
  assert.deepEqual(normalizeAssistantHomePromptDetail({ prompt: ' 新提示词 ', mode: 'append' }), { prompt: '新提示词', mode: 'append' });
  assert.equal(normalizeAssistantHomePromptDetail({ prompt: '  ' }), null);
  assert.equal(mergeAssistantHomePrompt('原有内容', '新提示词', 'append'), '原有内容\n\n新提示词');
  assert.equal(mergeAssistantHomePrompt('原有内容', '新提示词', 'replace'), '新提示词');
});

test('quick task presentation recognizes fixed cards and parameterized query dialogs only', () => {
  assert.equal(isAssistantHomeQuickTaskText(assistantHomePromptById('OP-04')!.prompt), true);
  assert.equal(isAssistantHomeQuickTaskText(`${assistantHomePromptById('OP-04')!.prompt}\n重点关注异常项。`), true);
  assert.equal(isAssistantHomeQuickTaskText('查询美元兑人民币的最新参考汇率，并标注数据日期。'), true);
  assert.equal(isAssistantHomeQuickTaskText('行业资讯：行业：美妆原料，目标市场：欧盟。查询最近30天相关变化。'), true);
  assert.equal(isAssistantHomeQuickTaskText('我想随便聊聊今天的工作。'), false);
});


test('PRD scenarios live in their intended launcher and keep legacy prompts accessible', () => {
  const create=ASSISTANT_HOME_QUICK_LAUNCHERS.find(item=>item.id==='viral-script')!;
  assert.deepEqual(create.promptIds.slice(0,3).map(id=>assistantHomePromptById(id)?.label), ['借鉴一个爆款视频','选定一个开场','改写成多平台版本']);
  assert.equal(ASSISTANT_HOME_QUICK_LAUNCHERS.find(item=>item.id==='weekly-plan')!.promptIds[0], 'OP-CALENDAR');
  assert.ok(assistantHomePromptById('CO-01'));
});

test('legacy standalone selling point launcher stays removed while speech flow and read-only progress are retained', () => {
  assert.ok(!ASSISTANT_HOME_QUICK_LAUNCHERS.some(item => item.id === ('selling-points' as string)));
  assert.equal(assistantHomePromptById('CO-03'), undefined);
  assert.ok(ASSISTANT_HOME_QUICK_LAUNCHERS.find(item => item.id === 'weekly-plan')!.promptIds.includes('CO-11'));
  assert.equal(assistantHomePromptById('CO-11')!.label, '查看内容创作任务进度');
});

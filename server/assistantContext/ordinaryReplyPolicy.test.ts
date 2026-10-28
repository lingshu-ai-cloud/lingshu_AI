import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantOrdinaryReplyPolicy, assistantRequestsDetailedReply, ASSISTANT_CAPABILITY_TRUTH_RULE } from './ordinaryReplyPolicy.js';
import { ASSISTANT_CONCLUSION_RULE, ASSISTANT_CONTEXT_RULES, GENERAL_METHOD_PROMPT } from './chatInput.js';

test('ordinary account and status questions receive the concise policy instead of a report template', () => {
 for (const question of ['帮我接入TikTok账号', '我用邮箱还是手机号登录？', '连接好了吗？', '为什么无法生成报告？', '生成报告需要多久？', '能生成报告吗？', '请问为什么无法生成报告？', '请问怎么生成报告？', '不要写报告，告诉我下一步怎么操作', '你支持哪些功能？']) {
  assert.equal(assistantRequestsDetailedReply(question), false, question);
  const policy = assistantOrdinaryReplyPolicy(question);
  assert.match(policy, /通常一至三句/); assert.match(policy, /不扩写成报告/); assert.match(policy, /一个下一步/);
 }
});

test('explicit report, conclusion and detailed analysis requests keep sufficient response space', () => {
 for (const question of ['帮我生成一份企业经营报告', '输出行业专题报告', '给出最终结论', '请总结结论', '详细分析这组经营数据', '展开解释一下原因', '详细解释为什么无法生成报告']) {
  assert.equal(assistantRequestsDetailedReply(question), true, question);
  assert.match(assistantOrdinaryReplyPolicy(question), /用户明确请求报告、结论或详细分析/);
 }
});

test('capability descriptions must be current and evidence-backed without asking for secrets or inventing review periods', () => {
 assert.match(ASSISTANT_CAPABILITY_TRUTH_RULE, /已注册工具/);
 assert.match(ASSISTANT_CAPABILITY_TRUTH_RULE, /不得编造产品\/后台名称、站点地址、菜单入口、按钮、审核流程或审核时长/);
 assert.match(ASSISTANT_CAPABILITY_TRUTH_RULE, /密码、验证码、Cookie、访问令牌或密钥发送到聊天/);
 assert.match(ASSISTANT_CAPABILITY_TRUTH_RULE, /第三方账号须由用户在平台官方授权页本人登录授权/);
 assert.match(ASSISTANT_CAPABILITY_TRUTH_RULE, /历史助手文字/);
 assert.match(ASSISTANT_CAPABILITY_TRUTH_RULE, /读取、写入、发布、自动执行是不同能力/);
});

test('shared general and enterprise prompts no longer require a conclusion section for every ordinary turn', () => {
 assert.match(ASSISTANT_CONCLUSION_RULE, /只有用户明确要求报告、综合结论或详细分析时/);
 assert.doesNotMatch(ASSISTANT_CONCLUSION_RULE, /最后用“总体结论：”单独一段/);
 assert.match(GENERAL_METHOD_PROMPT, /一般方法问题简短说明判断与必要下一步/);
 assert.ok(GENERAL_METHOD_PROMPT.includes(ASSISTANT_CAPABILITY_TRUTH_RULE));
 assert.ok(ASSISTANT_CONTEXT_RULES.includes(ASSISTANT_CAPABILITY_TRUTH_RULE));
});

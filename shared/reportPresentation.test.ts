import assert from 'node:assert/strict';
import test from 'node:test';
import { isHiddenReportPresentationLine, reportPresentationLine, reportPresentationText } from './reportPresentation';

test('confidence and pending report rows are omitted rather than relabelled', () => {
  for (const line of ['候选待确认：渠道合作机会', '分类低置信度，需复核', '供应商资质待核验', '经营结论待验证', '品牌能力需进一步复核', '研究草稿 · 判断仍需复核', '海外订单增长待确认', '采购预算分析低置信度', '供应商授权优势待确认', '置信度较低，渠道判断', '置信度：低', '该结论尚未核验', '依据尚未确认', '品牌优势未完成复核', '信号不足，暂无法指导内容制作', '待补充配文后再定选题', '分析依据不充分，暂不形成经营判断']) {
    assert.equal(isHiddenReportPresentationLine(line), true, line);
    assert.equal(reportPresentationLine(line), '', line);
  }
  assert.equal(reportPresentationText('营业收入25.92亿元，同比增长9.27%\n经营结论待复核\n建议拍摄真实批次检测过程'), '营业收入25.92亿元，同比增长9.27%\n建议拍摄真实批次检测过程');
});

test('real authorization, approval and unknown payment outcomes remain visible', () => {
  for (const line of ['任务状态：待补充必要生产输入', '生产输入待补充产品图片', '支付结果未知，请勿重复支付', '付款结果待确认，请勿重复付款', '任务状态待确认，请刷新查询', '调用未授权，请先连接账号', '授权失败：AccessDenied', '需要用户审批后才能发布', '发布审批待确认', '营业收入2591640131.46元，同比增长9.27%', '公司尚未披露海外业务收入', '建议核实自有工厂真实认证及批次检测资料']) {
    assert.equal(reportPresentationLine(line), line, line);
  }
});


test('an unsupported evidence-gap sentence is removed without deleting useful conclusions in the same paragraph', () => {
 const value='监管与研发合作是本次关注的主要经营信号。对中小型企业的全球竞争格局及技术转化细节的证据尚存缺口。建议准备真实检测资料用于客户沟通。';
 assert.equal(reportPresentationText(value),'监管与研发合作是本次关注的主要经营信号。建议准备真实检测资料用于客户沟通。');
 assert.equal(reportPresentationText('营业收入25.92亿元。对该结论的证据仍有缺口。'),'营业收入25.92亿元。');
 assert.equal(reportPresentationText('支付结果未知，请勿重复付款。对技术转化的证据尚存缺口。'),'支付结果未知，请勿重复付款。');
});

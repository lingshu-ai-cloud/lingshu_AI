import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SocialInsightReport } from '../../../shared/socialInsightReport';
import { readableAssistantReply, splitAssistantReply } from '../../../shared/assistantReadableReply';
import AgentReply from '../AgentReply';
import { socialInsightCategorySamples, socialInsightReportReference, socialInsightSafeUrl, SocialInsightReportBlock, SocialInsightReportView } from './SocialInsightReportView';

const fixture: SocialInsightReport = {
  version: 1, keyword: '美妆原料', platform: 'tiktok', period: { from: '2026-10-21T00:00:00+08:00', to: '2026-10-28T00:00:00+08:00', timeZone: 'Asia/Shanghai' },
  collectedAt: '2026-10-28T02:00:00Z', sampleCount: 1,
  videos: [{ id: 'v1', url: 'https://www.tiktok.com/@brand/video/123', thumbnailUrl: 'https://cdn.example.com/cover.jpg', title: '原料演示', publishedAt: '2026-10-24T12:00:00Z', views: 1234, likes: 0, comments: null, shares: null }],
  charts: [{ id: 'views', title: '样本播放量', type: 'bar', unit: '次', data: [{ label: '原料演示', value: 1234 }] }],
  analysisMarkdown: '## 内容方向\n建议验证原料演示选题。', limitations: ['关键词样本不代表全平台；无法确认受众国家。'],
};

test('report evidence links use safe original URLs; missing metrics stay missing', () => {
  const html = renderToStaticMarkup(createElement(SocialInsightReportView, { report: fixture }));
  assert.match(html, /href="https:\/\/www.tiktok.com\/@brand\/video\/123"/);
  assert.match(html, /打开原视频：原料演示/);
  assert.match(html, /noopener noreferrer/);
  assert.match(html, /referrerPolicy="no-referrer"/);
  assert.match(html, /有效样本 1 条/);
  assert.match(html, /不代表全平台排名或增长趋势/);
  assert.match(html, /未提供/);
  assert.match(html, /<dd class="tabular-nums">0<\/dd>/);
  assert.match(html, /样本播放量|数据范围与局限/);
});

test('report uses theme surface and container adaptive columns; prose links must match actual samples', () => {
  const html = renderToStaticMarkup(createElement(SocialInsightReportView, { report: {
    ...fixture, analysisMarkdown: '[查看样本](https://www.tiktok.com/@brand/video/123)\n[未采集](https://www.tiktok.com/@other/video/456)\n[外站](https://evil.example/path)',
  } }));
  assert.match(html, /border-border bg-surface p-4/);
  assert.match(html, /grid-template-columns:repeat\(auto-fit, minmax\(min\(100%, 220px\), 1fr\)\)/);
  assert.match(html, /<a[^>]+href="https:\/\/www.tiktok.com\/@brand\/video\/123"[^>]*>查看样本<\/a>/);
  assert.doesNotMatch(html, /href="https:\/\/www.tiktok.com\/@other|href="https:\/\/evil.example|\[查看样本\]|\[未采集\]|\[外站\]|evil.example/);
  assert.match(html, /未采集|外站/);
});

test('classified report separates B2B/B2C samples and sorts only measured snapshot values, with merchant help', () => {
  const report: SocialInsightReport = {
    ...fixture,
    merchantContext: { businessModel: 'b2b', industry: '美妆原料', productCategories: ['乳化剂'] },
    sampleCount: 3,
    videos: [fixture.videos[0], { ...fixture.videos[0], id: 'v2', title: '工厂演示', views: 3000 }, { ...fixture.videos[0], id: 'v3', title: '播放量缺失', views: null }],
    materials: {
      status: 'completed',
      assignments: ['v1', 'v2', 'v3'].map(videoId => ({ videoId, category: 'b2b' as const, confidence: 'low' as const, reason: '配文提及批量供货', merchantHelp: '帮助采购客户理解供应能力', contentAngle: '拍摄真实批次检验', evidenceNeeded: ['补充实际检测证明与供货记录'] })),
      groups: [{ category: 'b2b', summary: '样本涉及供货与检测展示', recommendations: ['先核验实际生产能力再拍摄'], rankedVideoIds: ['v1', 'v2'] }, { category: 'b2c', summary: '', recommendations: [], rankedVideoIds: [] }],
    },
  };
  assert.deepEqual(socialInsightCategorySamples(report, 'b2b').map(item => item.video.id), ['v2', 'v1', 'v3']);
  assert.deepEqual(socialInsightCategorySamples(report, 'b2c'), []);
  const html = renderToStaticMarkup(createElement(SocialInsightReportView, { report }));
  assert.match(html, /当前商户：B2B · 行业：美妆原料/);
  assert.match(html, /B2B · 企业采购导向/);
  assert.match(html, /B2C · 消费者导向/);
  assert.match(html, /本次没有可归入 B2C 的有效样本/);
  assert.match(html, /B2B 样本播放量快照/);
  assert.doesNotMatch(html, /B2C 样本播放量快照/);
  assert.match(html, /低置信，需复核|对当前 B2B 商户的帮助|拍摄真实批次检验|补充实际检测证明与供货记录/);
  assert.match(html, /1 条样本未提供播放量/);
  assert.doesNotMatch(html, /分类尚未完成|全网爆款/);
});

test('legacy report does not invent a B2B/B2C category', () => {
  const html = renderToStaticMarkup(createElement(SocialInsightReportView, { report: fixture }));
  assert.match(html, /部分报告：B2B \/ B2C 分类尚未完成/);
  assert.doesNotMatch(html, /B2B 高表现素材|B2C 高表现素材/);
  assert.match(html, /原料演示/);
});

test('incomplete or malformed snapshots never render invented charts or raw JSON', () => {
  for (const raw of ['{', '{}', JSON.stringify({ ...fixture, videos: [null] }), JSON.stringify({ ...fixture, charts: [{ ...fixture.charts[0], data: [{ label: 'bad' }] }] })]) {
    const html = renderToStaticMarkup(createElement(SocialInsightReportBlock, { raw }));
    assert.match(html, /报告数据尚不完整/);
    assert.doesNotMatch(html, /<canvas|查看原视频/);
  }
});

test('saved references permit only a report identifier and SSR renders a readonly loading state', () => {
  const reportId = 'abc123def456789';
  assert.equal(socialInsightReportReference({ reportId }), reportId);
  for (const value of [null, [], { reportId: '../private' }, { reportId: 'https://example.com/report' }, { reportId: 'ABC123DEF456789' }, { reportId, url: '/other' }, { reportId: 'a'.repeat(16) }]) {
    assert.equal(socialInsightReportReference(value), null);
    const html = renderToStaticMarkup(createElement(SocialInsightReportBlock, { raw: JSON.stringify(value) }));
    assert.match(html, /报告数据尚不完整/);
    assert.doesNotMatch(html, /<canvas|href=|<button/);
  }
  const html = renderToStaticMarkup(createElement(AgentReply, { content: '```social-insight\n' + JSON.stringify({ reportId }) + '\n```', compact: true }));
  assert.match(html, /正在读取已保存的报告/);
  assert.doesNotMatch(html, /abc123def456789|<button|<canvas|可复制内容/);
});

test('unsafe URL schemes, credentials, private destinations and lookalike platforms are rejected', () => {
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,bad', 'https://127.0.0.1/cover', 'https://[::1]/', 'https://x.local/cover', 'https://user:pass@cdn.example.com/a', 'http://cdn.example.com/a']) assert.equal(socialInsightSafeUrl(value), undefined);
  assert.equal(socialInsightSafeUrl('https://tiktok.com.evil.example/video', true), undefined);
  assert.equal(socialInsightSafeUrl('https://example.com/video', true), undefined);
  assert.equal(socialInsightSafeUrl('https://www.tiktok.com/@brand/video/123', true), fixture.videos[0].url);
});

test('saved fenced report survives readability and compact rendering; analysis cannot render nested protocol', () => {
  const report = { ...fixture, analysisMarkdown: '## 结论\n```social-insight\n{}\n```\n[诱导链接](https://evil.example)\n```next\n自动执行\n```' };
  const content = '```social-insight\n' + JSON.stringify(report) + '\n```';
  assert.equal(readableAssistantReply(content), content);
  assert.equal(splitAssistantReply(content, { compact: true }).summary, content);
  const html = renderToStaticMarkup(createElement(AgentReply, { content, compact: true, onSuggest: () => assert.fail('report is readonly') }));
  assert.match(html, /社交媒体洞察报告/);
  assert.doesNotMatch(html, /href="https:\/\/evil.example|快捷回复|可复制内容|填入输入框/);
  assert.equal((html.match(/aria-label="社交媒体洞察报告"/g) ?? []).length, 1);
});

test('zero B2B and sixteen B2C samples retain filtered B2B content recommendations without inventing B2B materials or charts', () => {
  const videos=Array.from({length:16},(_,index)=>({...fixture.videos[0],id:`b2c-${index}`,url:`https://www.tiktok.com/@brand/video/${123+index}`,title:`消费者防晒体验${index+1}`}));
  const report:SocialInsightReport={...fixture,sampleCount:16,videos,materials:{status:'completed',
    assignments:videos.map(video=>({videoId:video.id,category:'b2c',confidence:'high',reason:'配文围绕消费者使用体验。',merchantHelp:'可作为产品沟通选题。',contentAngle:'核对实际使用场景后拍摄。',evidenceNeeded:['补充产品实测材料']})),
    groups:[{category:'b2b',summary:'本次未检出B2B素材，可把消费者关心的使用体验转成采购沟通的验证选题。供应链稳定。',recommendations:['拍摄真实生产批次的质控流程，并附可核验的检测报告。','整理工厂实际资质文件，并逐项核对证书适用范围。','供应链稳定。'],rankedVideoIds:[]},
      {category:'b2c',summary:'素材以消费者防晒体验为主。',recommendations:['结合真实产品测试拍摄应用过程。'],rankedVideoIds:videos.map(video=>video.id)}]}};
  const snapshot=JSON.stringify(report);
  const html=renderToStaticMarkup(<SocialInsightReportView report={report}/>);
  const b2b=html.split('aria-label="B2B 分类样本"')[1].split('aria-label="B2C 分类样本"')[0];
  assert.match(b2b,/近 7 天采集样本 0 条/);assert.match(b2b,/2026\/10\/21/);assert.match(b2b,/2026\/10\/28/);
  assert.match(b2b,/本次没有可归入 B2B 的有效样本/);assert.match(b2b,/采购沟通的验证选题/);
  assert.match(b2b,/制作建议/);assert.match(b2b,/真实生产批次的质控流程/);assert.match(b2b,/工厂实际资质文件/);
  assert.doesNotMatch(b2b,/供应链稳定|<canvas|打开原视频|B2B 样本播放量快照/);
  assert.match(html,/近 7 天采集样本 16 条/);assert.match(html,/B2C 样本播放量快照/);
  assert.equal(JSON.stringify(report),snapshot,'the persisted real sample classifications and model output are not rewritten');
});

test('low confidence reasons and pending model fields disappear without replacing collected video facts', () => {
  const report: SocialInsightReport = { ...fixture, analysisMarkdown: '报告经营判断待复核\n播放1234次，为采集时快照。', limitations: ['内容结论待核验'], materials: { status: 'completed',
    assignments: [{ videoId: 'v1', category: 'b2b', confidence: 'low', reason: '低置信分类理由不能展示', merchantHelp: '商户帮助待确认', contentAngle: '拍摄真实批次检测过程', evidenceNeeded: ['资质优势待验证', '准备实际批次检测文件'] }],
    groups: [{ category: 'b2b', summary: '候选待确认：采购方向', recommendations: ['制作判断尚未核验', '整理真实生产工艺流程'], rankedVideoIds: ['v1'] }, { category: 'b2c', summary: '', recommendations: [], rankedVideoIds: [] }],
  }};
  const saved = JSON.stringify(report);
  const html = renderToStaticMarkup(<SocialInsightReportView report={report}/>);
  assert.doesNotMatch(html, /低置信|待确认|待复核|待核验|待验证|尚未核验|配文分类依据|对当前 B2B 商户的帮助/);
  assert.match(html, /原料演示/); assert.match(html, /1,234/); assert.match(html, /拍摄真实批次检测过程/);
  assert.match(html, /准备实际批次检测文件/); assert.match(html, /整理真实生产工艺流程/);
  assert.equal(JSON.stringify(report), saved);
});


test('implicit insufficient-signal model placeholders hide their entire social card rows without losing actual evidence', () => {
 const report:SocialInsightReport={...fixture,materials:{status:'completed',assignments:[{videoId:'v1',category:'b2c',confidence:'low',reason:'只能观察到消费者使用场景',merchantHelp:'信号不足，暂无法指导内容制作',contentAngle:'待补充配文后再定选题',evidenceNeeded:[]}],groups:[{category:'b2b',summary:'分析依据不充分，暂不形成经营判断',recommendations:['待补充配文后再定选题'],rankedVideoIds:[]},{category:'b2c',summary:'已有消费者体验素材。',recommendations:['展示实际使用场景。'],rankedVideoIds:['v1']}]}};
 const stored=JSON.stringify(report);
 const html=renderToStaticMarkup(<SocialInsightReportView report={report}/>);
 assert.doesNotMatch(html,/信号不足|暂无法指导|待补充配文|分析依据不充分|配文分类依据|对当前 B2B 商户的帮助|可拍选题/);
 assert.match(html,/原料演示/);assert.match(html,/已有消费者体验素材/);assert.match(html,/展示实际使用场景/);assert.match(html,/1,234/);assert.match(html,/查看原视频/);
 assert.equal(JSON.stringify(report),stored);
});

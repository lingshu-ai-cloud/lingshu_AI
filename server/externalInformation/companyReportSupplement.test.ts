import assert from 'node:assert/strict';
import test from 'node:test';
import { companySupplementOriginals, supplementCompanyAnalysis } from './companyReportSupplement.js';
import { COMPANY_REPORT_CATALOG } from './companyReportCatalog.js';
import type { CompanyAnalysis } from '../../shared/contracts/companyReport.js';
const target = COMPANY_REPORT_CATALOG[0];
const original = (date: string, text = '华熙生物持续开发新原料和客户。') => ({ id: 'S1', source: { title: '华熙生物产品研发', uri: 'https://publisher.com/company/article.html' }, text, published: [date] });

test('supplement sources exclude later events, old years, undated and unrelated issuers', () => {
  assert.equal(companySupplementOriginals([original('2026-06-01'), original('2026-12-01'), original('2025-06-01'), original(''), original('2026-06-02', '其他企业持续开发新原料和客户。')], target).length, 1);
});

test('bounded supplement retrieves once and requires original quotation and existing page citations', async () => {
  const insight = { text: '公司披露持续开发新原料和客户。', evidenceIds: ['P12'] };
  const analysis = { headline: '原料开发需要核对客户采用情况', conclusion: insight, sections: [{ title: '产品转化', observation: { ...insight, quote: insight.text } }], watchpoints: [] } as CompanyAnalysis;
  let searched = 0, read = 0, generated = 0;
  const dependencies = {
    search: async () => { searched++; return { text: '', sources: [original('2026-06-01').source] }; },
    originals: async () => { read++; return { originals: [original('2026-06-01')], rejected: 0, rejectionReasons: {} }; },
    analyze: async () => { generated++; return JSON.stringify({ patches: [
      { section: 0, field: 'interpretation', text: '产品开发提示可能需要进一步验证客户采用情况。', evidenceIds: ['P12'], supplementaryEvidenceIds: ['W1'], quote: '华熙生物持续开发新原料和客户。' },
      { section: 0, field: 'implication', text: '供应商可能需要关注客户采用情况。', evidenceIds: ['P12'], supplementaryEvidenceIds: ['W1'], quote: '这是虚构的不存在于原文的引文内容。' },
    ] }); },
  };
  const result = await supplementCompanyAnalysis(target, analysis, [{ id: 'P12', page: 12, text: insight.text }], dependencies);
  assert.deepEqual([searched, read, generated], [1, 1, 1]);
  assert.equal(result.sources.length, 1); assert.equal(result.patches.length, 1);
  assert.equal(result.patches[0].field, 'interpretation');
});

test('no in-period original means no synthesis or paid retry', async () => {
  const insight = { text: '公司披露持续开发新原料和客户。', evidenceIds: ['P12'] };
  const analysis = { headline: '产品开发需结合客户采用情况', conclusion: insight, sections: [{ title: '产品转化', observation: { ...insight, quote: insight.text } }], watchpoints: [] } as CompanyAnalysis;
  let synthesis = 0;
  const result = await supplementCompanyAnalysis(target, analysis, [], {
    search: async () => ({ text: '', sources: [original('2026-12-01').source] }),
    originals: async () => ({ originals: [original('2026-12-01')], rejected: 0, rejectionReasons: {} }),
    analyze: async () => { synthesis++; throw Error('must not synthesize'); },
  });
  assert.deepEqual(result, { sources: [], patches: [] }); assert.equal(synthesis, 0);
});

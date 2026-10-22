import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import EnterpriseFaqPanel from './EnterpriseFaqPanel';
import { faqPackQuestions, toggleFaqPackSelection } from './useEnterpriseFaq';
import type { FaqItem, FaqPack, Profile } from './enterpriseProfileTypes';

const noOp = () => {};
const faq: FaqItem = { id: 'faq-1', question: '交期多久？', answer: '以报价单为准。', approvedForAuto: false };
const baseProfile: Profile = {
  company: { name: '', industry: '', mainMarkets: '', founded: '', description: '' },
  products: { categories: '', priceRange: '', moq: '', certifications: '', highlights: '' },
  brand: { tone: '', style: '', taboos: '', usp: '' },
  customers: { commonQuestions: '' },
  faq: [],
  knowledge: '',
};

function props(overrides: Partial<ComponentProps<typeof EnterpriseFaqPanel>> = {}): ComponentProps<typeof EnterpriseFaqPanel> {
  return {
    profile: baseProfile,
    completed: false,
    approvedFaqCount: 0,
    faqPacks: [],
    recommendedPackIndustry: 'general',
    faqPacksOpen: false,
    setFaqPacksOpen: noOp,
    openPackId: '',
    setOpenPackId: noOp,
    selectedQuestionsForPack: () => [],
    togglePackQuestion: noOp,
    importFaqPack: async () => {},
    packImporting: '',
    structureLegacyFaq: async () => {},
    faqStructuring: false,
    faqPreview: [],
    importFaqPreview: noOp,
    setFaqPreview: noOp,
    addFaq: noOp,
    visibleFaqs: [],
    updateFaq: noOp,
    removeFaq: noOp,
    faqPage: 1,
    faqItems: [],
    pageSize: 5,
    setFaqPage: noOp,
    ...overrides,
  };
}

test('empty FAQ keeps the draft-only guidance and add action', () => {
  const html = renderToStaticMarkup(<EnterpriseFaqPanel {...props()} />);
  assert.match(html, /data-enterprise-faq/);
  assert.match(html, /关闭自动回复时，AI 只写草稿等你确认/);
  assert.match(html, /还没有问答，先添加 5 条常见问题/);
  assert.match(html, /添加问答/);
});

test('FAQ preview and approved answer remain visible after view extraction', () => {
  const html = renderToStaticMarkup(<EnterpriseFaqPanel {...props({
    profile: { ...baseProfile, faq: [faq] },
    completed: true,
    approvedFaqCount: 1,
    faqItems: [faq],
    visibleFaqs: [{ ...faq, approvedForAuto: true }],
    faqPreview: [{ id: 'preview-1', question: '样品？', answer: '请联系销售。', approvedForAuto: false }],
  })} />);
  assert.match(html, /1 条已审批/);
  assert.match(html, /结构化预览/);
  assert.match(html, /交期多久？/);
  assert.match(html, /允许 AI 自动回复/);
});

test('pack selection remains disabled for incomplete or existing questions', () => {
  const pack: FaqPack = {
    id: 'pack-1', industry: 'general', industryLabel: '通用', scenario: 'presales', scenarioLabel: '售前',
    count: 2, preview: [], items: [
      { q: '缺少规则？', a: '待补全', vars: [], missingVars: ['付款条款'], ready: false },
      { q: '已经存在？', a: '已存在', vars: [], missingVars: [], ready: true, exists: true },
    ],
  };
  const html = renderToStaticMarkup(<EnterpriseFaqPanel {...props({ faqPacks: [pack], faqPacksOpen: true, openPackId: pack.id })} />);
  assert.match(html, /先完善报价规则板块：付款条款/);
  assert.match(html, /已存在，重复导入会跳过/);
  assert.equal((html.match(/type="checkbox"[^>]*disabled/g) ?? []).length, 2);
});

test('FAQ controller state stays mounted above the conditional tab view', () => {
  const page = readFileSync(new URL('../EnterprisePage.tsx', import.meta.url), 'utf8');
  const controller = readFileSync(new URL('./useEnterpriseFaq.ts', import.meta.url), 'utf8');
  const lifecycle = readFileSync(new URL('./useEnterpriseProfileLifecycle.ts', import.meta.url), 'utf8');
  assert.match(page, /useEnterpriseFaq\(\{ profile, setProfile, setSaveError, pageSize: PAGE_SIZE \}\)/);
  assert.ok(page.indexOf('useEnterpriseFaq(') < page.indexOf("knowledgeView === 'faq'"));
  assert.match(controller, /const \[faqPreview, setFaqPreview\] = useState/);
  assert.match(controller, /const \[selectedPackQuestions, setSelectedPackQuestions\] = useState/);
  assert.match(page, /knowledgeView === 'faq' && <EnterpriseFaqPanel/);
  assert.match(controller, /setFaqPage\(page => Math\.min/);
  assert.match(page, /setSaved, acceptLoadedPacks/);
  assert.match(lifecycle, /acceptLoadedPacks\(packData\)/);
});

test('pack selection starts with only ready questions and handles consecutive edits', () => {
  const pack: FaqPack = {
    id: 'pack-1', industry: 'general', industryLabel: '通用', scenario: 'presales', scenarioLabel: '售前',
    count: 3, preview: [], items: [
      { q: '交期？', a: '待确认', vars: [], missingVars: [], ready: true },
      { q: '付款？', a: '待确认', vars: [], missingVars: [], ready: true },
      { q: '已存在？', a: '重复', vars: [], missingVars: [], ready: true, exists: true },
    ],
  };
  const first = toggleFaqPackSelection({}, pack, '交期？');
  const second = toggleFaqPackSelection(first, pack, '付款？');
  assert.deepEqual(faqPackQuestions({}, pack), ['交期？', '付款？']);
  assert.deepEqual(faqPackQuestions(first, pack), ['付款？']);
  assert.deepEqual(faqPackQuestions(second, pack), []);
  assert.deepEqual(first['pack-1'], ['付款？']);
});

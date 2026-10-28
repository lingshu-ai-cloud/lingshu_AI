import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCompanyChineseNumbers as normalize } from './companyChineseNumbers.js';
test('explicit Chinese numeric claims normalize without converting their original currency unit or rewriting prose', () => {
 assert.equal(normalize('同比下降百分之十三点八零，费用率百分之一点八五；四点零版本。'), '同比下降13.80%，费用率1.85%；4.0版本。');
 assert.equal(normalize('一百二十九元、一亿元、三千万元、零点八五亿元'), '129元、1亿元、3000万元、0.85亿元');
 assert.equal(normalize('百分之七十四点九五；五维模型与三种方向'), '74.95%；五维模型与三种方向');
});

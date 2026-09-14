import { evidenceHash } from './canonical.js';
import { invalidQuote } from './errors.js';
import {
  addDecimal,
  compareDecimal,
  decimalToMoney,
  decimalToString,
  multiplyByBps,
  multiplyDecimalByInteger,
  parseExactDecimal,
  subtractDecimal,
  type ExactDecimal,
} from './fixedDecimal.js';
import type {
  NormalizedQuoteInquiry,
  QuoteCalculation,
  QuoteEstimate,
  QuoteException,
  QuoteInquiryInput,
  QuoteMissingField,
  QuoteRuleSetInput,
  SkuQuoteRuleInput,
} from './types.js';

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const COUNTRY_PATTERN = /^(?:[A-Z]{2}|\*)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INCOTERM_PATTERN = /^(?:[A-Z]{3}|\*)$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_QUANTITY = 1_000_000_000;

function requiredText(value: unknown, label: string, max = 160): string {
  if (typeof value !== 'string') invalidQuote(`${label} must be a string`);
  const output = value.trim();
  if (!output || output.length > max) invalidQuote(`${label} is required and must be at most ${max} characters`);
  return output;
}

function optionalText(value: unknown, label: string, max = 160): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requiredText(value, label, max);
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    invalidQuote(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function decimalString(value: unknown, label: string): string {
  if (typeof value !== 'string') invalidQuote(`${label} must be a decimal string`);
  try {
    return decimalToString(parseExactDecimal(value, label));
  } catch (error) {
    invalidQuote(error instanceof Error ? error.message : `${label} is invalid`);
  }
}

function currency(value: unknown, label: string): string {
  const output = requiredText(value, label, 3).toUpperCase();
  if (!CURRENCY_PATTERN.test(output)) invalidQuote(`${label} must be a three-letter currency code`);
  return output;
}

function isoDate(value: unknown, label: string): string {
  const output = requiredText(value, label, 10);
  const parsed = DATE_PATTERN.test(output) ? new Date(`${output}T00:00:00.000Z`) : new Date(Number.NaN);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== output) {
    invalidQuote(`${label} must be a real YYYY-MM-DD date`);
  }
  return output;
}

function dateOrTimestamp(value: unknown, label: string): string {
  const output = requiredText(value, label, 40);
  if (DATE_PATTERN.test(output)) return isoDate(output, label);
  if (!ISO_TIMESTAMP_PATTERN.test(output) || !Number.isFinite(Date.parse(output))) {
    invalidQuote(`${label} must be an ISO date or timestamp`);
  }
  return new Date(output).toISOString();
}

function stringList(value: unknown, label: string, options: { uppercase?: boolean; allowEmpty?: boolean } = {}): string[] {
  if (!Array.isArray(value)) invalidQuote(`${label} must be an array`);
  const normalized = value.map((item, index) => {
    const output = requiredText(item, `${label}[${index}]`, 300);
    return options.uppercase ? output.toUpperCase() : output;
  });
  const unique = [...new Set(normalized)].sort();
  if (!options.allowEmpty && unique.length === 0) invalidQuote(`${label} must not be empty`);
  return unique;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidQuote(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function normalizedSpecificationRules(value: unknown, label: string): Record<string, string[]> {
  const record = plainRecord(value, label);
  const output = Object.create(null) as Record<string, string[]>;
  for (const rawKey of Object.keys(record).sort()) {
    const key = requiredText(rawKey, `${label} key`, 80);
    if (Object.prototype.hasOwnProperty.call(output, key)) invalidQuote(`${label} contains duplicate keys`);
    output[key] = stringList(record[rawKey], `${label}.${key}`, { allowEmpty: true });
  }
  return output;
}

function normalizedSkuRule(value: unknown, index: number): SkuQuoteRuleInput {
  const source = plainRecord(value, `skuRules[${index}]`);
  const sku = requiredText(source.sku, `skuRules[${index}].sku`, 100).toUpperCase();
  const moq = integer(source.moq, `skuRules[${index}].moq`, 1, MAX_QUANTITY);
  if (!Array.isArray(source.quantityTiers) || source.quantityTiers.length === 0) {
    invalidQuote(`skuRules[${index}].quantityTiers must not be empty`);
  }
  const quantityTiers = source.quantityTiers.map((item, tierIndex) => {
    const tier = plainRecord(item, `skuRules[${index}].quantityTiers[${tierIndex}]`);
    return {
      minQuantity: integer(tier.minQuantity, `skuRules[${index}].quantityTiers[${tierIndex}].minQuantity`, 1, MAX_QUANTITY),
      unitPrice: decimalString(tier.unitPrice, `skuRules[${index}].quantityTiers[${tierIndex}].unitPrice`),
    };
  }).sort((left, right) => left.minQuantity - right.minQuantity);
  if (new Set(quantityTiers.map(tier => tier.minQuantity)).size !== quantityTiers.length) {
    invalidQuote(`skuRules[${index}].quantityTiers contains duplicate minimum quantities`);
  }
  if (quantityTiers[0].minQuantity > moq) invalidQuote(`skuRules[${index}] has no quantity tier covering its MOQ`);

  if (!Array.isArray(source.incoterms) || source.incoterms.length === 0) {
    invalidQuote(`skuRules[${index}].incoterms must not be empty`);
  }
  const incoterms = source.incoterms.map((item, incotermIndex) => {
    const rule = plainRecord(item, `skuRules[${index}].incoterms[${incotermIndex}]`);
    const code = requiredText(rule.code, `skuRules[${index}].incoterms[${incotermIndex}].code`, 3).toUpperCase();
    if (!INCOTERM_PATTERN.test(code) || code === '*') invalidQuote(`incoterm code ${code} is invalid`);
    return {
      code,
      flatFee: decimalString(rule.flatFee ?? '0', `incoterm ${code}.flatFee`),
      perUnitFee: decimalString(rule.perUnitFee ?? '0', `incoterm ${code}.perUnitFee`),
      ...(rule.leadTimeDays === undefined
        ? {}
        : { leadTimeDays: integer(rule.leadTimeDays, `incoterm ${code}.leadTimeDays`, 1, 3650) }),
    };
  }).sort((left, right) => left.code.localeCompare(right.code));
  if (new Set(incoterms.map(rule => rule.code)).size !== incoterms.length) {
    invalidQuote(`skuRules[${index}].incoterms contains duplicate codes`);
  }

  if (!Array.isArray(source.shippingRules) || source.shippingRules.length === 0) {
    invalidQuote(`skuRules[${index}].shippingRules must not be empty; use an explicit zero-fee wildcard when applicable`);
  }
  const shippingRules = source.shippingRules.map((item, shippingIndex) => {
    const rule = plainRecord(item, `skuRules[${index}].shippingRules[${shippingIndex}]`);
    const destinationCountry = requiredText(rule.destinationCountry, `shipping destination`, 2).toUpperCase();
    const incoterm = requiredText(rule.incoterm, `shipping incoterm`, 3).toUpperCase();
    if (!COUNTRY_PATTERN.test(destinationCountry)) invalidQuote(`shipping destination ${destinationCountry} is invalid`);
    if (!INCOTERM_PATTERN.test(incoterm)) invalidQuote(`shipping incoterm ${incoterm} is invalid`);
    return {
      destinationCountry,
      incoterm,
      flatFee: decimalString(rule.flatFee, `shipping ${destinationCountry}/${incoterm}.flatFee`),
      perUnitFee: decimalString(rule.perUnitFee ?? '0', `shipping ${destinationCountry}/${incoterm}.perUnitFee`),
    };
  }).sort((left, right) => `${left.destinationCountry}/${left.incoterm}`.localeCompare(`${right.destinationCountry}/${right.incoterm}`));
  if (new Set(shippingRules.map(rule => `${rule.destinationCountry}/${rule.incoterm}`)).size !== shippingRules.length) {
    invalidQuote(`skuRules[${index}].shippingRules contains ambiguous duplicate rules`);
  }

  return {
    sku,
    requiredSpecifications: normalizedSpecificationRules(source.requiredSpecifications ?? {}, `skuRules[${index}].requiredSpecifications`),
    moq,
    quantityTiers,
    unitCost: decimalString(source.unitCost, `skuRules[${index}].unitCost`),
    incoterms,
    shippingRules,
    taxRateBps: integer(source.taxRateBps, `skuRules[${index}].taxRateBps`, 0, 100_000),
    taxBasis: source.taxBasis === 'goods' || source.taxBasis === 'goods_and_shipping'
      ? source.taxBasis
      : invalidQuote(`skuRules[${index}].taxBasis is invalid`),
    allowedPaymentTerms: stringList(source.allowedPaymentTerms, `skuRules[${index}].allowedPaymentTerms`),
    standardLeadTimeDays: integer(source.standardLeadTimeDays, `skuRules[${index}].standardLeadTimeDays`, 1, 3650),
    maxDiscountBps: integer(source.maxDiscountBps, `skuRules[${index}].maxDiscountBps`, 0, 10_000),
    minMarginBps: integer(source.minMarginBps, `skuRules[${index}].minMarginBps`, 0, 10_000),
    validDays: integer(source.validDays, `skuRules[${index}].validDays`, 1, 365),
  };
}

/** Validate and canonicalize an immutable ruleset before it can be stored or used. */
export function normalizeQuoteRuleSet(value: unknown): QuoteRuleSetInput {
  const source = plainRecord(value, 'ruleSet');
  if (source.schemaVersion !== '1.0') invalidQuote('ruleSet.schemaVersion must be 1.0');
  if (source.status !== 'confirmed') invalidQuote('Only confirmed rule sets may calculate quotations');
  const baseCurrency = currency(source.baseCurrency, 'ruleSet.baseCurrency');
  const fxSource = plainRecord(source.fxSnapshot, 'ruleSet.fxSnapshot');
  const rawRates = plainRecord(fxSource.rates, 'ruleSet.fxSnapshot.rates');
  const rates = Object.create(null) as Record<string, string>;
  for (const rawCode of Object.keys(rawRates).sort()) {
    const code = currency(rawCode, `ruleSet.fxSnapshot.rates currency`);
    const rate = decimalString(rawRates[rawCode], `ruleSet.fxSnapshot.rates.${code}`);
    if (parseExactDecimal(rate).coefficient === 0n) invalidQuote(`FX rate ${code} must be greater than zero`);
    rates[code] = rate;
  }
  if (rates[baseCurrency] !== undefined && rates[baseCurrency] !== '1') {
    invalidQuote(`Base-currency FX rate ${baseCurrency} must be exactly 1`);
  }
  rates[baseCurrency] = '1';
  if (!Array.isArray(source.skuRules) || source.skuRules.length === 0) invalidQuote('ruleSet.skuRules must not be empty');
  const skuRules = source.skuRules.map(normalizedSkuRule).sort((left, right) => left.sku.localeCompare(right.sku));
  if (new Set(skuRules.map(rule => rule.sku)).size !== skuRules.length) invalidQuote('ruleSet.skuRules contains duplicate SKUs');

  return {
    schemaVersion: '1.0',
    ruleSetKey: requiredText(source.ruleSetKey, 'ruleSet.ruleSetKey', 80),
    version: requiredText(source.version, 'ruleSet.version', 80),
    status: 'confirmed',
    productId: requiredText(source.productId, 'ruleSet.productId', 100),
    baseCurrency,
    fxSnapshot: {
      id: requiredText(fxSource.id, 'ruleSet.fxSnapshot.id', 100),
      asOf: dateOrTimestamp(fxSource.asOf, 'ruleSet.fxSnapshot.asOf'),
      rates,
      sourceRefs: stringList(fxSource.sourceRefs, 'ruleSet.fxSnapshot.sourceRefs'),
    },
    skuRules,
    sourceRefs: stringList(source.sourceRefs, 'ruleSet.sourceRefs'),
  };
}

export function quoteRuleSetHash(ruleSet: QuoteRuleSetInput): string {
  return evidenceHash(normalizeQuoteRuleSet(ruleSet));
}

interface ParsedInquiry {
  input: Partial<NormalizedQuoteInquiry>;
  missing: QuoteMissingField[];
}

function parseInquiry(value: QuoteInquiryInput, ruleSet: QuoteRuleSetInput): ParsedInquiry {
  const source = plainRecord(value, 'input');
  const output: Partial<NormalizedQuoteInquiry> = {};
  const missing: QuoteMissingField[] = [];

  const textFacts: Array<[keyof NormalizedQuoteInquiry, string | undefined, boolean?]> = [
    ['inquiryId', optionalText(source.inquiryId, 'input.inquiryId', 120)],
    ['inquiryVersion', source.inquiryVersion === undefined || source.inquiryVersion === null || source.inquiryVersion === ''
      ? undefined
      : requiredText(String(source.inquiryVersion), 'input.inquiryVersion', 80)],
    ['sku', optionalText(source.sku, 'input.sku', 100)?.toUpperCase(), true],
    ['quoteCurrency', optionalText(source.quoteCurrency, 'input.quoteCurrency', 3)?.toUpperCase(), true],
    ['incoterm', optionalText(source.incoterm, 'input.incoterm', 3)?.toUpperCase(), true],
    ['destinationCountry', optionalText(source.destinationCountry, 'input.destinationCountry', 2)?.toUpperCase(), true],
    ['paymentTerm', optionalText(source.paymentTerm, 'input.paymentTerm', 120)],
    ['quoteDate', optionalText(source.quoteDate, 'input.quoteDate', 10)],
  ];
  for (const [key, item] of textFacts) {
    if (!item) missing.push(key as QuoteMissingField);
    else (output as Record<string, unknown>)[key] = item;
  }
  if (output.quoteCurrency && !CURRENCY_PATTERN.test(output.quoteCurrency)) invalidQuote('input.quoteCurrency is invalid');
  if (output.incoterm && (!INCOTERM_PATTERN.test(output.incoterm) || output.incoterm === '*')) invalidQuote('input.incoterm is invalid');
  if (output.destinationCountry && (!COUNTRY_PATTERN.test(output.destinationCountry) || output.destinationCountry === '*')) invalidQuote('input.destinationCountry is invalid');
  if (output.quoteDate) output.quoteDate = isoDate(output.quoteDate, 'input.quoteDate');

  if (source.quantity === undefined || source.quantity === null || source.quantity === '') missing.push('quantity');
  else output.quantity = integer(source.quantity, 'input.quantity', 1, MAX_QUANTITY);

  output.requestedDiscountBps = source.requestedDiscountBps === undefined || source.requestedDiscountBps === null || source.requestedDiscountBps === ''
    ? 0
    : integer(source.requestedDiscountBps, 'input.requestedDiscountBps', 0, 10_000);
  if (source.requestedLeadTimeDays !== undefined && source.requestedLeadTimeDays !== null && source.requestedLeadTimeDays !== '') {
    output.requestedLeadTimeDays = integer(source.requestedLeadTimeDays, 'input.requestedLeadTimeDays', 1, 3650);
  }

  const specifications = Object.create(null) as Record<string, string>;
  if (source.specifications !== undefined && source.specifications !== null) {
    const values = plainRecord(source.specifications, 'input.specifications');
    for (const rawKey of Object.keys(values).sort()) {
      specifications[requiredText(rawKey, 'input specification key', 80)] = requiredText(values[rawKey], `input.specifications.${rawKey}`, 200);
    }
  }
  output.specifications = specifications;

  const skuRule = output.sku ? ruleSet.skuRules.find(rule => rule.sku === output.sku) : undefined;
  if (skuRule) {
    for (const specification of Object.keys(skuRule.requiredSpecifications).sort()) {
      if (!specifications[specification]) missing.push(`specifications.${specification}`);
    }
  }
  return { input: output, missing: [...new Set(missing)] };
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function shippingRuleFor(rule: SkuQuoteRuleInput, country: string, incoterm: string) {
  const preference = [
    `${country}/${incoterm}`,
    `${country}/*`,
    `*/${incoterm}`,
    '*/*',
  ];
  for (const key of preference) {
    const match = rule.shippingRules.find(item => `${item.destinationCountry}/${item.incoterm}` === key);
    if (match) return match;
  }
  return undefined;
}

function fee(flat: string | undefined, perUnit: string | undefined, quantity: number): ExactDecimal {
  return addDecimal(
    parseExactDecimal(flat ?? '0'),
    multiplyDecimalByInteger(parseExactDecimal(perUnit ?? '0'), quantity),
  );
}

function marginBps(revenue: ExactDecimal, cost: ExactDecimal): number {
  if (revenue.coefficient === 0n || compareDecimal(revenue, cost) <= 0) return 0;
  const profit = subtractDecimal(revenue, cost);
  const commonScale = Math.max(profit.scale, revenue.scale);
  const numerator = profit.coefficient * (10n ** BigInt(commonScale - profit.scale)) * 10_000n;
  const denominator = revenue.coefficient * (10n ** BigInt(commonScale - revenue.scale));
  return Number(numerator / denominator); // floor is deliberately conservative for the margin gate.
}

function exception(
  code: QuoteException['code'],
  field: string,
  requested: string | number,
  allowed: string | number,
  message: string,
): QuoteException {
  return { code, field, requested: String(requested), allowed: String(allowed), message };
}

const AI_BOUNDARY = Object.freeze({
  allowed: ['field_extraction', 'missing_fact_questions', 'multilingual_narrative'] as const,
  forbidden: ['price_calculation', 'discount_authorization', 'commercial_term_mutation', 'external_send'] as const,
});

/**
 * Pure, deterministic quotation function. It performs no I/O, reads no clock,
 * calls no model/provider, and derives every amount from the bound rule set.
 */
export function calculateQuote(rawRuleSet: unknown, rawInput: QuoteInquiryInput): QuoteEstimate {
  const ruleSet = normalizeQuoteRuleSet(rawRuleSet);
  const ruleHash = evidenceHash(ruleSet);
  const parsed = parseInquiry(rawInput, ruleSet);
  const inputHash = evidenceHash(parsed.input);
  const base = {
    schemaVersion: '1.0' as const,
    input: parsed.input,
    inputHash,
    ruleSetRef: { key: ruleSet.ruleSetKey, version: ruleSet.version, hash: ruleHash },
    missingFields: parsed.missing,
    missingQuestions: parsed.missing.map(field => ({ field, key: `quote.missing.${field}` })),
    exceptions: [] as QuoteException[],
    calculation: null,
    commercialTermsLocked: true as const,
    aiBoundary: AI_BOUNDARY,
  };
  if (parsed.missing.length > 0) return { ...base, status: 'missing_facts', executable: false };

  const input = parsed.input as NormalizedQuoteInquiry;
  const skuRule = ruleSet.skuRules.find(rule => rule.sku === input.sku);
  if (!skuRule) {
    return {
      ...base,
      status: 'exception_required',
      executable: false,
      exceptions: [exception('unsupported_sku', 'sku', input.sku, ruleSet.skuRules.map(rule => rule.sku).join(','), 'SKU is outside the confirmed rule set.')],
    };
  }

  const exceptions: QuoteException[] = [];
  for (const [name, allowed] of Object.entries(skuRule.requiredSpecifications)) {
    const requested = input.specifications[name];
    if (allowed.length > 0 && !allowed.includes(requested)) {
      exceptions.push(exception('unsupported_specification', `specifications.${name}`, requested, allowed.join(','), 'Specification is outside the confirmed rule set.'));
    }
  }
  if (input.quantity < skuRule.moq) {
    exceptions.push(exception('below_moq', 'quantity', input.quantity, `>=${skuRule.moq}`, 'Requested quantity is below MOQ.'));
  }
  const rate = ruleSet.fxSnapshot.rates[input.quoteCurrency];
  if (!rate) {
    exceptions.push(exception('currency_not_in_fx_snapshot', 'quoteCurrency', input.quoteCurrency, Object.keys(ruleSet.fxSnapshot.rates).join(','), 'Currency is absent from the bound FX snapshot.'));
  }
  const incotermRule = skuRule.incoterms.find(rule => rule.code === input.incoterm);
  if (!incotermRule) {
    exceptions.push(exception('incoterm_not_allowed', 'incoterm', input.incoterm, skuRule.incoterms.map(rule => rule.code).join(','), 'Incoterm is outside the confirmed rule set.'));
  }
  const shippingRule = shippingRuleFor(skuRule, input.destinationCountry, input.incoterm);
  if (!shippingRule) {
    exceptions.push(exception('shipping_rule_missing', 'destinationCountry', input.destinationCountry, 'confirmed shipping destination', 'No deterministic shipping rule matches the destination and Incoterm.'));
  }
  if (input.requestedDiscountBps > skuRule.maxDiscountBps) {
    exceptions.push(exception('discount_outside_authority', 'requestedDiscountBps', input.requestedDiscountBps, `<=${skuRule.maxDiscountBps}`, 'Discount exceeds the confirmed authority.'));
  }
  if (!skuRule.allowedPaymentTerms.includes(input.paymentTerm)) {
    exceptions.push(exception('payment_term_outside_authority', 'paymentTerm', input.paymentTerm, skuRule.allowedPaymentTerms.join(','), 'Payment term is outside the confirmed authority.'));
  }
  const standardLeadTime = incotermRule?.leadTimeDays ?? skuRule.standardLeadTimeDays;
  const promisedLeadTime = input.requestedLeadTimeDays ?? standardLeadTime;
  if (promisedLeadTime < standardLeadTime) {
    exceptions.push(exception('lead_time_outside_authority', 'requestedLeadTimeDays', promisedLeadTime, `>=${standardLeadTime}`, 'Requested lead time is shorter than the confirmed rule.'));
  }

  const tier = [...skuRule.quantityTiers].reverse().find(item => item.minQuantity <= input.quantity);
  if (!tier || !rate || !incotermRule || !shippingRule) {
    return { ...base, status: 'exception_required', executable: false, exceptions };
  }

  const unitPriceBase = parseExactDecimal(tier.unitPrice);
  const grossGoodsBase = multiplyDecimalByInteger(unitPriceBase, input.quantity);
  const discountBase = multiplyByBps(grossGoodsBase, input.requestedDiscountBps);
  const netGoodsBase = subtractDecimal(grossGoodsBase, discountBase);
  const incotermFeeBase = fee(incotermRule.flatFee, incotermRule.perUnitFee, input.quantity);
  const shippingBase = fee(shippingRule.flatFee, shippingRule.perUnitFee, input.quantity);
  const taxableBase = skuRule.taxBasis === 'goods'
    ? netGoodsBase
    : addDecimal(addDecimal(netGoodsBase, incotermFeeBase), shippingBase);
  const taxBase = multiplyByBps(taxableBase, skuRule.taxRateBps);
  const totalBase = addDecimal(addDecimal(addDecimal(netGoodsBase, incotermFeeBase), shippingBase), taxBase);
  const costBase = multiplyDecimalByInteger(parseExactDecimal(skuRule.unitCost), input.quantity);
  const calculatedMarginBps = marginBps(netGoodsBase, costBase);
  if (calculatedMarginBps < skuRule.minMarginBps) {
    exceptions.push(exception('margin_below_floor', 'marginBps', calculatedMarginBps, `>=${skuRule.minMarginBps}`, 'Calculated gross margin is below the confirmed floor.'));
  }

  const exactRate = parseExactDecimal(rate);
  const goodsSubtotal = decimalToMoney(grossGoodsBase, input.quoteCurrency, exactRate);
  const discount = decimalToMoney(discountBase, input.quoteCurrency, exactRate);
  const incotermFee = decimalToMoney(incotermFeeBase, input.quoteCurrency, exactRate);
  const shipping = decimalToMoney(shippingBase, input.quoteCurrency, exactRate);
  const tax = decimalToMoney(taxBase, input.quoteCurrency, exactRate);
  // Total is rounded from the exact aggregate, never accumulated through binary floats.
  const total = decimalToMoney(totalBase, input.quoteCurrency, exactRate);
  const calculationWithoutHash: Omit<QuoteCalculation, 'calculationHash'> = {
    schemaVersion: '1.0',
    pricingTierMinQuantity: tier.minQuantity,
    appliedDiscountBps: input.requestedDiscountBps,
    promisedLeadTimeDays: promisedLeadTime,
    validFrom: input.quoteDate,
    validUntil: addDays(input.quoteDate, skuRule.validDays),
    fxSnapshot: {
      id: ruleSet.fxSnapshot.id,
      asOf: ruleSet.fxSnapshot.asOf,
      sourceRefs: ruleSet.fxSnapshot.sourceRefs,
      rate,
      baseCurrency: ruleSet.baseCurrency,
      quoteCurrency: input.quoteCurrency,
    },
    unitPrice: decimalToMoney(unitPriceBase, input.quoteCurrency, exactRate),
    goodsSubtotal,
    discount,
    incotermFee,
    shipping,
    tax,
    total,
    marginBps: calculatedMarginBps,
  };
  const calculation: QuoteCalculation = {
    ...calculationWithoutHash,
    calculationHash: evidenceHash({
      inputHash,
      ruleSetHash: ruleHash,
      commercialTerms: calculationWithoutHash,
    }),
  };
  return {
    ...base,
    status: exceptions.length > 0 ? 'exception_required' : 'calculated',
    executable: exceptions.length === 0,
    exceptions,
    calculation,
  };
}

/** Amount-free extraction contract for an LLM adapter. Unknown/commercial keys are dropped. */
export function quoteInquiryFactsFromAi(candidate: unknown): QuoteInquiryInput {
  const source = plainRecord(candidate, 'extracted inquiry');
  const allowed = new Set([
    'inquiryId', 'inquiryVersion', 'sku', 'specifications', 'quantity', 'quoteCurrency',
    'incoterm', 'destinationCountry', 'paymentTerm', 'requestedDiscountBps',
    'requestedLeadTimeDays', 'quoteDate',
  ]);
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key))) as QuoteInquiryInput;
}

/**
 * Commercial quotation domain contracts.
 *
 * AI integrations may populate QuoteInquiryInput facts and render prose from a
 * completed calculation. They must never populate or mutate monetary fields.
 * All commercial amounts are produced by the deterministic engine.
 */

export type QuoteCurrency = string;

export interface MoneyAmount {
  currency: QuoteCurrency;
  /** Integer in the currency's smallest unit. Kept as text to avoid JS precision loss. */
  minorUnits: string;
  /** Canonical fixed-point representation for display/API clients. */
  decimal: string;
}

export interface FxSnapshotInput {
  id: string;
  asOf: string;
  /** Target-currency major units per one base-currency major unit. */
  rates: Record<string, string>;
  sourceRefs: string[];
}

export interface QuantityTierInput {
  minQuantity: number;
  /** Base-currency major units, represented as a decimal string. */
  unitPrice: string;
}

export interface IncotermRuleInput {
  code: string;
  flatFee?: string;
  perUnitFee?: string;
  leadTimeDays?: number;
}

export interface ShippingRuleInput {
  /** ISO alpha-2 country code, or `*` as a deliberate fallback rule. */
  destinationCountry: string;
  /** Incoterm code, or `*` as a deliberate fallback rule. */
  incoterm: string;
  flatFee: string;
  perUnitFee?: string;
}

export interface SkuQuoteRuleInput {
  sku: string;
  /** Required specification name -> allowed values. Empty values means any non-empty value. */
  requiredSpecifications: Record<string, string[]>;
  moq: number;
  quantityTiers: QuantityTierInput[];
  unitCost: string;
  incoterms: IncotermRuleInput[];
  shippingRules: ShippingRuleInput[];
  taxRateBps: number;
  taxBasis: 'goods' | 'goods_and_shipping';
  allowedPaymentTerms: string[];
  standardLeadTimeDays: number;
  maxDiscountBps: number;
  minMarginBps: number;
  validDays: number;
}

export interface QuoteRuleSetInput {
  schemaVersion: '1.0';
  ruleSetKey: string;
  version: string;
  status: 'confirmed';
  productId: string;
  baseCurrency: QuoteCurrency;
  fxSnapshot: FxSnapshotInput;
  skuRules: SkuQuoteRuleInput[];
  sourceRefs: string[];
}

/** Facts that may be extracted from an inquiry by AI. No monetary output is accepted. */
export interface QuoteInquiryInput {
  inquiryId?: unknown;
  inquiryVersion?: unknown;
  sku?: unknown;
  specifications?: unknown;
  quantity?: unknown;
  quoteCurrency?: unknown;
  incoterm?: unknown;
  destinationCountry?: unknown;
  paymentTerm?: unknown;
  requestedDiscountBps?: unknown;
  requestedLeadTimeDays?: unknown;
  /** Explicit business date makes replays stable; the engine never calls Date.now(). */
  quoteDate?: unknown;
}

export interface NormalizedQuoteInquiry {
  inquiryId: string;
  inquiryVersion: string;
  sku: string;
  specifications: Record<string, string>;
  quantity: number;
  quoteCurrency: QuoteCurrency;
  incoterm: string;
  destinationCountry: string;
  paymentTerm: string;
  requestedDiscountBps: number;
  requestedLeadTimeDays?: number;
  quoteDate: string;
}

export type QuoteMissingField =
  | 'inquiryId'
  | 'inquiryVersion'
  | 'sku'
  | 'quantity'
  | 'quoteCurrency'
  | 'incoterm'
  | 'destinationCountry'
  | 'paymentTerm'
  | 'quoteDate'
  | `specifications.${string}`;

export interface QuoteException {
  code:
    | 'unsupported_sku'
    | 'unsupported_specification'
    | 'below_moq'
    | 'currency_not_in_fx_snapshot'
    | 'incoterm_not_allowed'
    | 'shipping_rule_missing'
    | 'discount_outside_authority'
    | 'payment_term_outside_authority'
    | 'lead_time_outside_authority'
    | 'margin_below_floor';
  field: string;
  requested: string;
  allowed: string;
  message: string;
}

export interface QuoteCalculation {
  schemaVersion: '1.0';
  pricingTierMinQuantity: number;
  appliedDiscountBps: number;
  promisedLeadTimeDays: number;
  validFrom: string;
  validUntil: string;
  fxSnapshot: {
    id: string;
    asOf: string;
    sourceRefs: string[];
    rate: string;
    baseCurrency: QuoteCurrency;
    quoteCurrency: QuoteCurrency;
  };
  unitPrice: MoneyAmount;
  goodsSubtotal: MoneyAmount;
  discount: MoneyAmount;
  incotermFee: MoneyAmount;
  shipping: MoneyAmount;
  tax: MoneyAmount;
  total: MoneyAmount;
  marginBps: number;
  calculationHash: string;
}

export interface QuoteEstimate {
  schemaVersion: '1.0';
  status: 'missing_facts' | 'exception_required' | 'calculated';
  executable: boolean;
  input: Partial<NormalizedQuoteInquiry>;
  inputHash: string;
  ruleSetRef: {
    key: string;
    version: string;
    hash: string;
  };
  missingFields: QuoteMissingField[];
  missingQuestions: Array<{ field: QuoteMissingField; key: string }>;
  exceptions: QuoteException[];
  /** Null whenever required facts are absent. */
  calculation: QuoteCalculation | null;
  commercialTermsLocked: true;
  aiBoundary: {
    allowed: readonly ['field_extraction', 'missing_fact_questions', 'multilingual_narrative'];
    forbidden: readonly ['price_calculation', 'discount_authorization', 'commercial_term_mutation', 'external_send'];
  };
}

export interface ActorContext {
  tenantId: string;
  userId: string;
  role: 'super_admin' | 'admin' | 'social_operator' | 'customer_service';
}

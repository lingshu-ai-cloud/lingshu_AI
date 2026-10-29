/** Direct consumer coupon acquisition pages are not industry research, regardless of publisher host. */
export function isConsumerCouponPromotion(title: string): boolean {
  return /红包|领券|优惠券|折扣码|优惠码|coupon\s*code|promo\s*code|voucher\s*code|claim\s+(?:your\s+)?coupon/iu.test(title.normalize('NFKC'));
}

/** Exclude shopping recommendations with affiliate links, while keeping ordinary reporting that happens to disclose affiliate links. */
export function isAffiliateShoppingGuide(title: string, text: string): boolean {
  return /(?:affiliate|commission|联盟营销|佣金)/iu.test(text)
    && /(?:fans? (?:are )?obsessed|shoppers? (?:are )?(?:love|obsessed)|best (?:beauty|skincare|skin care) (?:products|buys)|购物指南|好物推荐)/iu.test(title.normalize('NFKC'));
}

/** A recall trigger or applicability test cannot be restated as an exemption. */
export function regulatoryInterpretationSupported(claim: string, original: string): boolean {
 const exemption = /豁免|免责|免于|免除|exempt(?:ion|ed|ions)?\b/iu;
 if (!exemption.test(claim)) return true;
 // A negated exception is not positive evidence of exemption eligibility.
 return original.split(/(?<=[。！？.!?])\s*/u).some(sentence => exemption.test(sentence)
  && !/(?:不|未|无|不得|不能).{0,8}(?:豁免|免责|免于|免除)|(?:not|no|without)\s+(?:an?\s+)?exempt/iu.test(sentence));
}

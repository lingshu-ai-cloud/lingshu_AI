/** A specific enterprise site or machine cannot be reconstructed from a
 * generic prompt or a competitor's benchmark first frame. */
export function storyboardFactoryReferenceRequired(description: string): boolean {
  const factory = /工厂|厂区|车间|产线|流水线|生产线|设备|机器|工位|factory|workshop|production line|machine/i;
  const specific = /本厂|我厂|我司(?:工厂|厂区|车间|产线|生产线|设备)|我们(?:的)?(?:工厂|厂区|车间|产线|生产线|设备)|本企业(?:工厂|厂区|车间|产线|生产线|设备)|自有工厂|真实厂区|真实车间|指定设备|指定产线|同一台设备|原厂设备|our factory|our plant|our production line|specific machine/i;
  return factory.test(description) && specific.test(description);
}

/** Factory equipment can be product-free, but an explicitly visible product
 * must use a product selected in the first content-creation step. */
export function storyboardFactoryProductRequired(description: string): boolean {
  return /产品(?:实拍|特写|出现在|放在|摆在|沿|在(?:传送带|流水线|产线)|移动|包装|质检|检验)|(?:手持|拿着|摆放|包装|装配|组装|检验|质检|传送|输送).{0,8}产品|商品(?:特写|在(?:传送带|流水线|产线)|移动)|product (?:close.?up|on (?:the )?conveyor|in hand)/i.test(description);
}

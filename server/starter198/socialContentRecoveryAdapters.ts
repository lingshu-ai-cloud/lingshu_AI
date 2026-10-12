import type {SocialAssetSupplyProviderAdapter} from './socialContentAssetSupplyExecution.js';
export function socialProductionSupplyAdapters(input:{recoveryOnly?:boolean;hasPresenterExecution:boolean;custom:SocialAssetSupplyProviderAdapter[];free:SocialAssetSupplyProviderAdapter[];paid:()=>SocialAssetSupplyProviderAdapter[]}):SocialAssetSupplyProviderAdapter[]{
  const custom=input.custom.filter(adapter=>adapter.adapterId==='presenter_mother_segment.v1'||input.recoveryOnly||!input.hasPresenterExecution||!adapter.sourceStrategies.includes('authorized_digital_presenter'));
  return [...custom,...(input.recoveryOnly?[]:input.paid()),...input.free];
}

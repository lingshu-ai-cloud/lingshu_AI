import type { TikTokCreatorInfo, TikTokDirectPostOptions } from '../../server/lib/tikTokDirectPostContract';
export type { TikTokCreatorInfo, TikTokDirectPostOptions };
export type TikTokCreatorResponse = { accountId: string; creator: TikTokCreatorInfo; creatorReceiptHash: string; queriedAt: string; directPostApproved: boolean };
export type TikTokPostSettingsDraft = Omit<TikTokDirectPostOptions, 'privacyLevel'> & { privacyLevel: TikTokDirectPostOptions['privacyLevel'] | ''; disclosureEnabled: boolean };
export function emptyTikTokPostSettings(): TikTokPostSettingsDraft {
  return {privacyLevel:'',allowComment:false,allowDuet:false,allowStitch:false,disclosureEnabled:false,commercial:{ownBrand:false,brandedContent:false},isAigc:false,musicUsageConfirmed:false,userConsent:false};
}
export function editTikTokPostSettings(draft:TikTokPostSettingsDraft, patch:Partial<TikTokPostSettingsDraft>):TikTokPostSettingsDraft {
  return {...draft,...patch,commercial:{...(patch.commercial||draft.commercial)},musicUsageConfirmed:false,userConsent:false};
}
export function invalidateTikTokConsent(draft:TikTokPostSettingsDraft):TikTokPostSettingsDraft {return {...draft,musicUsageConfirmed:false,userConsent:false};}
export function validateTikTokCreatorResponse(value:TikTokCreatorResponse,accountId:string,now=Date.now()):TikTokCreatorResponse {
  const creator=value?.creator;
  if(value?.accountId!==accountId||!/^[a-f0-9]{64}$/.test(value.creatorReceiptHash)||!Number.isFinite(Date.parse(value.queriedAt))||Date.parse(value.queriedAt)>now+60000||now-Date.parse(value.queriedAt)>5*60000||typeof value.directPostApproved!=='boolean'
    ||!creator||typeof creator.creator_username!=='string'||!creator.creator_username.trim()||typeof creator.creator_nickname!=='string'||!creator.creator_nickname.trim()||!Array.isArray(creator.privacy_level_options)||!creator.privacy_level_options.length||!creator.privacy_level_options.every(item=>['PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR','SELF_ONLY'].includes(item))
    ||!['comment_disabled','duet_disabled','stitch_disabled'].every(key=>typeof (creator as unknown as Record<string,unknown>)[key]==='boolean')||!Number.isFinite(creator.max_video_post_duration_sec)||creator.max_video_post_duration_sec<=0)throw Error('TikTok 最新账号设置无法核验，请刷新');
  return value;
}
export function buildTikTokPostOptions(draft:TikTokPostSettingsDraft,response:TikTokCreatorResponse,accountId:string):TikTokDirectPostOptions {
  validateTikTokCreatorResponse(response,accountId);
  if(!response.directPostApproved)throw Error('TikTok Direct Post 需完成平台审核后才能提交');
  const creator=response.creator;
  if(!draft.privacyLevel||!creator.privacy_level_options.includes(draft.privacyLevel))throw Error('请手动选择 TikTok 可见范围');
  if((draft.allowComment&&creator.comment_disabled)||(draft.allowDuet&&creator.duet_disabled)||(draft.allowStitch&&creator.stitch_disabled))throw Error('TikTok 账号禁止所选互动，请重新核对');
  if(draft.disclosureEnabled&&!draft.commercial.ownBrand&&!draft.commercial.brandedContent)throw Error('请选择自己的品牌、第三方品牌或两者');
  if(draft.commercial.brandedContent&&draft.privacyLevel==='SELF_ONLY')throw Error('品牌合作内容不能设为仅自己可见');
  if(draft.musicUsageConfirmed!==true||draft.userConsent!==true)throw Error('请确认音乐声明并明确授权本次发布');
  for(const key of ['allowComment','allowDuet','allowStitch','isAigc'] as const)if(typeof draft[key]!=='boolean')throw Error('TikTok 发布设置无效');
  return {privacyLevel:draft.privacyLevel,allowComment:draft.allowComment,allowDuet:draft.allowDuet,allowStitch:draft.allowStitch,commercial:draft.disclosureEnabled?{...draft.commercial}:{ownBrand:false,brandedContent:false},isAigc:draft.isAigc,musicUsageConfirmed:true,userConsent:true};
}

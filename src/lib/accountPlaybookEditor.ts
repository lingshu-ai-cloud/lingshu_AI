import type {AccountPlaybook,OwnedSocialAccount} from '../../shared/contracts/socialProgram';
export interface AccountPlaybookDraft{audience:string;pillars:string;evidenceRules:string;entryType:string;entryRef:string;callToAction:string}
const lines=(value:string)=>value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
export async function saveExplicitAccountPlaybook(input:{programId:string;accountId:string;draft:AccountPlaybookDraft;activate:boolean;current:()=>boolean;list:()=>Promise<OwnedSocialAccount[]>;save:(body:Record<string,unknown>)=>Promise<AccountPlaybook>}){
 if(!input.current())throw Error('登录或账号选择已变化，请重新打开打法编辑。');
 const accounts=await input.list();if(!input.current())throw Error('登录或账号选择已变化，请重新打开打法编辑。');
 const matches=accounts.filter(a=>a.accountId===input.accountId&&a.programId===input.programId);if(matches.length!==1)throw Error('原账号不存在或身份不唯一，请刷新账号列表。');
 const account=matches[0];if(!Number.isSafeInteger(account.version)||account.version<1)throw Error('账号版本无效，请刷新。');const audience=lines(input.draft.audience),pillars=lines(input.draft.pillars),evidenceRules=lines(input.draft.evidenceRules);
 if(!audience.length||!pillars.length||!evidenceRules.length||!input.draft.callToAction.trim()||!['profile_link','comment','direct_message','store','form','whatsapp','other'].includes(input.draft.entryType))throw Error('请填写受众、内容支柱、证据规则和获客入口/CTA。');
 const result=await input.save({expectedAccountVersion:account.version,activate:input.activate,audience,pillars,evidenceRules,conversionRoute:{entryType:input.draft.entryType,entryRef:input.draft.entryRef.trim()||null,callToAction:input.draft.callToAction.trim()}});
 if(!input.current())throw Error('登录或账号选择已变化；请重新读取已保存的实际账号。');if(result.programId!==input.programId||result.accountId!==input.accountId||result.status!==(input.activate?'active':'draft')||!Number.isSafeInteger(result.version)||result.version<1)throw Error('保存回执与目标账号不一致，请重新读取。');return result;
}

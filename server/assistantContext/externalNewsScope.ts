import { latestAssistantQuestion } from './externalQuestion.js';
import type { ChatMessage } from '../agents/llm.js';
import { readTenantEnterpriseProfileStrict, type EnterpriseProfile } from '../routes/enterprise.js';

type NewsKind = '今日资讯' | '行业资讯' | '社交媒体资讯' | '政策与平台资讯';
const marker = '请补充资讯范围：';
function kindOf(value: string): NewsKind | undefined {
  if (/社交媒体资讯|社交媒体信号|内容趋势、热门话题/u.test(value)) return '社交媒体资讯';
  if (/政策与平台资讯|政策、合规、贸易和平台规则/u.test(value)) return '政策与平台资讯';
  if (/行业资讯/u.test(value)) return '行业资讯';
  if (/今日资讯|今天.*(?:外部资讯|资讯简报)|整理今天最值得关注的资讯/u.test(value)) return '今日资讯';
}
/** News scope only: do not send private operating facts, customers, prices or credentials to public search. */
export async function prepareExternalNewsScope(messages: ChatMessage[], tenantId: string, options: {
 read?: (tenantId: string) => Promise<EnterpriseProfile | null>;
} = {}): Promise<{ question: string; clarification?: string } | null> {
 const question=latestAssistantQuestion(messages);
 if (/不(?:用|要|必)联网|无需联网/u.test(question)) return null;
 const previous=messages.slice(0,-1).reverse().find(item=>item.role==='assistant');
 const continuation=previous?.content.startsWith(marker);
 const kind=kindOf(question)??(continuation?kindOf(previous!.content):undefined);
 if(!kind)return null;
 let profile:EnterpriseProfile|null=null;
 try { profile=await (options.read??readTenantEnterpriseProfileStrict)(tenantId); } catch { /* clarify rather than invent a tenant scope */ }
 if(profile?.dataGovernance?.aiAccessEnabled===false)profile=null;
 const bounded=(value:unknown)=>typeof value==='string'?value.trim().slice(0,120):'';
 const industry=bounded(profile?.company.industry), products=bounded(profile?.products.categories), market=bounded(profile?.company.mainMarkets);
 const platforms=profile?.socialStrategy?.primaryPlatforms?.map(bounded).filter(Boolean).join('、')??'';
 // An explicit user scope is preserved as written. Generic launcher text is not a concrete sector or destination.
 const explicitIndustry=/(?:行业|产品|品类)[：:][^，。,\n]{2,}|美妆|化妆品|护肤|防晒|原料|纺织|服装|机械|电子|家居|家具|食品|玩具|汽车|新能源|cosmetic|skincare/iu.test(question);
 const explicitMarket=/市场[：:][^，。,\n]{2,}|德国|法国|意大利|西班牙|中国|国内|全球|美国|欧盟|欧洲|英国|日本|韩国|越南|泰国|印尼|印度尼西亚|马来西亚|新加坡|菲律宾|东南亚|中东|沙特|阿联酋|澳大利亚|加拿大|巴西|墨西哥|印度|非洲/iu.test(question);
 const explicitPlatform=/TikTok|YouTube|Instagram|Facebook|Meta|阿里国际站|Alibaba|小红书|抖音|Google Trends/iu.test(question);
 const missing=[!industry&&!products&&!explicitIndustry?'行业或产品':'',!market&&!explicitMarket?'目标市场':'',kind==='社交媒体资讯'&&!platforms&&!explicitPlatform?'目标平台':''].filter(Boolean);
 if(missing.length)return {question,clarification:`${marker}${kind}还缺少${missing.join('、')}。例如“美妆原料，中国市场，TikTok”。我会据此检索公开原文，区分近期动态与历史资料；公开报道不代表已接入账号热度、销量或付费榜单。`};
 const timeRule=/不(?:需要|要求|用|必).{0,3}(?:近期|最新)|历史|20\d{2}年/iu.test(question)?'尊重用户指定的历史期间，不把历史资料称为最新。':'优先最近30天，若未取得合格近期原文则明确不足，不以历史资料替代今日动态。';
 return {question:`${kind}。${question}\n已明确的查询范围：${JSON.stringify({industry:explicitIndustry?'以用户本轮指定为准':industry,products:explicitIndustry?'':products,market:explicitMarket?'以用户本轮指定为准':market,platforms:explicitPlatform?'以用户本轮指定为准':platforms})}。只检索与上述行业、市场及平台直接相关的原始资料；没有证据的类别留缺，不使用宏观新闻凑数。${timeRule}`};
}

import '../server/loadEnvironment.js';
const response=await fetch((process.env.MINIMAX_BASE_URL || 'https://api.minimax.cn')+'/v1/get_voice',{method:'POST',headers:{Authorization:'Bearer '+process.env.MINIMAX_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({voice_type:'system'}),signal:AbortSignal.timeout(20000)});
const data:any=await response.json();
if(!response.ok||data.base_resp?.status_code)throw new Error('MiniMax voice lookup failed');
console.log(JSON.stringify((data.system_voice || []).filter((v:any)=>/^English_/i.test(v.voice_id) && /女性|女声|女士/.test((v.description || []).join(' '))),null,2));

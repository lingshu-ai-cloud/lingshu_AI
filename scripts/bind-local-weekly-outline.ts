import {supplementConsumerHash} from '../server/socialPrograms/weeklySupplementRequests.js';
import type {WeeklyExecutionTask} from '../shared/contracts/socialProgram.js';
// Explicit local-only binding through the existing authenticated producer API.
// Does not approve facts, activate a package, publish content or send messages.
const root='http://127.0.0.1:5177/api/overseas';
const {token}=await fetch(`${root}/auth/local-preview-session`,{method:'POST',headers:{Origin:'http://127.0.0.1:5177'}}).then(r=>r.json());
async function request(path:string,body?:unknown){const response=await fetch(`${root}${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json()};}
const programId='7f9242c2-bdeb-40ea-ae59-6c2adbc96fad',packageId='39eedb9f-30c3-46bb-b5f3-3922a006644d';
const base=`/social-programs/${programId}/operating-packages/${packageId}`;
const pkg=(await request(base)).body.item;
if(!pkg||!['draft','active'].includes(pkg.status))throw Error('current_package_unavailable');
const packageVersion=pkg.version;
const tasks=(await request(`${base}/execution-tasks?version=${packageVersion}`)).body.items as WeeklyExecutionTask[];
const outlines=tasks.filter(t=>t.schedule.stepKind==='business_outline');
if(outlines.length!==1)throw Error('outline_task_not_unique');
const task=outlines[0]!;
const result=await request(`${base}/producer-evidence/preproduction-authority`,{packageVersion,taskId:task.taskId,kind:'outline',expectedConsumerInputHash:supplementConsumerHash(task)});
console.log(JSON.stringify({httpStatus:result.status,taskId:task.taskId,code:result.body.code??result.body.error,item:result.body.item?{jobId:result.body.item.jobId,status:result.body.item.status,code:result.body.item.code}:undefined}));

import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const guard=fileURLToPath(new URL('./customer-isolated-test-guard.mjs',import.meta.url));
// NODE_OPTIONS survives launchers which discard execArgv. The direct Node test
// runner also preloads the guard before the TS loader and test modules.
const env={...process.env,CUSTOMER_ISOLATION_CANARY:'1',NODE_OPTIONS:`--import=${JSON.stringify(guard)} ${process.env.NODE_OPTIONS||''}`};
const child=spawn(process.execPath,['--import',guard,'--import','tsx','--test','--test-concurrency=1',...process.argv.slice(2)],{env,stdio:'inherit'});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=code??1;if(signal)console.error(`isolated test process ended: ${signal}`);});

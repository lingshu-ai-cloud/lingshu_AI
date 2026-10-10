/** Offline scope/graph checks. A JSON claim is not authenticated runtime evidence. */
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const str = x => typeof x === 'string' && x.length > 0 && x === x.trim();
const ver = x => Number.isSafeInteger(x) && x > 0;
const secret = x => obj(x) ? Object.entries(x).some(([k,v]) => /^(access_?token|refresh_?token|authorization|cookie|password|client_?secret|private_?key)$/i.test(k) || secret(v)) : Array.isArray(x) && x.some(secret);
const kinds = ['readiness','discovery','directing','content','publishing','engagement','review'];
const statuses = ['pending_activation','queued','leased','blocked','succeeded','cancelled','dead_letter'];
function context(input, kind) {
 const checks = [], check = (code, passed) => checks.push({code,passed:passed === true});
 const scope = input?.scope, evidence = input?.evidence, collection = input?.collection;
 check('input_object',obj(input)); check('secrets_absent',!secret(input));
 const validScope = obj(scope) && str(scope.tenantId) && str(scope.programId) && ver(scope.programVersion) && obj(scope.accountVersions) && Object.keys(scope.accountVersions).length > 0 && Object.entries(scope.accountVersions).every(([id,v]) => str(id) && ver(v));
 check('scope_pinned',validScope);
 const now = Date.parse(input?.now), at = Date.parse(collection?.collectedAt);
 check('collection_read_contract',obj(collection) && ['authenticated_api','tenant_filtered_datastore'].includes(collection.source) && collection.readOnly === true && collection.complete === true && str(collection.requestId));
 check('authenticated_tenant_bound',obj(collection?.authority) && collection.authority.authenticated === true && str(collection.authority.actorId) && collection.authority.tenantId === scope?.tenantId && collection?.tenantId === scope?.tenantId);
 check('collection_fresh',Number.isFinite(now) && Number.isFinite(at) && at <= now && now-at <= 30*60_000);
 check('code_revision_pinned',typeof collection?.codeRevision === 'string' && /^[a-f0-9]{40}$/.test(collection.codeRevision));
 check('evidence_object',obj(evidence));
 function rows(name) {
  const batch = evidence?.[name];
  check(`${name}_complete`,obj(batch) && Array.isArray(batch.items) && Number.isSafeInteger(batch.totalItems) && batch.totalItems === batch.items.length);
  const values = Array.isArray(batch?.items) ? batch.items : [];
  check(`${name}_unique_rows`,values.every(r=>obj(r)&&str(r.id)) && new Set(values.map(r=>r?.id)).size === values.length);
  return values;
 }
 function bound(row, payload, extra={}) {
  return obj(row) && obj(payload) && validScope && row.tenant_id === scope.tenantId && row.program_id === scope.programId && payload.programId === scope.programId && Object.entries(extra).every(([key,value])=>row[key]===value);
 }
 function finish(counts) {
  const missing = !obj(input) || !obj(scope) || !obj(evidence) || !obj(collection);
  return {status:missing ? 'missing' : checks.every(c=>c.passed) ? 'missing' : 'failed',checks,summary:{kind,dryRun:input?.mode === 'dry-run' || input?.dryRun === true,runtimeVerified:false,provenanceVerified:false,completionVerified:false,...counts,checkCount:checks.length,failedCheckCount:checks.filter(c=>!c.passed).length,verificationBoundary:'offline_contract_only'}};
 }
 return {scope,evidence,check,rows,bound,finish};
}
export function validateScopeEvidence(input) {
 const {scope,check,rows,bound,finish} = context(input,'tenant_scope');
 const programs=rows('programs'),accounts=rows('accounts');
 check('program_exact_version',programs.length===1 && programs.every(r=>bound(r,r?.payload) && r.version===scope.programVersion && r.payload.version===scope.programVersion && ['active','archived'].includes(r.payload.status)));
 const ids = obj(scope?.accountVersions) ? Object.keys(scope.accountVersions) : [];
 check('accounts_exact_set',accounts.length===ids.length && new Set(accounts.map(r=>r?.account_id)).size===accounts.length && accounts.every(r=>ids.includes(r?.account_id)));
 check('accounts_header_payload_bound',accounts.every(r=>bound(r,r?.payload) && r.account_id===r.payload.accountId && r.version===scope.accountVersions[r.account_id] && r.payload.version===r.version && r.status===r.payload.status && ['planned','active','paused','retired'].includes(r.status)));
 return finish({programCount:programs.length,accountCount:accounts.length});
}
export function validateWeeklyEvidence(input) {
 const {scope,check,rows,bound,finish} = context(input,'weekly_package_graph');
 check('package_scope_pinned',str(scope?.packageId) && ver(scope?.packageVersion) && [2,3].includes(scope?.executionGraphVersion));
 const packages=rows('packages'),tasks=rows('tasks'),pkg=packages[0]?.payload;
 check('package_exact_version',packages.length===1 && packages.every(r=>bound(r,r?.payload,{package_id:scope?.packageId,version:scope?.packageVersion}) && r.payload.packageId===scope.packageId && r.payload.version===scope.packageVersion && r.status===r.payload.status && ['draft','active','superseded','retired'].includes(r.status)));
 check('graph_version_bound',obj(pkg) && pkg.executionGraphVersion===scope?.executionGraphVersion);
 const publications = Array.isArray(pkg?.socialContentPackage?.publicationTasks) ? pkg.socialContentPackage.publicationTasks : [];
 check('content_package_bound',obj(pkg?.socialContentPackage) && pkg.socialContentPackage.operatingPackageId===scope?.packageId && pkg.socialContentPackage.version===scope?.packageVersion);
 check('publications_unique_and_scoped',publications.length>0 && new Set(publications.map(p=>p?.publicationTaskId)).size===publications.length && publications.every(p=>str(p?.publicationTaskId) && obj(scope?.accountVersions) && Object.hasOwn(scope.accountVersions,p.accountId)));
 const ids = new Set(tasks.map(r=>r?.task_id));
 check('graph_nonempty_unique',tasks.length>0 && ids.size===tasks.length);
 check('tasks_header_payload_bound',tasks.every(r=>bound(r,r?.payload,{package_id:scope?.packageId,package_version:scope?.packageVersion}) && r.task_id===r.payload.taskId && r.payload.tenantId===scope.tenantId && r.payload.packageId===scope.packageId && r.payload.packageVersion===scope.packageVersion && r.workflow_kind===r.payload.workflowKind && kinds.includes(r.workflow_kind) && r.status===r.payload.status && statuses.includes(r.status) && str(r.idempotency_key) && r.idempotency_key===r.payload.idempotencyKey));
 check('tasks_account_publication_bound',tasks.every(r=>obj(r?.payload) && (r.payload.accountId===null || obj(scope?.accountVersions) && Object.hasOwn(scope.accountVersions,r.payload.accountId)) && (r.payload.publicationTaskId===null || publications.some(p=>p.publicationTaskId===r.payload.publicationTaskId && p.accountId===r.payload.accountId))));
 check('dependencies_resolve',tasks.every(r=>Array.isArray(r?.payload?.dependsOnTaskIds) && new Set(r.payload.dependsOnTaskIds).size===r.payload.dependsOnTaskIds.length && r.payload.dependsOnTaskIds.every(id=>ids.has(id)&&id!==r.task_id)));
 const edges = new Map(tasks.map(r=>[r?.task_id,Array.isArray(r?.payload?.dependsOnTaskIds)?r.payload.dependsOnTaskIds:[]]));
 const visiting=new Set(),visited=new Set();
 function visit(id) { if(visiting.has(id))return false;if(visited.has(id))return true;visiting.add(id);for(const dep of edges.get(id)||[])if(!visit(dep))return false;visiting.delete(id);visited.add(id);return true; }
 check('graph_acyclic',[...ids].every(visit));
 const refs = pkg?.executionTaskRefs;
 check('package_graph_refs_exact',Array.isArray(refs) && refs.length===tasks.length && new Set(refs.map(r=>r?.id)).size===refs.length && refs.every(r=>ids.has(r?.id)&&r.type==='weekly_execution_task' && r.version===1));
 return finish({packageCount:packages.length,taskCount:tasks.length,publicationCount:publications.length});
}

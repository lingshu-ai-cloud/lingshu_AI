type JsonObject = Record<string, any>;

type Options = {
  apiRoot: string;
  programId: string | null;
  packageId: string | null;
  packageVersion: number | null;
};

const argValue = (name: string): string | null => {
  const inline = process.argv.find(value => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1).trim() || null;
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() || null : null;
};

function options(): Options {
  const version = argValue('--version');
  const parsedVersion = version === null ? null : Number(version);
  if (parsedVersion !== null && (!Number.isSafeInteger(parsedVersion) || parsedVersion < 1)) {
    throw new Error('invalid_package_version');
  }
  const programId = argValue('--program');
  const packageId = argValue('--package');
  if (Boolean(programId) !== Boolean(packageId)) throw new Error('program_and_package_must_be_provided_together');
  return {
    apiRoot: argValue('--api-root') || process.env.WEEKLY_DIAG_API_ROOT || 'http://127.0.0.1:8790/api/overseas',
    programId,
    packageId,
    packageVersion: parsedVersion,
  };
}

const statusCounts = (items: JsonObject[]) => items.reduce<Record<string, number>>((result, item) => {
  const key = String(item.status || 'unknown');
  result[key] = (result[key] || 0) + 1;
  return result;
}, {});

const taskBlockers = (task: JsonObject): string[] => [...new Set([
  ...(Array.isArray(task.ownBlockingReasons) ? task.ownBlockingReasons : []),
  task.lastError?.code,
].map(value => String(value || '').trim()).filter(Boolean))];

const stageTime = (task: JsonObject) => String(
  task.schedule?.plannedStartAt || task.schedule?.startAt || task.plannedStartAt || task.createdAt || task.taskId || '',
);

function blockerOwner(code: string): 'product_runtime' | 'external_evidence' | 'user_input' | 'engineering_review' {
  if (/cta_contact|required_upload|user_input|approval_required/i.test(code)) return 'user_input';
  if (/credential|provider|permit|cost|ceiling|budget|authorization|evidence|oauth|account_binding/i.test(code)) return 'external_evidence';
  if (/failed|unavailable|invalid|conflict|read_failed|write_failed|queue|worker/i.test(code)) return 'product_runtime';
  return 'engineering_review';
}

function nextStop(pkg: JsonObject, tasks: JsonObject[]) {
  const planning = Array.isArray(pkg.planningBlockers) ? pkg.planningBlockers.map(String).filter(Boolean) : [];
  if (planning.length) return { code: planning[0], stage: 'planning', owner: blockerOwner(planning[0]) };

  const blocked = tasks
    .flatMap(task => taskBlockers(task).map(code => ({ task, code })))
    .sort((left, right) => stageTime(left.task).localeCompare(stageTime(right.task)) || left.code.localeCompare(right.code));
  if (blocked[0]) return {
    code: blocked[0].code,
    stage: String(blocked[0].task.schedule?.stepKind || 'execution'),
    taskId: String(blocked[0].task.taskId || ''),
    owner: blockerOwner(blocked[0].code),
  };

  const queued = tasks.filter(task => ['queued', 'pending', 'ready'].includes(String(task.status))).sort((a, b) => stageTime(a).localeCompare(stageTime(b)));
  if (queued[0]) return {
    code: 'weekly_task_waiting_for_consumer',
    stage: String(queued[0].schedule?.stepKind || 'execution'),
    taskId: String(queued[0].taskId || ''),
    owner: 'product_runtime' as const,
  };
  if (tasks.length && tasks.every(task => String(task.status) === 'succeeded')) {
    return { code: 'weekly_execution_complete', stage: 'complete', owner: 'engineering_review' as const };
  }
  return { code: 'weekly_state_has_no_actionable_task', stage: 'unknown', owner: 'engineering_review' as const };
}

async function main() {
  const selected = options();
  const sessionResponse = await fetch(`${selected.apiRoot}/auth/local-preview-session`, {
    method: 'POST', headers: { Origin: 'http://127.0.0.1:5177' }, signal: AbortSignal.timeout(10_000),
  });
  if (!sessionResponse.ok) throw new Error(`local_preview_session_${sessionResponse.status}`);
  const session = await sessionResponse.json() as JsonObject;
  if (!session.token) throw new Error('local_preview_session_token_missing');
  const read = async (route: string) => {
    const response = await fetch(`${selected.apiRoot}${route}`, {
      headers: { Authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => ({ error: 'non_json_response' })) as JsonObject;
    return { status: response.status, body };
  };

  const programsResponse = await read('/social-programs/');
  if (programsResponse.status !== 200) throw new Error(`program_list_${programsResponse.status}`);
  const programs = Array.isArray(programsResponse.body.items) ? programsResponse.body.items : [];
  const matchingPrograms = selected.programId
    ? programs.filter((program: JsonObject) => program.programId === selected.programId)
    : programs;
  const scopes: Array<{ program: JsonObject; pkg: JsonObject }> = [];
  for (const program of matchingPrograms) {
    const packagesResponse = await read(`/social-programs/${encodeURIComponent(program.programId)}/operating-packages`);
    if (packagesResponse.status !== 200) continue;
    const packages = Array.isArray(packagesResponse.body.items) ? packagesResponse.body.items : [];
    const matching = selected.packageId ? packages.filter((pkg: JsonObject) => pkg.packageId === selected.packageId) : packages;
    const versioned = selected.packageVersion === null ? matching : matching.filter((pkg: JsonObject) => pkg.version === selected.packageVersion);
    const pkg = versioned.sort((left: JsonObject, right: JsonObject) => Number(right.version) - Number(left.version))[0];
    if (pkg) scopes.push({ program, pkg });
  }

  if (!scopes.length) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      mode: 'read_only',
      result: 'scope_not_found',
      target: { programId: selected.programId, packageId: selected.packageId, packageVersion: selected.packageVersion },
      visibleProgramCount: programs.length,
      nextStop: {
        code: 'weekly_scope_not_found_in_current_workspace',
        stage: 'workspace_state',
        owner: 'product_runtime',
        action: '恢复或导入同一周包的耐久数据快照后再联调；不要新建平行周包。',
      },
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  const reports = [];
  for (const { program, pkg } of scopes) {
    const base = `/social-programs/${encodeURIComponent(program.programId)}/operating-packages/${encodeURIComponent(pkg.packageId)}`;
    const tasksResponse = await read(`${base}/execution-tasks?version=${pkg.version}`);
    const tasks = tasksResponse.status === 200 && Array.isArray(tasksResponse.body.items) ? tasksResponse.body.items : [];
    const evidenceResponse = await read(`${base}/producer-evidence?version=${pkg.version}`);
    const evidence = evidenceResponse.status === 200 && Array.isArray(evidenceResponse.body.items) ? evidenceResponse.body.items : [];
    const blockerCounts: Record<string, number> = {};
    for (const task of tasks) for (const blocker of taskBlockers(task)) blockerCounts[blocker] = (blockerCounts[blocker] || 0) + 1;
    reports.push({
      target: { tenantId: program.tenantId || null, programId: program.programId, packageId: pkg.packageId, packageVersion: pkg.version },
      packageStatus: pkg.status,
      taskCounts: statusCounts(tasks),
      taskTotal: tasks.length,
      blockerCounts,
      producerEvidence: { httpStatus: evidenceResponse.status, count: evidence.length },
      nextStop: nextStop(pkg, tasks),
    });
  }
  console.log(JSON.stringify({ schemaVersion: 1, mode: 'read_only', result: 'diagnosed', reports }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({
    schemaVersion: 1,
    mode: 'read_only',
    result: 'diagnostic_unavailable',
    error: error instanceof Error ? error.message : 'unknown_error',
  }, null, 2));
  process.exitCode = 3;
});

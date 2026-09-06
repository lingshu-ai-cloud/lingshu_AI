import assert from "node:assert/strict";
import fs from "node:fs";

const monitorSource = fs.readFileSync("src/components/AgentMonitorPage.tsx", "utf8");
const viewportSource = fs.readFileSync("src/components/AgentBrowserViewport.tsx", "utf8");
const browserSource = fs.readFileSync("server/digitalEmployees/browserSessions.ts", "utf8");
const cockpitSource = fs.readFileSync("src/components/DigitalEmployeePage.tsx", "utf8") + fs.readFileSync("src/components/DeliveryBoard.tsx", "utf8");
const appSource = fs.readFileSync("src/App.tsx", "utf8");
const layoutSource = fs.readFileSync("src/components/Layout.tsx", "utf8");
const libSource = fs.readFileSync("src/lib/digitalEmployees.ts", "utf8");

assert.match(appSource, /lazy\(\(\) => import\(['"]\.\/components\/AgentMonitorPage['"]\)\)/, "the monitor wall must be a separately loaded page");
assert.match(appSource, /page === ['"]agentMonitor['"][\s\S]{0,200}<AgentMonitorPage/, "the application must route to the independent monitor page");
assert.match(layoutSource, /page !== ['"]agentMonitor['"] && <motion\.aside/, "the independent monitor page must remove the ordinary sidebar");
assert.match(cockpitSource, /打开监控大屏/, "the execution center must expose the monitor wall entry");
assert.match(monitorSource, /digitalEmployeeApi\.overview\(\)/, "the monitor wall must use the real overview endpoint");
assert.match(monitorSource, /streamRunEvents\(/, "the monitor wall must subscribe to the persisted SSE stream");
assert.match(monitorSource, /while \(!disposed\)[\s\S]{0,1500}reconnecting/, "a dropped monitor stream must reconnect without inventing state");
assert.match(monitorSource, /setInterval\(\(\) => void load\(\), 15_000\)/, "task status must periodically reconcile with the canonical overview");
assert.match(monitorSource, /\(data\?\.tasks \|\| \[\]\)\.filter/, "monitor windows must be derived from persisted workflow tasks");
for (const label of ["全部现场", "内容 Agent", "客服 Agent", "实际鼠标操作与工作页面同步直播"]) {
  assert.match(monitorSource, new RegExp(label), `the monitor wall must expose ${label}`);
}
for (const label of ["全部状态", "仅执行中", "只看待处理", "实时已连接", "进入全屏", "放大查看", "实时操作轨迹"]) {
  assert.match(monitorSource, new RegExp(label), `the production monitor must expose ${label}`);
}
assert.match(monitorSource, /<AgentBrowserViewport/, "every window must use the actual task browser stream");
assert.match(viewportSource, /streamAgentBrowser/, "viewports must subscribe to browser frames");
assert.doesNotMatch(viewportSource, /MousePointer2|agentCursorPercent|animate-ping/, "the viewer must not synthesize or duplicate the captured browser cursor");
assert.doesNotMatch(browserSource, /setContent\(|browserWorkspaceHtml/, "the worker must not render a substitute task page");
assert.match(browserSource, /session\.page\.goto\(url\.href/, "the worker must navigate to the original application");
assert.match(browserSource, /button\.click\(/, "the worker must dispatch actual browser input");
assert.match(monitorSource, /buildTaskDeepLink\(task, planTask, runId \|\| task\.run_id\)/, "every monitor window must retain the real business deep link");
assert.match(monitorSource, /dispatchDigitalEmployeeDeepLink\(\{ \.\.\.link, \.\.\.target\.link \}\)/, "the monitor work-page control must execute the deep link");
assert.match(monitorSource, /当前没有可监控的真实任务/, "an empty account must disclose that no monitorable tasks exist");
assert.match(monitorSource, /任务等待或暂停时，鼠标也会停下来/, "idle tasks must not be advertised as ongoing clicks");
assert.doesNotMatch(monitorSource, /setInterval[\s\S]{0,300}(?:cursor|mouse)|Math\.random\(\)/, "the monitor must never animate a fabricated cursor");
assert.match(libSource, /export function agentUiActionFromEvent/, "UI telemetry parsing must be shared between live view and monitor wall");

console.log("AgentMonitorPage contract tests passed");

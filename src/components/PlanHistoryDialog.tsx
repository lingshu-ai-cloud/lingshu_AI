import { useEffect, useMemo, useState } from "react";
import { Alert, Drawer, Segmented, Table, Tag } from "antd";
import { LsGradientProgress } from "./ui/LsExperiencePrimitives";
import { digitalEmployeeApi, type DigitalEmployeeOverview, type WeeklyGoal } from "../lib/digitalEmployees";

type Period = "week" | "month";
function completion(item: DigitalEmployeeOverview) {
  const total = item.tasks.length;
  const completed = item.tasks.filter(task => ["succeeded", "completed", "skipped"].includes(task.status)).length;
  return { total, completed, rate: total ? Math.round(completed / total * 100) : item.goal?.status === "completed" ? 100 : 0 };
}
function planCost(item: DigitalEmployeeOverview) {
  const plans = item.plan?.businessPackage?.tasks.find(task => task.templateId === "production")?.videoPlans || item.goal?.videoPlans || [];
  return plans.reduce((sum, plan) => sum + Number(plan.estimatedCost || 0), 0) || Number(item.plan?.estimatedCost || 0);
}
export default function PlanHistoryDialog({ goals, onClose }: { goals: WeeklyGoal[]; onClose: () => void }) {
  const [period, setPeriod] = useState<Period>("week");
  const [items, setItems] = useState<DigitalEmployeeOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.allSettled(goals.slice(0, 36).map(goal => digitalEmployeeApi.overview(goal.id))).then(results => {
      if (!active) return;
      setItems(results.flatMap(result => result.status === "fulfilled" && result.value.goal ? [result.value] : []).sort((left, right) => String(right.goal?.startsAt || "").localeCompare(String(left.goal?.startsAt || ""))));
      if (results.some(result => result.status === "rejected")) setError("少量历史计划暂时无法读取，已展示其余计划。");
    }).catch(loadError => active && setError(loadError instanceof Error ? loadError.message : "历史计划读取失败")).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [goals]);
  const rows = useMemo(() => {
    if (period === "week") return items.map(item => ({
      id: item.goal!.id, title: item.goal!.title, range: `${item.goal!.startsAt} 至 ${item.goal!.endsAt}`,
      status: item.goal!.status, ...completion(item), cost: planCost(item),
    }));
    const months = new Map<string, DigitalEmployeeOverview[]>();
    for (const item of items) { const month = item.goal!.startsAt.slice(0, 7); months.set(month, [...(months.get(month) || []), item]); }
    return [...months].map(([month, plans]) => {
      const stats = plans.map(completion); const total = stats.reduce((sum, item) => sum + item.total, 0); const completed = stats.reduce((sum, item) => sum + item.completed, 0);
      return { id: month, title: month, range: `${plans.length} 期计划`, status: "", total, completed, rate: total ? Math.round(completed / total * 100) : 0, cost: plans.reduce((sum, item) => sum + planCost(item), 0) };
    });
  }, [items, period]);
  const statusLabels: Record<string, string> = { draft: "待确认", approved: "已确认", active: "执行中", completed: "已完成", cancelled: "已取消" };
  return <Drawer open title="历史计划" size={720} onClose={onClose}>
    <p className="mb-5 text-sm text-text-secondary">按周或按月查看已生成计划与实际任务完成度。最多读取最近 36 期计划。</p>
    <Segmented value={period} onChange={value => setPeriod(value as Period)} options={[{ value: "week", label: "按周查看" }, { value: "month", label: "按月查看" }]}/>
    {error && <Alert className="mt-4" type="warning" showIcon title={error}/>}
    <Table className="mt-5" rowKey="id" dataSource={rows} loading={loading} pagination={{ pageSize: 8, showSizeChanger: false }} columns={[
      { title: "计划", key: "title", render: (_, row) => <div><p className="font-medium">{row.title}</p><p className="mt-1 text-xs text-text-secondary">{row.range}</p>{row.status && <Tag>{statusLabels[row.status] || row.status}</Tag>}</div> },
      { title: "完成度", key: "progress", width: 140, render: (_, row) => <div><LsGradientProgress percent={row.rate} size="small"/><p className="text-xs text-text-secondary">{row.completed}/{row.total || "—"} 项</p></div> },
      { title: "计划成本", dataIndex: "cost", align: "right", responsive: ["md"], render: cost => cost > 0 ? `¥${cost.toFixed(2)}` : "待核算" },
    ]}/>
  </Drawer>;
}

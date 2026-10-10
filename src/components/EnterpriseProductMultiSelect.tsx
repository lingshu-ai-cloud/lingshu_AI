import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { authHeader } from '../lib/auth';

const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

type EnterpriseProductOption = {
  id: string;
  value: string;
  meta: string;
};

export const splitSelectedProducts = (value: string) =>
  [...new Set(value.split(/[、,，;；\n]/).map((item) => item.trim()).filter(Boolean))];

export default function EnterpriseProductMultiSelect({
  value,
  onChange,
  required,
  onOpenKnowledge,
}: {
  value: string;
  onChange: (value: string) => void;
  required: boolean;
  onOpenKnowledge: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<EnterpriseProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => splitSelectedProducts(value), [value]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/overseas/enterprise/profile", {
      headers: authHeader(),
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`企业知识库读取失败（${response.status}）`);
        return response.json() as Promise<{
          products?: {
            categories?: string;
            items?: Array<{ id?: string; sku?: string; name?: string; category?: string; attributes?: Record<string, unknown> }>;
          };
        }>;
      })
      .then((profile) => {
        if (cancelled) return;
        const items = Array.isArray(profile.products?.items) ? profile.products.items : [];
        const next = items
          .map((item, index) => {
            const name = String(item.name || "").trim();
            const sku = String(item.sku || item.attributes?.model || "").trim();
            const category = String(item.category || "").trim();
            return name
              ? { id: String(item.id || item.sku || `${name}-${index}`), value: name, meta: [sku, category].filter(Boolean).join(" · ") }
              : null;
          })
          .filter((item): item is EnterpriseProductOption => Boolean(item));
        setOptions(next);
        setLoadError("");
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "企业知识库读取失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const toggle = (product: string) => {
    const next = selected.includes(product)
      ? selected.filter((item) => item !== product)
      : [...selected, product];
    onChange(next.join("、"));
  };
  const filtered = options.filter((option) =>
    `${option.value} ${option.meta}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`${inputClass} flex min-h-[46px] items-center justify-between gap-3 text-left`}
      >
        <span className={selected.length ? "flex min-w-0 flex-1 flex-wrap gap-1.5" : "text-slate-400"}>
          {selected.length
            ? selected.map((product) => (
              <span key={product} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
                <span className="truncate">{product}</span>
                <span
                  role="button"
                  aria-label={`移除${product}`}
                  tabIndex={0}
                  onClick={(event) => { event.stopPropagation(); toggle(product); }}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); toggle(product); } }}
                  className="rounded p-0.5 hover:bg-emerald-100"
                ><X size={11} /></span>
              </span>
            ))
            : loading ? "正在读取企业知识库产品…" : required ? "从企业知识库选择重点产品（可多选）" : "选择重点产品（可多选）"}
        </span>
        <ChevronDown size={16} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2">
            <Search size={14} className="text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs outline-none" placeholder="搜索企业知识库产品或型号" />
          </label>
          <div role="listbox" aria-label="企业知识库产品" aria-multiselectable="true" className="mt-2 max-h-60 overflow-y-auto">
            {loading && <p className="px-3 py-5 text-center text-xs text-slate-400">正在读取产品…</p>}
            {!loading && loadError && <p className="px-3 py-3 text-xs text-red-600">{loadError}</p>}
            {!loading && !loadError && filtered.map((option) => {
              const checked = selected.includes(option.value);
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggle(option.value)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${checked ? "bg-emerald-50" : "hover:bg-slate-50"}`}
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>{checked && <Check size={11} />}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-slate-800">{option.value}</span>{option.meta && <span className="mt-0.5 block truncate text-[10px] text-slate-400">{option.meta}</span>}</span>
                </button>
              );
            })}
            {!loading && !loadError && !filtered.length && <div className="px-3 py-4 text-center"><p className="text-xs text-slate-500">{options.length ? "没有匹配的产品" : "企业知识库暂未录入产品"}</p><button type="button" onClick={onOpenKnowledge} className="mt-2 text-xs font-bold text-emerald-700">去企业知识库添加产品</button></div>}
          </div>
          {!!selected.length && <div className="mt-2 flex items-center justify-between border-t border-slate-100 px-2 pt-2"><span className="text-[10px] text-slate-400">已选择 {selected.length} 项</span><button type="button" onClick={() => onChange("")} className="text-[10px] font-bold text-slate-600">清空</button></div>}
        </div>
      )}
    </div>
  );
}

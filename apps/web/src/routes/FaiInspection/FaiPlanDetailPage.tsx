import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { faiInspectionApi, type FaiCharacteristic } from "../../api/faiInspection";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

const LIMIT_TYPES = ["plus_minus", "percent", "min_max", "attribute"] as const;
const CHAR_TYPES = ["Critical", "Major", "Minor"] as const;

const emptyChar = (): FaiCharacteristic => ({
  name: "", charType: "Major", limitType: "plus_minus", sortOrder: 0,
});

export function FaiPlanDetailPage() {
  const { id } = useParams();
  const isNew = id === "new";
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: plan, isLoading } = useQuery({
    queryKey: ["fai-inspection", "plan", id],
    queryFn: () => faiInspectionApi.plans.get(Number(id)),
    enabled: !isNew,
  });

  const [form, setForm] = useState<any>(null);
  const current = form ?? plan ?? {
    partNumber: "", partDescription: "", productFamily: "", supplierFactory: "",
    receivingLocation: "", riskClass: "Major", repeatIntervalMonths: 6,
    majorAql: "1.0", minorAql: "2.5", notes: "", status: "Draft", characteristics: [],
  };

  const set = (k: string, v: any) => setForm({ ...current, [k]: v });
  const setChar = (i: number, k: string, v: any) => {
    const chars = [...(current.characteristics ?? [])];
    chars[i] = { ...chars[i], [k]: v };
    set("characteristics", chars);
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = { ...current };
      delete body.id;
      return isNew
        ? faiInspectionApi.plans.create(body)
        : faiInspectionApi.plans.update(Number(id), body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fai-inspection", "plans"] });
      queryClient.invalidateQueries({ queryKey: ["fai-inspection", "plan", id] });
      setForm(null);
      setError(null);
    },
    onError: (err) => setError(extractErrorMessage(err, "Could not save the plan.")),
  });

  if (isLoading) return <div className="p-6">Loading…</div>;

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-4">
        {isNew ? "New AQL Plan" : `Plan ${current.partNumber} — rev ${current.revision}`}
      </h1>
      {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-4">{error}</div>}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <label className="block">Part number*
          <input value={current.partNumber} onChange={(e) => set("partNumber", e.target.value)} className="border rounded px-3 py-2 w-full mt-1" />
        </label>
        <label className="block">Part description
          <input value={current.partDescription ?? ""} onChange={(e) => set("partDescription", e.target.value)} className="border rounded px-3 py-2 w-full mt-1" />
        </label>
        <label className="block">Product family
          <input value={current.productFamily ?? ""} onChange={(e) => set("productFamily", e.target.value)} className="border rounded px-3 py-2 w-full mt-1" />
        </label>
        <label className="block">Supplier factory / location
          <input value={current.supplierFactory ?? ""} onChange={(e) => set("supplierFactory", e.target.value)} className="border rounded px-3 py-2 w-full mt-1" />
        </label>
        <label className="block">Receiving location
          <input value={current.receivingLocation ?? ""} onChange={(e) => set("receivingLocation", e.target.value)} className="border rounded px-3 py-2 w-full mt-1" />
        </label>
        <label className="block">Risk class
          <select value={current.riskClass} onChange={(e) => set("riskClass", e.target.value)} className="border rounded px-3 py-2 w-full mt-1">
            {CHAR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="block">Repeat interval (months)
          <input type="number" value={current.repeatIntervalMonths} onChange={(e) => set("repeatIntervalMonths", Number(e.target.value))} className="border rounded px-3 py-2 w-full mt-1" />
        </label>
        <label className="block">Status
          <select value={current.status} onChange={(e) => set("status", e.target.value)} className="border rounded px-3 py-2 w-full mt-1">
            {["Draft", "Active", "Obsolete"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="block">Major AQL
          <input value={current.majorAql} onChange={(e) => set("majorAql", e.target.value)} className="border rounded px-3 py-2 w-full mt-1" />
        </label>
        <label className="block">Minor AQL
          <input value={current.minorAql} onChange={(e) => set("minorAql", e.target.value)} className="border rounded px-3 py-2 w-full mt-1" />
        </label>
        <label className="block col-span-2">Notes
          <textarea value={current.notes ?? ""} onChange={(e) => set("notes", e.target.value)} className="border rounded px-3 py-2 w-full mt-1" rows={3} />
        </label>
      </div>

      <h2 className="text-lg font-semibold mb-2">Characteristics</h2>
      <table className="w-full border-collapse mb-4">
        <thead>
          <tr className="border-b text-left text-sm">
            <th className="p-2">Name</th><th className="p-2">Class</th><th className="p-2">Limit type</th>
            <th className="p-2">Nominal</th><th className="p-2">± Tol</th><th className="p-2">%</th>
            <th className="p-2">Min</th><th className="p-2">Max</th><th className="p-2">Unit</th><th className="p-2">Method</th><th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {(current.characteristics ?? []).map((c: FaiCharacteristic, i: number) => (
            <tr key={i} className="border-b">
              <td className="p-1"><input value={c.name} onChange={(e) => setChar(i, "name", e.target.value)} className="border rounded px-2 py-1 w-full" /></td>
              <td className="p-1"><select value={c.charType} onChange={(e) => setChar(i, "charType", e.target.value)} className="border rounded px-2 py-1">
                {CHAR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select></td>
              <td className="p-1"><select value={c.limitType} onChange={(e) => setChar(i, "limitType", e.target.value)} className="border rounded px-2 py-1">
                {LIMIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select></td>
              <td className="p-1"><input value={c.nominal ?? ""} onChange={(e) => setChar(i, "nominal", e.target.value)} className="border rounded px-2 py-1 w-20" /></td>
              <td className="p-1"><input value={c.tolerancePlus ?? ""} placeholder="+/-" onChange={(e) => { setChar(i, "tolerancePlus", e.target.value); setChar(i, "toleranceMinus", e.target.value); }} className="border rounded px-2 py-1 w-20" /></td>
              <td className="p-1"><input value={c.percent ?? ""} onChange={(e) => setChar(i, "percent", e.target.value)} className="border rounded px-2 py-1 w-16" /></td>
              <td className="p-1"><input value={c.specMin ?? ""} onChange={(e) => setChar(i, "specMin", e.target.value)} className="border rounded px-2 py-1 w-20" /></td>
              <td className="p-1"><input value={c.specMax ?? ""} onChange={(e) => setChar(i, "specMax", e.target.value)} className="border rounded px-2 py-1 w-20" /></td>
              <td className="p-1"><input value={c.unit ?? ""} onChange={(e) => setChar(i, "unit", e.target.value)} className="border rounded px-2 py-1 w-16" /></td>
              <td className="p-1"><input value={c.method ?? ""} onChange={(e) => setChar(i, "method", e.target.value)} className="border rounded px-2 py-1 w-24" /></td>
              <td className="p-1"><button onClick={() => set("characteristics", (current.characteristics ?? []).filter((_: any, j: number) => j !== i))} className="text-red-600">✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => set("characteristics", [...(current.characteristics ?? []), emptyChar()])} className="rounded border px-3 py-1 mb-6">
        + Add characteristic
      </button>

      <div className="flex gap-3">
        <button onClick={() => save.mutate()} disabled={save.isPending} className="rounded bg-primary text-primary-foreground px-4 py-2 hover:opacity-90 disabled:opacity-50">
          Save
        </button>
        <button onClick={() => setForm(null)} className="rounded border px-4 py-2">Cancel</button>
      </div>
      <p className="text-xs text-gray-500 mt-4">Plan revision changes only when characteristics change — never when an inspection is filled out.</p>
    </div>
  );
}

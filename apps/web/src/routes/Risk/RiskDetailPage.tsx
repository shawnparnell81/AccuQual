import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextField, SelectField } from "../../components/forms/Field";
import { OpenFormButton } from "../../components/forms/OpenFormButton";

interface RiskAssessment {
  id: number;
  title: string;
  processArea: string | null;
  status: string;
}

interface FmeaItem {
  id: number;
  failureMode: string;
  effect: string | null;
  cause: string | null;
  severity: number;
  occurrence: number;
  detection: number;
  rpn: string | null;
  recommendedAction: string | null;
}

const riskHooks = createResourceHooks<RiskAssessment>("risk");
const RATINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const emptyItem = { failureMode: "", effect: "", cause: "", severity: 1, occurrence: 1, detection: 1, recommendedAction: "" };

/**
 * Risk / FMEA detail: the quick structured line-item table (severity x
 * occurrence x detection = RPN, computed server-side on add) for fast entry,
 * plus the full AIAG-style FMEA document as a fillable, exportable form —
 * same "quick fields here, full document via Open Form" pattern as NCR/CAPA.
 */
export function RiskDetailPage() {
  const { id } = useParams();
  const riskId = Number(id);
  const { data: risk, isLoading } = riskHooks.useOne(riskId);
  const queryClient = useQueryClient();

  const { data: items = [] } = useQuery<FmeaItem[]>({
    queryKey: ["risk", riskId, "fmea"],
    queryFn: async () => (await apiClient.get(`/risk/${riskId}/fmea`)).data,
  });

  const [item, setItem] = useState(emptyItem);

  if (isLoading || !risk) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{risk.title}</h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge value={risk.status} />
            {risk.processArea && <span className="text-sm text-muted-foreground">{risk.processArea}</span>}
          </div>
        </div>
        <OpenFormButton formType="fmea" entityId={risk.id} title={`FMEA #${risk.id} Document`} label="FMEA Document" />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Failure Modes (Quick Entry)</h2>
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-3">Failure Mode</th>
                <th className="pb-2 pr-3">Effect</th>
                <th className="pb-2 pr-3">Cause</th>
                <th className="pb-2 pr-3">S</th>
                <th className="pb-2 pr-3">O</th>
                <th className="pb-2 pr-3">D</th>
                <th className="pb-2 pr-3">RPN</th>
                <th className="pb-2">Recommended Action</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-3 text-muted-foreground">
                    No failure modes logged yet.
                  </td>
                </tr>
              )}
              {items.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="py-2 pr-3">{i.failureMode}</td>
                  <td className="py-2 pr-3">{i.effect ?? "—"}</td>
                  <td className="py-2 pr-3">{i.cause ?? "—"}</td>
                  <td className="py-2 pr-3">{i.severity}</td>
                  <td className="py-2 pr-3">{i.occurrence}</td>
                  <td className="py-2 pr-3">{i.detection}</td>
                  <td className="py-2 pr-3 font-semibold">{i.rpn}</td>
                  <td className="py-2">{i.recommendedAction ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form
          className="grid gap-3 md:grid-cols-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await apiClient.post(`/risk/${riskId}/fmea`, item);
            setItem(emptyItem);
            queryClient.invalidateQueries({ queryKey: ["risk", riskId, "fmea"] });
          }}
        >
          <TextField label="Failure Mode" value={item.failureMode} onChange={(e) => setItem({ ...item, failureMode: e.target.value })} required />
          <TextField label="Effect" value={item.effect} onChange={(e) => setItem({ ...item, effect: e.target.value })} />
          <TextField label="Cause" value={item.cause} onChange={(e) => setItem({ ...item, cause: e.target.value })} />
          <TextField label="Recommended Action" value={item.recommendedAction} onChange={(e) => setItem({ ...item, recommendedAction: e.target.value })} />
          <SelectField label="Severity" value={String(item.severity)} onChange={(e) => setItem({ ...item, severity: Number(e.target.value) })}>
            {RATINGS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </SelectField>
          <SelectField label="Occurrence" value={String(item.occurrence)} onChange={(e) => setItem({ ...item, occurrence: Number(e.target.value) })}>
            {RATINGS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </SelectField>
          <SelectField label="Detection" value={String(item.detection)} onChange={(e) => setItem({ ...item, detection: Number(e.target.value) })}>
            {RATINGS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </SelectField>
          <button type="submit" className="w-fit self-end rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
            Add failure mode
          </button>
        </form>
      </div>
    </div>
  );
}

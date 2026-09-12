import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Audit } from "../../api/types";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextField, SelectField } from "../../components/forms/Field";
import { OpenFormButton } from "../../components/forms/OpenFormButton";

const auditHooks = createResourceHooks<Audit>("audits");

interface AuditItem {
  id: number;
  question: string;
  finding: string | null;
  severity: string | null;
  evidence: string | null;
}

export function AuditDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const auditId = Number(id);
  const { data: audit, isLoading } = auditHooks.useOne(auditId);
  const completeAction = auditHooks.useAction("complete");
  const queryClient = useQueryClient();

  const { data: items = [] } = useQuery<AuditItem[]>({
    queryKey: ["audits", auditId, "items"],
    queryFn: async () => (await apiClient.get(`/audits/${auditId}/item`)).data,
  });

  const [item, setItem] = useState({ question: "", finding: "", severity: "observation" });
  const [autoOpened, setAutoOpened] = useState<number | null>(null);

  if (isLoading || !audit) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{audit.name}</h1>
          <StatusBadge value={audit.status} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OpenFormButton formType="audit_plan" entityId={audit.id} title={`Audit #${audit.id} — Audit Plan`} label="Audit Plan" />
          <OpenFormButton formType="audit_checklist" entityId={audit.id} title={`Audit #${audit.id} — Audit Checklist`} label="Audit Checklist" />
          <OpenFormButton formType="lpa" entityId={audit.id} title={`Audit #${audit.id} — Layered Process Audit`} label="Layered Process Audit" />
          {audit.status !== "completed" && (
            <button onClick={() => completeAction.mutate({ id: auditId })} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Mark completed
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Audit Items</h2>
        <ul className="mb-4 flex flex-col gap-2 text-sm">
          {items.length === 0 && <li className="text-muted-foreground">No items yet.</li>}
          {items.map((i) => (
            <li key={i.id} className="border-b border-border pb-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{i.question}</span>
                <StatusBadge value={i.severity} />
              </div>
              {i.finding && <p className="mt-1 text-muted-foreground">{i.finding}</p>}
            </li>
          ))}
        </ul>

        {autoOpened !== null && (
          <div className="mb-3 flex items-center justify-between rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
            <span>Nonconformance logged — Discrepancy Investigation #{autoOpened} was opened automatically.</span>
            <button onClick={() => navigate(`/quality/${autoOpened}`)} className="font-medium hover:underline">
              View investigation
            </button>
          </div>
        )}

        <form
          className="grid gap-3 md:grid-cols-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const { data: created } = await apiClient.post(`/audits/${auditId}/item`, item);
            setItem({ question: "", finding: "", severity: "observation" });
            setAutoOpened(created.discrepancyInvestigation?.id ?? null);
            queryClient.invalidateQueries({ queryKey: ["audits", auditId, "items"] });
          }}
        >
          <TextField label="Question" value={item.question} onChange={(e) => setItem({ ...item, question: e.target.value })} required />
          <TextField label="Finding" value={item.finding} onChange={(e) => setItem({ ...item, finding: e.target.value })} />
          <SelectField label="Severity" value={item.severity} onChange={(e) => setItem({ ...item, severity: e.target.value })}>
            {["observation", "minor", "major", "critical"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectField>
          <button type="submit" className="col-span-full w-fit rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
            Add item
          </button>
        </form>
      </div>
    </div>
  );
}

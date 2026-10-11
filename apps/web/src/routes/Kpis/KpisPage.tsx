import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { apiClient } from "../../api/client";
import { PageHeader } from "../../components/layout/PageHeader";
import { Modal } from "../../components/modals/Modal";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { useToast } from "../../components/shared/ToastProvider";
import { ExecutiveDrillPanel, type DrillListRow } from "../../components/executive/ExecutiveDrillPanel";
import { KpiCatalog, PlantToggle, usePlantChoice } from "../../components/kpis/KpiBoards";
import { UpdatedStamp } from "../../components/kpis/UpdatedStamp";
import { KPI_QUERY_KEY, useKpis } from "../../hooks/useKpis";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { downloadKpiWorkbook } from "../../lib/kpiExport";
import { formatKpiValue, objectiveReading, objectiveVisible, summaryFor, type KpiMetric, type KpiObjective, type KpiPayload, type PlantView } from "../../lib/kpiView";

const TONE: Record<KpiObjective["readings"]["all"]["status"], string> = {
  green: "text-emerald-600",
  amber: "text-amber-600",
  red: "text-red-600",
  none: "text-muted-foreground",
};

const STATUS_LABEL: Record<KpiObjective["readings"]["all"]["status"], string> = {
  green: "On target",
  amber: "Near target",
  red: "Off target",
  none: "No reading",
};

interface ObjectiveDraft {
  id?: string;
  name: string;
  metric: string;
  plantScope: "greer" | "wellman" | "all";
  target: string;
  direction: "higher" | "lower";
  amberThreshold: string;
  ownerId: string;
  reviewFrequency: "monthly" | "quarterly";
  active: boolean;
  notes: string;
}

interface DrillState {
  title: string;
  detail: string | null;
  total: number;
  rows: DrillListRow[];
  note: string | null;
  denied: string | null;
}

function blankDraft(metric: KpiMetric | undefined): ObjectiveDraft {
  return {
    name: "",
    metric: metric?.id ?? "capa_on_time",
    plantScope: "all",
    target: "",
    direction: metric?.direction ?? "higher",
    amberThreshold: "",
    ownerId: "",
    reviewFrequency: "monthly",
    active: true,
    notes: "",
  };
}

function draftFrom(objective: KpiObjective): ObjectiveDraft {
  return {
    id: objective.id,
    name: objective.name,
    metric: objective.metric,
    plantScope: objective.plantScope,
    target: String(objective.target),
    direction: objective.direction,
    amberThreshold: String(objective.amberThreshold),
    ownerId: objective.ownerId == null ? "" : String(objective.ownerId),
    reviewFrequency: objective.reviewFrequency,
    active: objective.active,
    notes: objective.notes,
  };
}

function bodyFrom(draft: ObjectiveDraft) {
  return {
    name: draft.name.trim(),
    metric: draft.metric,
    plantScope: draft.plantScope,
    target: Number(draft.target),
    direction: draft.direction,
    amberThreshold: Number(draft.amberThreshold),
    ownerId: draft.ownerId === "" ? null : Number(draft.ownerId),
    reviewFrequency: draft.reviewFrequency,
    active: draft.active,
    notes: draft.notes.trim(),
  };
}

export function KpisPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { query } = useKpis();
  const data = query.data;
  const [plant, setPlant] = usePlantChoice(data?.plants);
  const [draft, setDraft] = useState<ObjectiveDraft | null>(null);
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [exporting, setExporting] = useState(false);

  const save = useMutation({
    mutationFn: async (next: ObjectiveDraft) => {
      const body = bodyFrom(next);
      if (next.id) return (await apiClient.patch(`/kpis/objectives/${next.id}`, body)).data;
      return (await apiClient.post("/kpis/objectives", body)).data;
    },
    onSuccess: async () => {
      setDraft(null);
      await qc.invalidateQueries({ queryKey: KPI_QUERY_KEY });
      toast.success("Objective saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save that objective.")),
  });

  const deactivate = useMutation({
    mutationFn: async (id: string) => (await apiClient.post(`/kpis/objectives/${id}/deactivate`)).data,
    onSuccess: async () => {
      setDraft(null);
      await qc.invalidateQueries({ queryKey: KPI_QUERY_KEY });
      toast.success("Objective deactivated.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't deactivate that objective.")),
  });

  async function openRecords(metricId: string, month: string, scope: PlantView, title?: string) {
    try {
      const payload = (
        await apiClient.get<{ title: string; siteName: string; total: number; note: string | null; rows: DrillListRow[] }>("/kpis/records", {
          params: { metric: metricId, month, siteId: scope === "all" ? "all" : String(scope) },
        })
      ).data;
      setDrill({
        title: title ?? payload.title,
        detail: payload.siteName,
        total: payload.total,
        rows: payload.rows,
        note: payload.note,
        denied: null,
      });
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't open those records."));
    }
  }

  if (query.isLoading) return <LoadingPlaceholder />;
  if (query.isError && axios.isAxiosError(query.error) && query.error.response?.status === 403) {
    return <p className="rounded-lg border border-border bg-card p-4 text-sm">You don't have access to quality objectives.</p>;
  }
  if (query.isError || !data) return <p className="text-sm text-destructive">Couldn't load quality objectives.</p>;

  const visible = data.objectives.filter((objective) => objectiveVisible(objective, plant, data.plants));
  const summary = summaryFor(data.objectives, plant, data.plants);
  const inactive = data.objectives.filter((objective) => !objective.active);

  return (
    <div className="flex flex-col gap-6 pb-10">
      <PageHeader
        crumbs={[{ label: "Reports", to: "/reporting" }, { label: "Quality Objectives & KPIs" }]}
        title="Quality Objectives & KPIs"
        description={
          <div className="flex flex-col gap-1">
            <span>Twelve months, live from the records. A dashed line is the target when an objective uses that KPI.</span>
            <UpdatedStamp at={data.computedAt} />
          </div>
        }
        actions={
          <div className="no-print flex flex-wrap gap-2">
            {data.canEdit && (
              <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground" onClick={() => setDraft(blankDraft(data.metrics[0]))}>
                Add objective
              </button>
            )}
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-sm"
              disabled={exporting}
              onClick={() => {
                setExporting(true);
                void downloadKpiWorkbook(data, plant).finally(() => setExporting(false));
              }}
            >
              {exporting ? "Exporting…" : "Export to Excel"}
            </button>
          </div>
        }
      />

      <PlantToggle plant={plant} plants={data.plants} onChange={setPlant} />

      <section className="rounded-lg border border-border bg-card p-4">
        <p className="text-lg font-semibold text-foreground">
          {summary.onTarget} of {summary.active} on target
        </p>
        <p className="text-sm text-muted-foreground">Green is on target for the plant on this page. Amber and red are not. A blank reading is not counted as on target.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">Objectives</h2>
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active objective for this plant.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {visible.map((objective) => (
              <ObjectiveCard
                key={objective.id}
                objective={objective}
                metric={data.metrics.find((item) => item.id === objective.metric)}
                plant={plant}
                plants={data.plants}
                canEdit={data.canEdit}
                onOpen={() => {
                  const month = objective.reviewFrequency === "quarterly" ? "quarter" : objective.periodLabel;
                  void openRecords(objective.metric, month, plant, objective.name);
                }}
                onEdit={() => setDraft(draftFrom(objective))}
              />
            ))}
          </div>
        )}
        {data.canEdit && inactive.length > 0 && (
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Inactive</p>
            <ul className="mt-1 flex flex-col gap-1">
              {inactive.map((objective) => (
                <li key={objective.id} className="flex items-center justify-between gap-2">
                  <span>{objective.name}</span>
                  <button type="button" className="no-print rounded-md border border-border px-2 py-1 text-xs" onClick={() => setDraft(draftFrom(objective))}>
                    Edit
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <KpiCatalog data={data} plant={plant} onOpen={(metricId, month) => void openRecords(metricId, month, plant)} />

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-foreground">How these numbers are counted</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Area</th>
              <th className="py-2 pr-3 font-medium">KPI</th>
              <th className="py-2 font-medium">Definition</th>
            </tr>
          </thead>
          <tbody>
            {data.metrics.map((metric) => (
              <tr key={metric.id} className="border-b border-border align-top">
                <td className="py-2 pr-3 text-muted-foreground">{metric.area}</td>
                <td className="py-2 pr-3 font-medium">{metric.label}</td>
                <td className="py-2 text-muted-foreground">{metric.definition}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">First pass yield, true PPM, and cost of quality need production data (future import).</p>
      </section>

      {draft && (
        <ObjectiveEditor
          draft={draft}
          metrics={data.metrics}
          people={data.people}
          pending={save.isPending || deactivate.isPending}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={() => save.mutate(draft)}
          onDeactivate={draft.id ? () => deactivate.mutate(draft.id!) : undefined}
        />
      )}

      {drill && (
        <ExecutiveDrillPanel
          title={drill.title}
          detail={drill.detail}
          total={drill.total}
          rows={drill.rows}
          note={drill.note}
          denied={drill.denied}
          onClose={() => setDrill(null)}
          onDenied={(message) => setDrill({ ...drill, denied: message })}
        />
      )}
    </div>
  );
}

function ObjectiveCard({
  objective,
  metric,
  plant,
  plants,
  canEdit,
  onOpen,
  onEdit,
}: {
  objective: KpiObjective;
  metric: KpiMetric | undefined;
  plant: PlantView;
  plants: KpiPayload["plants"];
  canEdit: boolean;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const reading = objectiveReading(objective, plant, plants);
  const unit = metric?.unit ?? "count";
  const updated = new Date(objective.updatedAt);
  const updatedLabel = Number.isNaN(updated.getTime())
    ? ""
    : updated.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });
  return (
    <article className="flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-card p-4" onClick={onOpen}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{objective.name}</h3>
          <p className={`text-xs font-medium ${TONE[reading.status]}`}>{STATUS_LABEL[reading.status]}</p>
        </div>
        {canEdit && (
          <button
            type="button"
            className="no-print rounded-md border border-border px-2 py-1 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
          >
            Edit
          </button>
        )}
      </div>
      <p className="text-2xl font-semibold text-foreground">{formatKpiValue(unit, reading.actual)}</p>
      <p className="text-xs text-muted-foreground">
        Target {formatKpiValue(unit, objective.target)}
        {reading.percentOfTarget != null ? ` · ${reading.percentOfTarget}% of target` : ""}
        {` · ${objective.reviewFrequency} · ${objective.periodLabel}`}
      </p>
      <p className="text-xs text-muted-foreground">
        {objective.ownerName ? `Owner ${objective.ownerName}` : "No owner"}
        {updatedLabel ? ` · Updated ${updatedLabel}` : ""}
        {objective.plantScope !== "all" ? ` · ${objective.plantScope}` : ""}
      </p>
        {objective.notes && <p className="text-xs text-muted-foreground">{objective.notes}</p>}
        <button
          type="button"
          className="no-print self-start text-xs font-medium text-primary hover:underline"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          View records
        </button>
      </article>
  );
}

function ObjectiveEditor({
  draft,
  metrics,
  people,
  pending,
  onChange,
  onClose,
  onSave,
  onDeactivate,
}: {
  draft: ObjectiveDraft;
  metrics: KpiMetric[];
  people: { id: number; name: string }[];
  pending: boolean;
  onChange: (next: ObjectiveDraft) => void;
  onClose: () => void;
  onSave: () => void;
  onDeactivate?: () => void;
}) {
  const field = "flex flex-col gap-1 text-sm text-foreground";
  const input = "rounded-md border border-border bg-background px-2 py-1 text-sm";
  return (
    <Modal title={draft.id ? "Edit objective" : "Add objective"} isOpen onClose={onClose} wide>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <label className={field}>
          Name
          <input className={input} value={draft.name} required maxLength={120} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
        </label>
        <label className={field}>
          Metric
          <select
            className={input}
            value={draft.metric}
            onChange={(event) => {
              const metric = metrics.find((item) => item.id === event.target.value);
              onChange({ ...draft, metric: event.target.value, direction: metric?.direction ?? draft.direction });
            }}
          >
            {metrics.map((metric) => (
              <option key={metric.id} value={metric.id}>
                {metric.area} — {metric.label}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          Plant
          <select className={input} value={draft.plantScope} onChange={(event) => onChange({ ...draft, plantScope: event.target.value as ObjectiveDraft["plantScope"] })}>
            <option value="all">All</option>
            <option value="greer">Greer</option>
            <option value="wellman">Wellman</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={field}>
            Target
            <input className={input} inputMode="decimal" required value={draft.target} onChange={(event) => onChange({ ...draft, target: event.target.value })} />
          </label>
          <label className={field}>
            Amber threshold
            <input className={input} inputMode="decimal" required value={draft.amberThreshold} onChange={(event) => onChange({ ...draft, amberThreshold: event.target.value })} />
          </label>
        </div>
        <label className={field}>
          Direction
          <select className={input} value={draft.direction} onChange={(event) => onChange({ ...draft, direction: event.target.value as ObjectiveDraft["direction"] })}>
            <option value="higher">Higher is better</option>
            <option value="lower">Lower is better</option>
          </select>
        </label>
        <label className={field}>
          Owner
          <select className={input} value={draft.ownerId} onChange={(event) => onChange({ ...draft, ownerId: event.target.value })}>
            <option value="">No owner</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          Review
          <select className={input} value={draft.reviewFrequency} onChange={(event) => onChange({ ...draft, reviewFrequency: event.target.value as ObjectiveDraft["reviewFrequency"] })}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.active} onChange={(event) => onChange({ ...draft, active: event.target.checked })} />
          Active
        </label>
        <label className={field}>
          Notes
          <textarea className={input} rows={3} maxLength={2000} value={draft.notes} onChange={(event) => onChange({ ...draft, notes: event.target.value })} />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          {onDeactivate && draft.active && (
            <button type="button" className="mr-auto rounded-md border border-border px-3 py-1.5 text-sm text-destructive" disabled={pending} onClick={onDeactivate}>
              Deactivate
            </button>
          )}
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

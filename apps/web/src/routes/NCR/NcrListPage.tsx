import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { createResourceHooks } from "../../api/resourceHooks";
import type { Ncr } from "../../api/types";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { Modal } from "../../components/modals/Modal";
import { TextField, TextAreaField, SelectField } from "../../components/forms/Field";
import { AiFieldAssistant } from "../../components/shared/AiFieldAssistant";
import { AiStructuredSuggestion } from "../../components/shared/AiStructuredSuggestion";
import { DetailsDisclosure } from "../../components/forms/DetailsDisclosure";
import { formatDate } from "../../lib/dates";
import { duePhrase, statusPhrase } from "../../lib/opsLanguage";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { usePlantWrite } from "../../hooks/usePlantWrite";
import { CurrentPlantNote } from "../../components/layout/CurrentPlantNote";
import { usePersonDirectory } from "../../hooks/usePersonDirectory";
import { PendingFilesField } from "../../components/shared/PendingFilesField";
import { SegmentedTabs } from "../../components/dashboard/kit";
import { uploadPendingAttachments } from "../../lib/attachments";
import { NcrBoard } from "./NcrBoard";

const NCR_STATUSES = ["open", "contained", "investigating", "corrective_action", "closed"] as const;

const ncrHooks = createResourceHooks<Ncr>("ncr");

interface NcrTriageSuggestion {
  suggestedSeverity: "low" | "medium" | "high" | "critical";
  suggestedDepartment: string;
  rationale: string;
  similarPastNcrs: string[];
}

/** NCR List: filters (severity, status, date range), export, quick-create. */
export function NcrListPage() {
  const { canEdit, reason } = usePlantWrite("ncr");
  const { label, people } = usePersonDirectory();
  const [severityFilter, setSeverityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [params, setParams] = useSearchParams();
  const view: "list" | "board" = params.get("view") === "board" ? "board" : "list";
  const [form, setForm] = useState<{ title: string; description: string; severity: Ncr["severity"]; dueDate: string; assignedTo: string }>({
    title: "",
    description: "",
    severity: "medium",
    dueDate: "",
    assignedTo: "",
  });

  const { data: ncrs = [], isLoading, isError } = ncrHooks.useList();
  const createNcr = ncrHooks.useCreate();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  // Bulk actions pilot (see crudFactory.ts's bulkUpdate) — status change only, on the pilot module. Each affected NCR
  // still gets its own real audit-trail entry server-side; this is just the selection + one-call UI over that.
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const bulkStatusChange = useMutation({
    mutationFn: async (status: Ncr["status"]) => apiClient.patch("/ncr/bulk", { ids: [...selectedIds], patch: { status } }),
    onSuccess: (_data, status) => {
      qc.invalidateQueries({ queryKey: ["ncr"] });
      toast.success(`${selectedIds.size} NCR${selectedIds.size === 1 ? "" : "s"} set to ${status.replace("_", " ")}.`);
      setSelectedIds(new Set());
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update all of the selected NCRs — none were changed.")),
  });

  const filtered = useMemo(
    () =>
      ncrs.filter(
        (n) => (!severityFilter || n.severity === severityFilter) && (!statusFilter || n.status === statusFilter)
      ),
    [ncrs, severityFilter, statusFilter]
  );

  const columns: Column<Ncr>[] = [
    { header: "ID", accessor: (n) => `#${n.id}` },
    { header: "What happened", accessor: (n) => n.title },
    { header: "State", accessor: (n) => <StatusBadge value={n.status} label={statusPhrase(n.status)} /> },
    { header: "Owner", accessor: (n) => label(n.assignedTo) },
    { header: "Due", accessor: (n) => duePhrase(n.dueDate, n.status === "closed") },
    { header: "Severity", accessor: (n) => <StatusBadge value={n.severity} /> },
    { header: "Opened", accessor: (n) => formatDate(n.createdAt) },
  ];

  function exportCsv() {
    const rows = filtered.map((n) => `${n.id},${n.title},${n.severity},${n.status}`).join("\n");
    const blob = new Blob([`id,title,severity,status\n${rows}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ncr-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Issues</h1>
          <p className="text-sm text-muted-foreground">Nonconformances (NCR). Log what went wrong, then contain it.</p>
          <CurrentPlantNote />
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Export CSV
          </button>
          {canEdit && (
            <button
              onClick={() => setCreateOpen(true)}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              Log an issue
            </button>
          )}
        </div>
      </div>
      {reason && <p className="text-sm text-muted-foreground">{reason}</p>}

      <SegmentedTabs
        tabs={[
          { key: "list", label: "List" },
          { key: "board", label: "Board" },
        ]}
        value={view}
        onChange={(key) => setParams(key === "list" ? {} : { view: key }, { replace: true })}
      />

      <div className="flex gap-3">
        <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} className="rounded-md border border-border px-3 py-2 text-sm">
          <option value="">All severities</option>
          {["low", "medium", "high", "critical"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {view === "list" && (
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-border px-3 py-2 text-sm">
          <option value="">All states</option>
          {["open", "contained", "investigating", "corrective_action", "closed"].map((s) => (
            <option key={s} value={s}>
              {statusPhrase(s)}
            </option>
          ))}
        </select>
        )}
      </div>

      {view === "board" ? (
        <>
          <p className="text-xs text-muted-foreground">Drag an issue to the next column to move it forward. Each step asks for what it needs first.</p>
          <NcrBoard ncrs={isLoading ? [] : ncrs.filter((n) => !severityFilter || n.severity === severityFilter)} canEdit={canEdit} />
        </>
      ) : (
      <>
      {canEdit && selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <span className="text-sm text-muted-foreground">Set status:</span>
          {NCR_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => bulkStatusChange.mutate(s)}
              disabled={bulkStatusChange.isPending}
              className="rounded-md border border-border px-2 py-1 text-xs capitalize hover:bg-muted disabled:opacity-60"
            >
              {s.replace("_", " ")}
            </button>
          ))}
          <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-xs text-muted-foreground hover:underline">
            Clear selection
          </button>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(n) => n.id}
        isLoading={isLoading}
        isError={isError}
        errorMessage="Couldn't load issues. Refresh the page. If it keeps failing, your access to nonconformances may have changed."
        emptyMessage="No issues yet. Log one when a part, lot, or process isn't right."
        onRowClick={(n) => navigate(`/ncr/${n.id}`)}
        selectedIds={canEdit ? selectedIds : undefined}
        onSelectionChange={canEdit ? setSelectedIds : undefined}
      />
      </>
      )}

      <Modal title="Log an issue" isOpen={createOpen} onClose={() => { setCreateOpen(false); setPendingFiles([]); }}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            createNcr.mutate(
              {
                title: form.title,
                description: form.description || undefined,
                severity: form.severity,
                dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
                assignedTo: form.assignedTo ? Number(form.assignedTo) : undefined,
              },
              {
              onSuccess: async (created) => {
                const files = pendingFiles;
                setPendingFiles([]);
                setCreateOpen(false);
                if (files.length > 0) {
                  const result = await uploadPendingAttachments("ncr", created.id, files);
                  if (result.failed.length > 0) toast.error(`Issue logged, but these files didn't attach: ${result.failed.join(", ")}. Add them on the issue page.`);
                }
                navigate(`/ncr/${created.id}`);
              },
              onError: (err) => toast.error(extractErrorMessage(err, "Couldn't log this issue. Check the title and try again.")),
              },
            );
          }}
        >
          <TextField label="What happened" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="Short description of the problem" />
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Details</span>
              <AiFieldAssistant
                module="ncr"
                buildInitialPrompt={() =>
                  `Draft an NCR write-up${form.title ? ` for "${form.title}"` : ""}. Include a clear problem description, what evidence` +
                  " supports it, a suspected cause, and a recommended containment action. Keep it factual and concise — this is a draft" +
                  " for a quality engineer to review and edit, not a final record."
                }
                onInsert={(text) => setForm({ ...form, description: text })}
                insertLabel="Insert as Description"
              />
            </div>
            <TextAreaField label="" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Part, lot, and what you saw." />
          </div>
          <DetailsDisclosure>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Severity</span>
              <AiStructuredSuggestion<NcrTriageSuggestion>
                endpoint="/ai/ncr-triage"
                title="AI Triage Suggestion"
                triggerLabel="Suggest Severity"
                acceptLabel="Apply Suggested Severity"
                buildPayload={() => ({ input: { title: form.title, description: form.description } })}
                onAccept={(output) => setForm((f) => ({ ...f, severity: output.suggestedSeverity }))}
                renderPreview={(output) => (
                  <div className="flex flex-col gap-3 text-sm">
                    <p>
                      Suggested severity: <strong className="capitalize">{output.suggestedSeverity}</strong> — route to{" "}
                      <strong>{output.suggestedDepartment}</strong>
                    </p>
                    <p className="text-muted-foreground">{output.rationale}</p>
                    {output.similarPastNcrs.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Similar past NCRs</p>
                        <ul className="list-inside list-disc text-xs text-muted-foreground">
                          {output.similarPastNcrs.map((n, i) => (
                            <li key={i}>{n}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              />
            </div>
            <SelectField label="" value={form.severity ?? "medium"} onChange={(e) => setForm({ ...form, severity: e.target.value as Ncr["severity"] })}>
              {["low", "medium", "high", "critical"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectField>
          </div>
          <TextField label="Due date" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          {people.length > 0 && (
            <SelectField label="Owner" value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}>
              <option value="">Unassigned</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name?.trim() || person.email}
                </option>
              ))}
            </SelectField>
          )}
          </DetailsDisclosure>
          <PendingFilesField files={pendingFiles} onChange={setPendingFiles} />
          <button type="submit" className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground">
            Log issue
          </button>
        </form>
      </Modal>
    </div>
  );
}

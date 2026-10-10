import { useEffect, useMemo, useState } from "react";
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
import { duePhrase, formatPerson, ncrStepKey, ncrStepLabel, peopleForAssignment } from "../../lib/opsLanguage";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { usePlantWrite } from "../../hooks/usePlantWrite";
import { CurrentPlantNote } from "../../components/layout/CurrentPlantNote";
import { FilterBar, PageHeader, SummaryCards } from "../../components/layout/PageHeader";
import { usePersonDirectory } from "../../hooks/usePersonDirectory";
import { PendingFilesField } from "../../components/shared/PendingFilesField";
import { SegmentedTabs } from "../../components/dashboard/kit";
import { uploadPendingAttachments } from "../../lib/attachments";
import { NcrBoard } from "./NcrBoard";
import { QuarantineDraftFields, saveDraftQuarantineItems } from "./NcrQuarantineSection";
import { RecordNumberField, duplicateNumberError } from "../../components/forms/RecordNumberField";
import { showRecordNumber } from "../../lib/userRecordNumber";

const NCR_STATUSES = ["ncr_created", "contain", "disposition", "fix", "verify", "closed"] as const;

function ncrClassification(n: Ncr): "Minor" | "Major" | "Critical" | null {
  if (n.classification === "Minor" || n.classification === "Major" || n.classification === "Critical") return n.classification;
  if (n.severity === "low") return "Minor";
  if (n.severity === "medium" || n.severity === "high") return "Major";
  if (n.severity === "critical") return "Critical";
  return null;
}

/** Filter bucket for a row whose classification was set on the form and whose severity column is still empty. */
function listedSeverity(n: Ncr): string | null {
  if (n.severity) return n.severity;
  const classification = ncrClassification(n);
  if (classification === "Minor") return "low";
  if (classification === "Major") return "high";
  if (classification === "Critical") return "critical";
  return null;
}

function whatHappenedText(n: Ncr): string {
  const happened = n.whatHappened?.trim();
  if (happened) return happened;
  const description = n.description?.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return description || n.title;
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

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
  const accessPending = !canEdit && reason == null;
  const { label, people } = usePersonDirectory();
  const [severityFilter, setSeverityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [textFilter, setTextFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (accessPending || params.get("new") !== "1") return;
    if (canEdit) setCreateOpen(true);
    const next = new URLSearchParams(params);
    next.delete("new");
    setParams(next, { replace: true });
  }, [accessPending, canEdit, params, setParams]);
  const view: "list" | "board" = params.get("view") === "board" ? "board" : "list";
  const [form, setForm] = useState<{ title: string; description: string; severity: Ncr["severity"]; dueDate: string; assignedTo: string; recordNumber: string }>({
    title: "",
    description: "",
    severity: "medium",
    dueDate: "",
    assignedTo: "",
    recordNumber: "",
  });
  const [numberError, setNumberError] = useState<string | null>(null);
  const [quarantineRows, setQuarantineRows] = useState([{ partNumber: "", quantity: "", serialNumber: "" }]);

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
      toast.success(`${selectedIds.size} NCR${selectedIds.size === 1 ? "" : "s"} set to ${ncrStepLabel(status)}.`);
      setSelectedIds(new Set());
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update all of the selected NCRs — none were changed.")),
  });

  const filtered = useMemo(() => {
    const needle = textFilter.trim().toLowerCase();
    return ncrs.filter((n) => {
      if (severityFilter && listedSeverity(n) !== severityFilter) return false;
      if (statusFilter && ncrStepKey(n.status) !== statusFilter) return false;
      if (!needle) return true;
      return `${showRecordNumber(n.recordNumber)} ${whatHappenedText(n)} ${ncrStepLabel(n.status)}`.toLowerCase().includes(needle);
    });
  }, [ncrs, severityFilter, statusFilter, textFilter]);
  const openCount = ncrs.filter((n) => ncrStepKey(n.status) !== "closed").length;
  const severeCount = ncrs.filter((n) => {
    const severity = listedSeverity(n);
    return severity === "high" || severity === "critical";
  }).length;
  const overdueCount = ncrs.filter((n) => {
    if (ncrStepKey(n.status) === "closed" || !n.dueDate) return false;
    const due = new Date(n.dueDate);
    return !Number.isNaN(due.getTime()) && due.getTime() < Date.now();
  }).length;

  const columns: Column<Ncr>[] = [
    { header: "NCR No.", accessor: (n) => showRecordNumber(n.recordNumber) || "" },
    { header: "What happened", accessor: (n) => whatHappenedText(n) },
    { header: "State", accessor: (n) => <StatusBadge value={ncrStepKey(n.status)} label={n.workflow?.currentStep ?? ncrStepLabel(n.status)} /> },
    { header: "Owner", accessor: (n) => label(n.assignedTo) },
    { header: "Due", accessor: (n) => duePhrase(n.dueDate, ncrStepKey(n.status) === "closed") },
    { header: "Severity", accessor: (n) => {
      const classification = ncrClassification(n);
      return classification ? <StatusBadge value={classification.toLowerCase()} label={classification} /> : <StatusBadge value={n.severity} />;
    } },
    { header: "Opened", accessor: (n) => formatDate(n.createdAt) },
  ];

  function exportCsv() {
    const rows = filtered
      .map((n) => [n.id, whatHappenedText(n), ncrClassification(n) ?? "", n.workflow?.currentStep ?? ncrStepLabel(n.status)].map(csvCell).join(","))
      .join("\n");
    const blob = new Blob([`id,what_happened,classification,status\n${rows}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ncr-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ label: "Home", to: "/" }, { label: "Quality" }, { label: "NCR" }]}
        title="NCR"
        description={
          <>
            <p>Nonconformances. Log what went wrong, then contain it.</p>
            <CurrentPlantNote />
            {reason && <p>{reason}</p>}
          </>
        }
        actions={
          <>
            <button onClick={exportCsv} className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted">
              Export CSV
            </button>
            {canEdit && (
              <button
                onClick={() => setCreateOpen(true)}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
              >
                Log an NCR
              </button>
            )}
          </>
        }
      />

      <SummaryCards
        items={[
          { label: "Open", value: openCount, accent: true, detail: "Not closed" },
          { label: "High or critical", value: severeCount },
          { label: "Overdue", value: overdueCount },
          { label: "Showing", value: filtered.length, detail: `${ncrs.length} in this plant` },
        ]}
      />

      <SegmentedTabs
        tabs={[
          { key: "list", label: "List" },
          { key: "board", label: "Board" },
        ]}
        value={view}
        onChange={(key) => setParams(key === "list" ? {} : { view: key }, { replace: true })}
      />

      <FilterBar>
        <input
          value={textFilter}
          onChange={(e) => setTextFilter(e.target.value)}
          placeholder="Filter NCRs…"
          aria-label="Filter NCRs"
          className="w-64 border border-border bg-background px-3 py-1.5 text-sm"
        />
        <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} aria-label="Severity" className="border border-border bg-background px-3 py-1.5 text-sm">
          <option value="">All severities</option>
          {["low", "medium", "high", "critical"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {view === "list" && (
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="State" className="border border-border bg-background px-3 py-1.5 text-sm">
          <option value="">All states</option>
          {NCR_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ncrStepLabel(s)}
            </option>
          ))}
        </select>
        )}
      </FilterBar>

      {view === "board" ? (
        <>
          <p className="text-xs text-muted-foreground">Drag an issue to the next column to move it forward. Each step asks for what it needs first.</p>
          <NcrBoard ncrs={isLoading ? [] : ncrs.filter((n) => !severityFilter || listedSeverity(n) === severityFilter)} canEdit={canEdit} />
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
              {ncrStepLabel(s)}
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
        errorMessage="Couldn't load NCRs. Refresh the page. If it keeps failing, your access to nonconformances may have changed."
        emptyMessage="No NCRs yet. Log one when a part, lot, or process isn't right."
        onRowClick={(n) => navigate(`/ncr/${n.id}`)}
        selectedIds={canEdit ? selectedIds : undefined}
        onSelectionChange={canEdit ? setSelectedIds : undefined}
        listChrome={false}
      />
      </>
      )}

      <Modal title="Log an NCR" isOpen={createOpen} onClose={() => { setCreateOpen(false); setPendingFiles([]); setQuarantineRows([{ partNumber: "", quantity: "", serialNumber: "" }]); }}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            createNcr.mutate(
              {
                recordNumber: form.recordNumber.trim() || null,
                title: form.title,
                description: form.description || undefined,
                severity: form.severity,
                dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
                assignedTo: form.assignedTo ? Number(form.assignedTo) : undefined,
              },
              {
              onSuccess: async (created) => {
                const files = pendingFiles;
                const held = quarantineRows;
                setPendingFiles([]);
                setQuarantineRows([{ partNumber: "", quantity: "", serialNumber: "" }]);
                setCreateOpen(false);
                if (files.length > 0) {
                  const result = await uploadPendingAttachments("ncr", created.id, files);
                  if (result.failed.length > 0) toast.error(`NCR logged, but these files didn't attach: ${result.failed.join(", ")}. Add them on the NCR page.`);
                }
                try {
                  await saveDraftQuarantineItems(created.id, held);
                } catch (err) {
                  toast.error(extractErrorMessage(err, "NCR logged, but the quarantined items didn't save. Add them on the NCR page."));
                }
                navigate(`/ncr/${created.id}`);
              },
              onError: (err) => {
                const message = extractErrorMessage(err, "Couldn't log this issue. Check the title and try again.");
                setNumberError(duplicateNumberError(message));
                toast.error(message);
              },
              },
            );
          }}
        >
          <RecordNumberField label="NCR No." value={form.recordNumber} error={numberError} onChange={(value) => { setNumberError(null); setForm({ ...form, recordNumber: value }); }} />
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
              {peopleForAssignment(people).map((person) => (
                <option key={person.id} value={person.id}>
                  {formatPerson(person)}
                </option>
              ))}
            </SelectField>
          )}
          </DetailsDisclosure>
          <QuarantineDraftFields rows={quarantineRows} onChange={setQuarantineRows} />
          <PendingFilesField files={pendingFiles} onChange={setPendingFiles} />
          <button type="submit" className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground">
            Log NCR
          </button>
        </form>
      </Modal>
    </div>
  );
}

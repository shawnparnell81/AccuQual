import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import type { Ncr } from "../../api/types";
import { DataTable, type Column } from "../../components/tables/DataTable";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { Modal } from "../../components/modals/Modal";
import { TextField, TextAreaField, SelectField } from "../../components/forms/Field";
import { AiFieldAssistant } from "../../components/shared/AiFieldAssistant";
import { AiStructuredSuggestion } from "../../components/shared/AiStructuredSuggestion";
import { formatDate } from "../../lib/dates";

const ncrHooks = createResourceHooks<Ncr>("ncr");

interface NcrTriageSuggestion {
  suggestedSeverity: "low" | "medium" | "high" | "critical";
  suggestedDepartment: string;
  rationale: string;
  similarPastNcrs: string[];
}

/** NCR List: filters (severity, status, date range), export, quick-create. */
export function NcrListPage() {
  const [severityFilter, setSeverityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<{ title: string; description: string; severity: Ncr["severity"] }>({
    title: "",
    description: "",
    severity: "medium",
  });

  const { data: ncrs = [], isLoading } = ncrHooks.useList();
  const createNcr = ncrHooks.useCreate();
  const navigate = useNavigate();

  const filtered = useMemo(
    () =>
      ncrs.filter(
        (n) => (!severityFilter || n.severity === severityFilter) && (!statusFilter || n.status === statusFilter)
      ),
    [ncrs, severityFilter, statusFilter]
  );

  const columns: Column<Ncr>[] = [
    { header: "ID", accessor: (n) => `#${n.id}` },
    { header: "Title", accessor: (n) => n.title },
    { header: "Severity", accessor: (n) => <StatusBadge value={n.severity} /> },
    { header: "Status", accessor: (n) => <StatusBadge value={n.status} /> },
    { header: "Created", accessor: (n) => formatDate(n.createdAt) },
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
        <h1 className="text-2xl font-semibold">Non-Conformance Reports</h1>
        <div className="flex gap-2">
          <button onClick={exportCsv} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Export CSV
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            + New NCR
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} className="rounded-md border border-border px-3 py-2 text-sm">
          <option value="">All severities</option>
          {["low", "medium", "high", "critical"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-border px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {["open", "contained", "investigating", "corrective_action", "closed"].map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>

      <DataTable columns={columns} rows={filtered} rowKey={(n) => n.id} isLoading={isLoading} onRowClick={(n) => navigate(`/ncr/${n.id}`)} />

      <Modal title="Create NCR" isOpen={createOpen} onClose={() => setCreateOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            createNcr.mutate(form, {
              onSuccess: (created) => {
                setCreateOpen(false);
                navigate(`/ncr/${created.id}`);
              },
            });
          }}
        >
          <TextField label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Description</span>
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
            <TextAreaField label="" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
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
          <button type="submit" className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground">
            Create
          </button>
        </form>
      </Modal>
    </div>
  );
}

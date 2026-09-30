import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { createResourceHooks } from "../../api/resourceHooks";
import { formatDate } from "../../lib/dates";
import { formByKey, type IsoFormType } from "../../lib/isoFormCatalog";
import { showCell, type CellValue } from "../../lib/isoFormLogic";
import type { FailureRow, ScorecardRow } from "../../lib/qualitySheetLogic";
import { FormNumberEditor } from "../../components/forms/FormDocumentControls";
import { useCurrentUser } from "../../hooks/useAuth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { revisionLabel } from "../../lib/formDocument";

interface IsoQualityForm {
  id: number;
  formType: IsoFormType;
  data: { cells?: Record<string, CellValue>; customers?: ScorecardRow[]; problems?: FailureRow[] };
  createdAt?: string | null;
  updatedAt?: string | null;
}

const hooks = createResourceHooks<IsoQualityForm>("iso-quality-forms");

function filedName(pattern: string, formId: string, recordNumber: number, createdAt?: string | null) {
  const date = (createdAt ?? "").slice(0, 10);
  return pattern.replaceAll("{formId}", formId).replaceAll("{recordNumber}", String(recordNumber)).replaceAll("{date}", date);
}

interface FilingTemplate {
  formKey: string;
  formId: string;
  fileNamePattern: string;
}

function summary(formType: IsoFormType, data: IsoQualityForm["data"]): string {
  const cells = data.cells ?? {};
  if (formType === "internal_audit") return showCell(cells.B3) || showCell(cells.F3);
  if (formType === "ncr_report") return showCell(cells.B8) || showCell(cells.D6);
  if (formType === "quarantine_notice") return showCell(cells.B6);
  if (formType === "concession") return showCell(cells.B8) || showCell(cells.B7);
  if (formType === "competency_training") return showCell(cells.B4);
  if (formType === "cross_training") return showCell(cells.PN) || showCell(cells.PT);
  if (formType === "psw") return showCell(cells.B3) || showCell(cells.D3);
  if (formType === "turtle_diagram") return showCell(cells.B5) || showCell(cells.D5);
  if (formType === "quality_alert") return showCell(cells.D2) || showCell(cells.B10);
  if (formType === "first_article") return showCell(cells.F3) || showCell(cells.D4);
  if (formType === "customer_scorecard") return showCell(cells.B2) || data.customers?.find((row) => row.name)?.name || "";
  if (formType === "failure_effectiveness") return data.problems?.find((row) => row.problem)?.problem || "";
  return "";
}

export function IsoFormListPage() {
  const { formKey = "" } = useParams();
  const meta = formByKey(formKey);
  const navigate = useNavigate();
  const user = useCurrentUser();
  const { effective } = useEffectivePermissions();
  const canEdit = user?.roleName === "admin" || user?.roleName === "owner" || effective?.documents === "edit";
  const { data: rows = [], isLoading, isError } = hooks.useList();
  const filing = useQuery({
    queryKey: ["form-templates"],
    queryFn: async () => (await apiClient.get<{ fileNamePattern: string; templates: FilingTemplate[] }>("/document-folders/form-templates")).data,
  });
  const createForm = hooks.useCreate();
  const [pending, setPending] = useState(false);
  const filedTemplate = filing.data?.templates?.find((item) => item.formKey === formKey);
  const pattern = filedTemplate?.fileNamePattern ?? filing.data?.fileNamePattern ?? "{formId}_{recordNumber}_{date}";
  const filingId = filedTemplate?.formId ?? meta?.formId ?? "";
  const liveFormId = filedTemplate?.formId ?? meta?.formId ?? "";

  if (!meta) return <p className="text-sm text-muted-foreground">This form isn't in the library.</p>;
  const form = meta;

  const mine = rows.filter((row) => row.formType === form.formType);

  function start() {
    setPending(true);
    const cells = form.formType === "internal_audit" ? { F3: "Quality & Engineering" } : {};
    createForm.mutate({ formType: form.formType, data: { cells } } as never, {
      onSuccess: (created) => navigate(`/iso-forms/record/${created.id}`),
      onSettled: () => setPending(false),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{meta.title}</h1>
          <p className="text-sm text-muted-foreground">
            {revisionLabel(liveFormId, meta.rev)}. The blank template is filed under ISO Compliance Documents / Blank Form Templates. A filled copy can be saved into any Documents folder.
          </p>
          <FormNumberEditor formKey={form.formKey} />
        </div>
        {canEdit && (
          <button type="button" onClick={start} disabled={pending} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {pending ? "Creating…" : liveFormId ? `New ${liveFormId}` : `New ${meta.title}`}
          </button>
        )}
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading records…</p>}
      {isError && <p className="text-sm text-destructive">Couldn't load these forms.</p>}
      {!isLoading && !isError && mine.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No filled copies yet.</div>
      )}
      {mine.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Record</th>
                <th className="px-3 py-2 font-medium">Summary</th>
                <th className="px-3 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">
                    <button type="button" onClick={() => navigate(`/iso-forms/record/${row.id}`)} className="text-left text-primary hover:underline">
                      {filedName(pattern, filingId, row.id, row.createdAt)}
                    </button>
                  </td>
                  <td className="px-3 py-2">{summary(meta.formType, row.data ?? {}) || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.updatedAt || row.createdAt ? formatDate(row.updatedAt ?? row.createdAt) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

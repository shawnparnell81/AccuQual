import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

interface BuiltFormRow {
  id: number;
  kind: "grid" | "document" | "fields";
  title: string;
  formNumber: string | null;
  revision: string;
  status: string;
  updatedAt: string | null;
}

const KINDS = [
  { kind: "grid", label: "Excel-style grid", detail: "Merged cells, formulas, and Pass/Fail colors." },
  { kind: "document", label: "Word-style document", detail: "Procedures and work instructions, with fillable fields." },
  { kind: "fields", label: "Regular form", detail: "Sections, required fields, and a signature stamp." },
] as const;

export function FormBuilderListPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<(typeof KINDS)[number]["kind"]>("grid");
  const forms = useQuery({
    queryKey: ["form-builder"],
    queryFn: async () => (await apiClient.get<BuiltFormRow[]>("/form-builder")).data,
  });
  const create = useMutation({
    mutationFn: async () => (await apiClient.post<BuiltFormRow>("/form-builder", { kind, title: "Untitled form" })).data,
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey: ["form-builder"] });
      navigate(`/form-builder/${row.id}`);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't start that form.")),
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Form Builder</h1>
        <p className="text-sm text-muted-foreground">Build a grid, a document, or a regular form. Publishing files a blank template. Filling a copy does not change it.</p>
      </div>
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
        <label className="flex flex-col gap-1 text-sm">
          Kind
          <select className="rounded border border-border bg-background px-2 py-1" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            {KINDS.map((item) => (
              <option key={item.kind} value={item.kind}>{item.label}</option>
            ))}
          </select>
        </label>
        <button type="button" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60" disabled={create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? "Creating…" : "New form"}
        </button>
        <p className="text-sm text-muted-foreground">{KINDS.find((item) => item.kind === kind)?.detail}</p>
      </div>
      {forms.isError ? <p className="text-sm text-destructive">{extractErrorMessage(forms.error, "Form Builder is not turned on for this sign-in.")}</p> : null}
      <ul className="flex flex-col gap-2">
        {(forms.data ?? []).map((form) => (
          <li key={form.id}>
            <button type="button" className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-muted" onClick={() => navigate(`/form-builder/${form.id}`)}>
              <span>
                <span className="font-medium">{form.title}</span>
                <span className="ml-2 text-xs text-muted-foreground">{form.kind === "grid" ? "Grid" : form.kind === "document" ? "Document" : "Form"} · Rev {form.revision} · {form.status}</span>
              </span>
              <span className="text-xs text-muted-foreground">{form.formNumber?.trim() || "No form number"}</span>
            </button>
          </li>
        ))}
        {forms.data && forms.data.length === 0 ? <li className="text-sm text-muted-foreground">No forms yet. Start with a grid, a document, or a regular form.</li> : null}
      </ul>
    </div>
  );
}

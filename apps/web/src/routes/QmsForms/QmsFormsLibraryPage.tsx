import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";

interface FormStart {
  createPath: string;
  body: Record<string, unknown>;
  openPath: string;
}

interface FormTemplateLink {
  formKey: string;
  formId: string;
  title: string;
  subjectRoute: string;
  isoPath: string[];
  start: FormStart | null;
}

/**
 * Lists the master blank templates. These are the same rows filed under
 * Document Folders > ISO Compliance Documents > Blank Form Templates, not a second copy.
 */
export function QmsFormsLibraryPage() {
  const navigate = useNavigate();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const templates = useQuery({
    queryKey: ["form-templates"],
    queryFn: async () => (await apiClient.get<{ templates: FormTemplateLink[] }>("/document-folders/form-templates")).data.templates,
  });

  async function openForm(form: FormTemplateLink) {
    if (!form.start) {
      navigate(form.subjectRoute);
      return;
    }
    setPendingKey(form.formKey);
    setStartError(null);
    try {
      const created = await apiClient.post<{ id: number }>(form.start.createPath, form.start.body);
      navigate(form.start.openPath.replaceAll("{id}", String(created.data.id)));
    } catch {
      setStartError(`Couldn't start ${form.title}.`);
      setPendingKey(null);
    }
  }

  const byTopic = new Map<string, FormTemplateLink[]>();
  for (const form of templates.data ?? []) {
    const topic = form.isoPath.at(-1) || "Blank Form Templates";
    byTopic.set(topic, [...(byTopic.get(topic) ?? []), form]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">QMS Forms</h1>
        <p className="text-sm text-muted-foreground">
          Blank templates live in Document Folders under ISO Compliance Documents / Blank Form Templates. Start one here. A filled record is filed in its subject folder.
        </p>
      </div>

      {templates.isLoading && <p className="text-sm text-muted-foreground">Loading forms…</p>}
      {templates.isError && <p className="text-sm text-destructive">Couldn't load the form templates.</p>}
      {startError && <p className="text-sm text-destructive">{startError}</p>}

      {[...byTopic.entries()].map(([topic, forms]) => (
        <div key={topic} className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">{topic}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {forms.map((form) => (
              <button
                key={form.formKey}
                onClick={() => void openForm(form)}
                disabled={pendingKey !== null}
                className="flex items-start justify-between gap-2 rounded-md border border-border p-3 text-left text-sm hover:bg-muted"
                data-form-key={form.formKey}
              >
                <span className="font-medium">{form.title}</span>
                {form.formId ? <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{form.formId}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

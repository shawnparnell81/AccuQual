import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useFormTemplates, type FormTemplateCacheRow } from "../../api/formTemplatesQuery";
import { FormNumberEditor } from "../../components/forms/FormDocumentControls";

/**
 * Lists the master blank templates. The same rows are on Blank Forms.
 * Folder Explorer does not keep an empty copy of each blank.
 */
export function QmsFormsLibraryPage() {
  const navigate = useNavigate();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const templates = useFormTemplates();

  async function openForm(form: FormTemplateCacheRow) {
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

  const byTopic = new Map<string, FormTemplateCacheRow[]>();
  for (const form of templates.data ?? []) {
    const topic = form.isoPath.at(-1) || "Blank Form Templates";
    byTopic.set(topic, [...(byTopic.get(topic) ?? []), form]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">QMS Forms</h1>
        <p className="text-sm text-muted-foreground">
          These are the blank templates. Start one here, or from Blank Forms. When you save a filled copy, choose a Documents folder. Open folder on the save line takes you there. The blank stays in this list.
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
              <div key={form.formKey} className="flex flex-col gap-2 rounded-md border border-border p-3" data-form-key={form.formKey}>
                <button
                  onClick={() => void openForm(form)}
                  disabled={pendingKey !== null}
                  className="flex items-start justify-between gap-2 text-left text-sm hover:underline"
                >
                  <span className="font-medium">{form.title}</span>
                  {form.formId ? <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{form.formId}</span> : null}
                </button>
                <FormNumberEditor formKey={form.formKey} compact />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

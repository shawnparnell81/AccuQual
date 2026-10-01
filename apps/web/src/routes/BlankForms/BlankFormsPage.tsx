import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useFormTemplates, type FormTemplateCacheRow } from "../../api/formTemplatesQuery";

/**
 * Every fillable blank already in the app. Starting one creates a filled copy.
 * The template row stays here so the same blank can be used again.
 */
export function BlankFormsPage() {
  const navigate = useNavigate();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const templates = useFormTemplates();

  async function openForm(form: FormTemplateCacheRow) {
    if (!form.start) return;
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

  const needle = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const byTopic = new Map<string, FormTemplateCacheRow[]>();
    for (const form of templates.data ?? []) {
      if (!form.start) continue;
      if (needle && !`${form.formId} ${form.title} ${form.formKey}`.toLowerCase().includes(needle)) continue;
      const topic = form.isoPath.at(-1) || "Blank Forms";
      const list = byTopic.get(topic) ?? [];
      list.push(form);
      byTopic.set(topic, list);
    }
    return [...byTopic.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [needle, templates.data]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Blank Forms</h1>
          <p className="text-sm text-muted-foreground">
            Pick a blank and fill it in. Save as puts that copy in a Documents folder. The blank stays here and can be used again.
          </p>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a blank"
          aria-label="Find a blank"
          className="w-56 rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      {templates.isLoading && <p className="text-sm text-muted-foreground">Loading blank forms…</p>}
      {templates.isError && <p className="text-sm text-destructive">Couldn't load the blank forms.</p>}
      {startError && <p className="text-sm text-destructive">{startError}</p>}
      {!templates.isLoading && !templates.isError && groups.length === 0 && <p className="text-sm text-muted-foreground">No blanks match.</p>}

      <div className="flex flex-col gap-4" data-testid="blank-forms-list">
        {groups.map(([topic, forms]) => (
          <section key={topic} className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">{topic}</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {forms
                .slice()
                .sort((a, b) => a.title.localeCompare(b.title) || a.formKey.localeCompare(b.formKey))
                .map((form) => (
                  <button
                    key={form.formKey}
                    type="button"
                    data-testid="blank-form"
                    data-form-key={form.formKey}
                    onClick={() => void openForm(form)}
                    disabled={pendingKey !== null}
                    className="flex items-start justify-between gap-2 rounded-md border border-border p-3 text-left text-sm hover:bg-muted disabled:opacity-60"
                  >
                    <span className="font-medium">{form.title}</span>
                    {form.formId ? <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{form.formId}</span> : null}
                  </button>
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

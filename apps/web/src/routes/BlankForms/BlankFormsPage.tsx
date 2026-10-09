import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useFormTemplates, type FormTemplateCacheRow } from "../../api/formTemplatesQuery";
import { blankTemplateTopic, templatesOnBlankShelf } from "../../lib/blankFormsList";
import { blankFormsFolderHref } from "../../lib/folderBrowse";

const recentStarts = new Map<string, number>();

/** StrictMode runs an effect twice. One claim per form keeps that from creating two copies. */
function claimBlankStart(formKey: string): boolean {
  const now = Date.now();
  const last = recentStarts.get(formKey) ?? 0;
  if (now - last < 1000) return false;
  recentStarts.set(formKey, now);
  return true;
}

/**
 * The same blanks as Folder Explorer → Blank Forms Templates.
 * Starting one posts the template's start and opens the new copy. The template is not changed.
 */
export function BlankFormsListPage() {
  const navigate = useNavigate();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const templates = useFormTemplates();
  const blanks = templatesOnBlankShelf(templates.data ?? []);
  const byTopic = new Map<string, FormTemplateCacheRow[]>();
  for (const form of blanks) {
    const topic = blankTemplateTopic(form.isoPath);
    byTopic.set(topic, [...(byTopic.get(topic) ?? []), form]);
  }

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

  return (
    <div className="flex flex-col gap-4" data-testid="blank-forms-list">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Blank Forms</h1>
        <p className="text-sm text-muted-foreground">
          These are the blank templates from Blank Forms Templates. Open one to start a filled copy. The blank itself stays in that folder.
        </p>
        <Link to={blankFormsFolderHref()} className="mt-1 inline-block text-sm text-primary hover:underline">
          Open Blank Forms Templates
        </Link>
      </div>
      {templates.isLoading && <p className="text-sm text-muted-foreground">Loading blank forms…</p>}
      {templates.isError && <p className="text-sm text-destructive">Couldn't load the blank forms.</p>}
      {startError && <p className="text-sm text-destructive">{startError}</p>}
      {!templates.isLoading && !templates.isError && blanks.length === 0 && <p className="text-sm text-muted-foreground">No blank forms are on the shelf.</p>}
      {[...byTopic.entries()].map(([topic, forms]) => (
        <div key={topic} className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">{topic}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {forms.map((form) => (
              <button
                key={form.formKey}
                type="button"
                data-testid="blank-form"
                data-form-key={form.formKey}
                onClick={() => void openForm(form)}
                disabled={pendingKey !== null}
                className="flex items-start justify-between gap-2 rounded-md border border-border bg-background p-3 text-left text-sm text-foreground hover:bg-muted disabled:opacity-60"
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

/**
 * Opens one blank from Folder Explorer or from Blank Forms. The shortcut posts the same start
 * the list uses, then opens the new copy. The template is not changed.
 */
export function StartBlankFormPage() {
  const { formKey = "" } = useParams();
  const navigate = useNavigate();
  const templates = useFormTemplates();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!formKey || templates.isLoading || !templates.data) return;
    if (templates.isError) return;
    if (!claimBlankStart(formKey)) return;
    const form = templates.data.find((row) => row.formKey === formKey);
    if (!form) {
      setError("That blank is not in Blank Forms Templates.");
      return;
    }
    if (!form.start) {
      navigate(form.subjectRoute, { replace: true });
      return;
    }
    const start = form.start;
    void apiClient.post<{ id: number }>(start.createPath, start.body).then(
      (created) => {
        navigate(start.openPath.replaceAll("{id}", String(created.data.id)), { replace: true });
      },
      () => setError(`Couldn't start ${form.title}.`),
    );
  }, [formKey, navigate, templates.data, templates.isError, templates.isLoading]);

  if (templates.isError || error) {
    return (
      <div className="flex flex-col gap-2" data-testid="blank-start-error">
        <p className="text-sm text-destructive">{error ?? "Couldn't load the blank forms."}</p>
        <Link to={blankFormsFolderHref()} className="w-fit text-sm text-primary hover:underline">
          Back to Blank Forms Templates
        </Link>
      </div>
    );
  }

  return (
    <p className="text-sm text-muted-foreground" data-testid="blank-start">
      Starting a new copy…
    </p>
  );
}

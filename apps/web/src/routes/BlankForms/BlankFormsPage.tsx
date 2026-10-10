import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FileText } from "lucide-react";
import { apiClient } from "../../api/client";
import { useFormTemplates, type FormTemplateCacheRow } from "../../api/formTemplatesQuery";
import { ExplorerCatalog } from "../../components/documents/ExplorerCatalog";
import { ExplorerViewSwitcher } from "../../components/documents/ExplorerViewSwitcher";
import { FormNumberEditor } from "../../components/forms/FormDocumentControls";
import { blankTemplateTopic, templatesOnBlankShelf } from "../../lib/blankFormsList";
import { blankFormsFolderHref } from "../../lib/folderBrowse";
import { useExplorerView } from "../../hooks/useExplorerView";

/**
 * The same blanks as Folder Explorer → Blank Forms Templates.
 * A card opens an unsaved copy. The record is created on the first Save, on the same page Folder Explorer uses.
 */
export function BlankFormsListPage() {
  const navigate = useNavigate();
  const [view, setView] = useExplorerView("blank-forms");
  const templates = useFormTemplates();
  const blanks = templatesOnBlankShelf(templates.data ?? []);
  const byTopic = new Map<string, FormTemplateCacheRow[]>();
  for (const form of blanks) {
    const topic = blankTemplateTopic(form.isoPath);
    byTopic.set(topic, [...(byTopic.get(topic) ?? []), form]);
  }

  function openForm(form: FormTemplateCacheRow) {
    if (!form.start) {
      navigate(form.subjectRoute);
      return;
    }
    navigate(`/blank-forms/start/${form.formKey}`);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="blank-forms-list">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Blank Forms</h1>
          <p className="text-sm text-muted-foreground">
            These are the blank templates from Blank Forms Templates. Open one to start a filled copy. The blank itself stays in that folder.
          </p>
          <Link to={blankFormsFolderHref()} className="mt-1 inline-block text-sm text-primary hover:underline">
            Open Blank Forms Templates
          </Link>
        </div>
        <ExplorerViewSwitcher view={view} onChange={setView} />
      </div>
      {templates.isLoading && <p className="text-sm text-muted-foreground">Loading blank forms…</p>}
      {templates.isError && <p className="text-sm text-destructive">Couldn't load the blank forms.</p>}
      {!templates.isLoading && !templates.isError && blanks.length === 0 && <p className="text-sm text-muted-foreground">No blank forms are on the shelf.</p>}
      {[...byTopic.entries()].map(([topic, forms]) => (
        <div key={topic} className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">{topic}</h2>
          <ExplorerCatalog
            items={forms}
            view={view}
            title={(form) => form.title}
            icon={() => <FileText size={view === "small" ? 28 : 16} className="text-primary" aria-hidden />}
            largeVisual={() => <FileText size={40} className="text-primary" aria-hidden />}
            onOpen={(form) => openForm(form)}
            itemTestId={() => "blank-form"}
            itemAttrs={(form) => ({ "data-form-key": form.formKey })}
            columns={[
              { key: "formId", label: "Form ID", render: (form) => form.formId || "—" },
              { key: "topic", label: "Topic", render: () => topic },
            ]}
            trailing={(form) => <FormNumberEditor formKey={form.formKey} compact />}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Opens one blank from Folder Explorer or from Blank Forms.
 * Nothing is written until Save. A second open is another unsaved copy.
 */
export function StartBlankFormPage() {
  const { formKey = "" } = useParams();
  const navigate = useNavigate();
  const templates = useFormTemplates();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const form = templates.data?.find((row) => row.formKey === formKey);

  useEffect(() => {
    if (!formKey || templates.isLoading || !templates.data) return;
    if (templates.isError) return;
    if (!form) {
      setError("That blank is not in Blank Forms Templates.");
      return;
    }
    if (!form.start) navigate(form.subjectRoute, { replace: true });
  }, [form, formKey, navigate, templates.data, templates.isError, templates.isLoading]);

  async function saveCopy() {
    if (!form?.start || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await apiClient.post<{ id: number }>(form.start.createPath, form.start.body);
      navigate(form.start.openPath.replaceAll("{id}", String(created.data.id)), { replace: true, state: { freshForm: true } });
    } catch {
      setError(`Couldn't save ${form.title}.`);
      setSaving(false);
    }
  }

  if (templates.isError || (error && !form)) {
    return (
      <div className="flex flex-col gap-2" data-testid="blank-start-error">
        <p className="text-sm text-destructive">{error ?? "Couldn't load the blank forms."}</p>
        <Link to={blankFormsFolderHref()} className="w-fit text-sm text-primary hover:underline">
          Back to Blank Forms Templates
        </Link>
      </div>
    );
  }

  if (templates.isLoading || !form?.start) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="blank-start">
        Opening a new copy…
      </p>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-4" data-testid="blank-start">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{form.title}</h1>
        <p className="text-sm text-muted-foreground">This copy is not saved. Nothing is stored until you save.</p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="button"
        onClick={() => void saveCopy()}
        disabled={saving}
        className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FileText, Pencil } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { FORM_TEMPLATES_QUERY_KEY, useFormTemplates, type FormTemplateCacheRow } from "../../api/formTemplatesQuery";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { blankDraftState, unsavedBlankPath } from "../../lib/blankDraft";
import { blankFormFileName, blankFormsByName, blankRenameProblem, blankTemplateTopic, templatesOnBlankShelf } from "../../lib/blankFormsList";
import { blankFormsFolderHref } from "../../lib/folderBrowse";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";

/**
 * The same blanks as Folder Explorer → Blank Forms Templates, shown like File Explorer's Details view.
 * Double-click or Enter opens an unsaved copy. F2, right-click > Rename, or the pencil renames the display title only.
 */
export function BlankFormsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { effective, isLoading: permsLoading } = useEffectivePermissions();
  const canRename = !permsLoading && effective?.["folders.rename"] === "edit";
  const templates = useFormTemplates();
  const shelf = templatesOnBlankShelf(templates.data ?? []);
  const blanks = blankFormsByName(shelf);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ formKey: string; x: number; y: number } | null>(null);

  const rename = useMutation({
    mutationFn: async ({ formKey, name }: { formKey: string; name: string }) =>
      (await apiClient.patch(`/document-folders/form-templates/${formKey}/name`, { name })).data,
    onSuccess: async () => {
      setEditing(null);
      setProblem(null);
      await queryClient.invalidateQueries({ queryKey: FORM_TEMPLATES_QUERY_KEY });
    },
    onError: (err) => setProblem(extractErrorMessage(err, "Couldn't rename this blank form.")),
  });

  /** Each blank is a folder: the blank pinned on top, its saved copies below. */
  function openForm(form: FormTemplateCacheRow) {
    navigate(`/blank-forms/${encodeURIComponent(form.formKey)}`);
  }

  function startRename(form: FormTemplateCacheRow) {
    if (!canRename) return;
    setMenu(null);
    setProblem(null);
    setEditing(form.formKey);
    setDraft(form.displayTitle?.trim() || form.title);
  }

  function commitRename(form: FormTemplateCacheRow) {
    const issue = blankRenameProblem(shelf, form.formKey, draft);
    if (issue) {
      setProblem(issue);
      return;
    }
    if (draft.trim().replace(/\s+/g, " ") === (form.displayTitle?.trim() || form.title)) {
      setEditing(null);
      return;
    }
    rename.mutate({ formKey: form.formKey, name: draft });
  }

  function cancelRename() {
    setEditing(null);
    setProblem(null);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="blank-forms-list" onClick={() => setMenu(null)}>
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
      {!templates.isLoading && !templates.isError && blanks.length === 0 && <p className="text-sm text-muted-foreground">No blank forms are on the shelf.</p>}
      {blanks.length > 0 && (
        <div className="rounded-lg border border-border bg-card text-sm" role="grid" aria-label="Blank forms" data-explorer-view="details">
          <div className="grid grid-cols-[minmax(0,1fr)_12rem] border-b border-border px-3 py-1.5 text-xs font-medium text-muted-foreground" role="row">
            <span role="columnheader" aria-sort="ascending">Name</span>
            <span role="columnheader">Type</span>
          </div>
          {blanks.map((form) => {
            const isEditing = editing === form.formKey;
            const number = form.formId.trim();
            return (
              <div
                key={form.formKey}
                role="row"
                tabIndex={0}
                aria-selected={selected === form.formKey}
                data-testid="blank-form"
                data-form-key={form.formKey}
                className={`group grid cursor-default grid-cols-[minmax(0,1fr)_12rem] items-center gap-2 px-3 py-1 outline-none hover:bg-muted focus:bg-primary/10 ${selected === form.formKey ? "bg-primary/10" : ""}`}
                onClick={() => setSelected(form.formKey)}
                onDoubleClick={() => !isEditing && openForm(form)}
                onKeyDown={(event) => {
                  if (isEditing) return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    openForm(form);
                  } else if (event.key === "F2") {
                    event.preventDefault();
                    startRename(form);
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSelected(form.formKey);
                  setMenu({ formKey: form.formKey, x: event.clientX, y: event.clientY });
                }}
              >
                <span role="gridcell" className="flex min-w-0 items-center gap-2">
                  <FileText size={16} className="shrink-0 text-primary" aria-hidden />
                  {isEditing ? (
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex min-w-0 items-center gap-1">
                        {number && <span className="shrink-0 text-foreground">{number}</span>}
                        <input
                          autoFocus
                          aria-label="New name"
                          data-testid="blank-form-rename-input"
                          value={draft}
                          maxLength={200}
                          onChange={(event) => setDraft(event.target.value)}
                          onFocus={(event) => event.currentTarget.select()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              commitRename(form);
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              cancelRename();
                            }
                          }}
                          onBlur={() => {
                            if (!rename.isPending) cancelRename();
                          }}
                          className="min-w-0 flex-1 rounded border border-primary bg-background px-1 py-0.5 text-sm text-foreground"
                        />
                      </span>
                      {problem && <span className="text-xs text-destructive" role="alert">{problem}</span>}
                    </span>
                  ) : (
                    <>
                      <span className="truncate text-foreground" title={blankFormFileName(form)}>{blankFormFileName(form)}</span>
                      {canRename && (
                        <button
                          type="button"
                          aria-label={`Rename ${blankFormFileName(form)}`}
                          className="invisible shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted group-hover:visible group-focus:visible"
                          onClick={(event) => {
                            event.stopPropagation();
                            startRename(form);
                          }}
                        >
                          <Pencil size={13} aria-hidden />
                        </button>
                      )}
                    </>
                  )}
                </span>
                <span role="gridcell" className="truncate text-muted-foreground">{blankTemplateTopic(form.isoPath)}</span>
              </div>
            );
          })}
        </div>
      )}
      {menu && (
        <div
          role="menu"
          className="fixed z-50 min-w-36 rounded-md border border-border bg-card py-1 text-sm shadow-md"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-1 text-left hover:bg-muted"
            onClick={() => {
              const form = blanks.find((row) => row.formKey === menu.formKey);
              setMenu(null);
              if (form) openForm(form);
            }}
          >
            Open
          </button>
          {canRename && (
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-1 text-left hover:bg-muted"
              onClick={() => {
                const form = blanks.find((row) => row.formKey === menu.formKey);
                if (form) startRename(form);
              }}
            >
              Rename
            </button>
          )}
        </div>
      )}
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
    if (!form.start) {
      navigate(form.subjectRoute, { replace: true });
      return;
    }
    const start = form.start;
    const deferred = blankDraftState(start);
    if (deferred) {
      // Pass formKey as query param too, so the blank page can recover if location.state is lost.
      const base = unsavedBlankPath(start.openPath);
      const sep = base.includes("?") ? "&" : "?";
      navigate(`${base}${sep}formKey=${encodeURIComponent(formKey)}`, { replace: true, state: deferred });
      return;
    }
    void apiClient.post<{ id: number }>(start.createPath, start.body).then(
      (created) => {
        navigate(start.openPath.replaceAll("{id}", String(created.data.id)), { replace: true, state: { freshForm: true } });
      },
      () => setError(`Couldn't start ${form.title}.`),
    );
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

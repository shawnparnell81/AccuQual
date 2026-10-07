import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useFormTemplates } from "../../api/formTemplatesQuery";
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
 * Opens one blank from Folder Explorer. The shortcut posts the same start
 * the Blank Forms list used, then opens the new copy. The template is not changed.
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

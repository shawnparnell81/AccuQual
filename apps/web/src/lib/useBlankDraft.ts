import { useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useFormTemplates } from "../api/formTemplatesQuery";
import { blankDraftFromTemplates, readBlankDraft, type BlankDraft, type DeferredCreatePath } from "./blankDraft";

/**
 * The unsaved blank for a `/new` page.
 * Router state is lost inside workspace tabs (each kept tab renders with `state: null`) and on refresh,
 * so fall back to the `formKey` query param that Blank Forms always adds, and rebuild the same blank
 * from Blank Forms Templates. Nothing is written until Save.
 */
export function useBlankDraft(createPath: DeferredCreatePath, isNew: boolean): { draft: BlankDraft | null; loading: boolean } {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const fromState = useMemo(() => (isNew ? readBlankDraft(location.state, createPath) : null), [isNew, location.state, createPath]);
  const formKey = isNew && !fromState ? searchParams.get("formKey") : null;
  const templates = useFormTemplates({ enabled: !!formKey });
  const fromTemplate = useMemo(() => blankDraftFromTemplates(formKey, templates.data, createPath), [formKey, templates.data, createPath]);
  return { draft: fromState ?? fromTemplate, loading: !!formKey && templates.isLoading };
}

import { Navigate, useParams } from "react-router-dom";
import { getQmsFormDefinition, isRetiredQmsFormType } from "./qmsFormDefinitions";

/**
 * Old form-type list. Saved copies of that form are in its folder.
 * The retired register opens the live Master Document List.
 * First Article blanks open from Blank Forms; that folder was retired.
 */
export function QmsFormTypePage() {
  const { formType = "" } = useParams();
  if (isRetiredQmsFormType(formType)) return <Navigate to="/documents/master-list" replace />;
  if (formType === "first_article_inspection" || !getQmsFormDefinition(formType)) return <Navigate to="/blank-forms" replace />;
  return <Navigate to={`/form-folders/${encodeURIComponent(formType)}`} replace />;
}

import { Navigate } from "react-router-dom";

/** Old catalog URL. The same blanks are on Blank Forms. */
export function QmsFormsLibraryPage() {
  return <Navigate to="/blank-forms" replace />;
}

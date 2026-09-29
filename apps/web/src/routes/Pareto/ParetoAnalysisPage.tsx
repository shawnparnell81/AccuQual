import { useEffect, useState } from "react";
import { ParetoChartForm } from "../../components/forms/customForms/ParetoChartForm";
import { FormNumberEditor, RecordFolderField, useFormFiling } from "../../components/forms/FormDocumentControls";
import { useFormEditorState } from "../../components/forms/useFormEditorState";
import { SaveStatus } from "../../components/shared/SaveStatus";
import { revisionLabel } from "../../lib/formDocument";

/** A standalone analysis tool, not tied to any other record — a fixed singleton document. */
const SINGLETON_ENTITY_ID = 1;

export function ParetoAnalysisPage() {
  const { isLoading, values, updateField, isSaving } = useFormEditorState("pareto_chart", SINGLETON_ENTITY_ID);
  const filing = useFormFiling("frm-par-001", SINGLETON_ENTITY_ID);
  const documentNumber = filing.data?.snapshotted ? filing.data.formNumber : "";
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!isSaving) setDirty(false);
  }, [isSaving]);

  return (
    <div className="aq-print-wide flex flex-col gap-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">Pareto Analysis</h1>
          <p className="text-sm text-muted-foreground">{revisionLabel(documentNumber)}. Problem counts sort by frequency and the cumulative % line is calculated from the total.</p>
          <FormNumberEditor formKey="frm-par-001" />
          <RecordFolderField formKey="frm-par-001" recordId={SINGLETON_ENTITY_ID} />
        </div>
        <div className="flex items-center gap-2">
          <SaveStatus saving={isSaving} unsaved={dirty && !isSaving} />
          <button type="button" onClick={() => window.print()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Print
          </button>
        </div>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading the chart…</p>
      ) : (
        <ParetoChartForm
          data={values}
          documentNumber={documentNumber}
          onChange={(name, value) => {
            setDirty(true);
            updateField(name, value);
          }}
        />
      )}
    </div>
  );
}

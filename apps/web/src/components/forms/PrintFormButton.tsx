import { useState } from "react";
import { Printer } from "lucide-react";
import { exportFormPdf } from "../../api/formHooks";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";

interface PrintFormButtonProps {
  formType: string;
  entityId: number;
  label?: string;
}

/**
 * A direct, one-click "Print" for any of this app's older-generic-engine
 * form types — real PDF bytes via the same self-healing exportFormPdf path
 * FormEditor's own "Export PDF" button uses (see forms.service.ts's
 * loadTemplate), triggered right from the record's own page instead of
 * requiring "Open Form" -> the floating window -> Export PDF three clicks
 * deep. Drop this next to OpenFormButton wherever one exists — every real
 * document in the app needs a print action reachable in one click, not just
 * the bespoke standalone ones (DCR/SCAR/Quality Inspection/Feasibility/QMS
 * Forms/Work Order Traveler all already have their own window.print()
 * button for the same reason).
 */
export function PrintFormButton({ formType, entityId, label = "Print" }: PrintFormButtonProps) {
  const toast = useToast();
  const [isExporting, setIsExporting] = useState(false);

  async function handleClick() {
    setIsExporting(true);
    try {
      const bytes = await exportFormPdf(formType, entityId);
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${formType}-${entityId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(await extractErrorMessageAsync(err, "Couldn't print this document."));
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <button onClick={handleClick} disabled={isExporting} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60">
      <Printer size={16} /> {isExporting ? "Preparing…" : label}
    </button>
  );
}

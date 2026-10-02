import { useState } from "react";
import { Printer } from "lucide-react";
import { exportFormPdf } from "../../api/formHooks";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { presentPdf, PRINT_NOT_DOCUMENT, PRINT_PREPARE_FAILED, PRINT_SAVE_FAILED, printShouldToast } from "../../lib/printDocument";

interface PrintFormButtonProps {
  formType: string;
  entityId: number;
  label?: string;
}

/**
 * One-click print for a generic-engine form. The PDF comes from the same
 * export path as FormEditor. Opening the print dialog, or saving the file
 * when the dialog cannot attach, is success — the button does not toast
 * those. A toast is reserved for a missing document or a real failure.
 */
export function PrintFormButton({ formType, entityId, label = "Print" }: PrintFormButtonProps) {
  const toast = useToast();
  const [isExporting, setIsExporting] = useState(false);

  async function handleClick() {
    setIsExporting(true);
    try {
      const bytes = await exportFormPdf(formType, entityId);
      const outcome = await presentPdf(bytes, `${formType}-${entityId}.pdf`);
      if (printShouldToast(outcome)) toast.error(PRINT_SAVE_FAILED);
    } catch (err) {
      if (err instanceof Error && (err.message === PRINT_NOT_DOCUMENT || err.message === PRINT_SAVE_FAILED)) {
        toast.error(err.message);
      } else {
        toast.error(await extractErrorMessageAsync(err, PRINT_PREPARE_FAILED));
      }
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <button type="button" onClick={handleClick} disabled={isExporting} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60">
      <Printer size={16} /> {isExporting ? "Preparing…" : label}
    </button>
  );
}

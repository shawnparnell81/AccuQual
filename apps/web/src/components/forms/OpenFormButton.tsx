import { FileText } from "lucide-react";
import { useWindowStore } from "../../window-manager/useWindowStore";

interface OpenFormButtonProps {
  formType: string;
  entityId: number;
  title: string;
  /** Button text — defaults to "Open Form". Set a distinct label when a detail page opens several form types side by side (e.g. "APQP Summary", "Control Plan") so they're not all identically labeled. */
  label?: string;
}

/** Drop this into any module's detail page — opens that record's fillable form in a window. */
export function OpenFormButton({ formType, entityId, title, label = "Open Form" }: OpenFormButtonProps) {
  const openWindow = useWindowStore((s) => s.openWindow);

  return (
    <button
      onClick={() => openWindow({ type: "form", formType, entityId, title })}
      className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
    >
      <FileText size={16} /> {label}
    </button>
  );
}

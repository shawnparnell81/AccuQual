import { ExternalLink } from "lucide-react";
import { useWindowStore } from "../../window-manager/useWindowStore";

interface OpenWindowButtonProps {
  type: "document" | "audit";
  entityId: number;
  title: string;
  label?: string;
}

/**
 * "Quick view" — opens a record in a floating window without leaving the
 * current list. Same pattern as OpenFormButton.tsx, generalized to the
 * document/audit window types (Full-System Audit finding M9's real
 * reachability half — see WindowManager.tsx).
 */
export function OpenWindowButton({ type, entityId, title, label = "Quick view" }: OpenWindowButtonProps) {
  const openWindow = useWindowStore((s) => s.openWindow);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        openWindow({ type, entityId, title });
      }}
      className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
      title={label}
    >
      <ExternalLink size={14} /> {label}
    </button>
  );
}

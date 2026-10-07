import { Printer } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useCurrentUser } from "../../hooks/useAuth";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { canPrintAccess, printScreen } from "../../lib/printDocument";
import { recordSurface } from "../../lib/recordSurface";

/**
 * One Print control for every record that uses the shared frame or the
 * workspace chrome. Anyone who can already view the record can use it.
 * The button prints the open page, not a second layout.
 */
export function PrintRecordButton({ label = "Print" }: { label?: string }) {
  const { pathname } = useLocation();
  const user = useCurrentUser();
  const { effective, isLoading } = useEffectivePermissions();
  const surface = recordSurface(pathname);
  const level = !surface || surface.access === "any" ? "any" : effective?.[surface.access];
  if (!isLoading && !canPrintAccess(level)) return null;

  const printedBy = user?.name?.trim() || user?.email || "Signed-in user";

  return (
    <button
      type="button"
      data-testid="print-record"
      className="no-print inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
      onClick={(event) => {
        const host = event.currentTarget.closest(".record-frame, [data-pane], #main-content");
        const root = host instanceof HTMLElement ? host : document.body;
        printScreen(root, { printedBy });
      }}
    >
      <Printer size={16} /> {label}
    </button>
  );
}

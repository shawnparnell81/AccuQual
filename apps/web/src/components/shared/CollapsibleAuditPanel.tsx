import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { useAuthStore } from "../../store/authStore";
import { AUDIT_COLLAPSE_EVENT, auditCollapseKey, auditPanelHeading, loadAuditExpanded, saveAuditExpanded } from "../../lib/collapsedAuditTrail";

/**
 * The one wrapper every audit trail / history panel uses. Collapsed by default,
 * one header row ("Audit trail (12 entries)" + chevron); the header is a real
 * button, so Enter and Space work and aria-expanded is set. Each user's choice
 * is remembered in localStorage and shared across every page. Display only:
 * the entries inside are rendered exactly as before.
 */
export function CollapsibleAuditPanel({
  title,
  count,
  icon,
  aside,
  forceOpen = false,
  className,
  children,
}: {
  title: string;
  /** Entry count for the header. Null while loading. */
  count: number | null;
  icon?: ReactNode;
  /** Small status text on the right of the header, e.g. "Refreshing…". */
  aside?: ReactNode;
  /** Opens the panel regardless of the saved choice, e.g. when the URL points at one entry. Does not change the saved choice. */
  forceOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const storageKey = auditCollapseKey(userId);
  const [expanded, setExpanded] = useState(() => loadAuditExpanded(storageKey));
  const regionId = useId();

  useEffect(() => {
    const reload = () => setExpanded(loadAuditExpanded(storageKey));
    reload();
    window.addEventListener(AUDIT_COLLAPSE_EVENT, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(AUDIT_COLLAPSE_EVENT, reload);
      window.removeEventListener("storage", reload);
    };
  }, [storageKey]);

  const open = expanded || forceOpen;

  function toggle() {
    const next = !open;
    setExpanded(next);
    saveAuditExpanded(storageKey, next);
    window.dispatchEvent(new Event(AUDIT_COLLAPSE_EVENT));
  }

  return (
    <div className={clsx("rounded-lg border border-border bg-card", className)}>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={regionId} className="flex min-w-0 items-center gap-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
          {icon}
          <span className="truncate">{auditPanelHeading(title, count)}</span>
        </button>
        {aside}
      </div>
      {/* Stays in the DOM when collapsed, and still prints. */}
      <div id={regionId} hidden={!open} className="border-t border-border px-4 pb-4 pt-3 print:block">
        {children}
      </div>
    </div>
  );
}

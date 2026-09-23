import type { UseMutationResult } from "@tanstack/react-query";
import clsx from "clsx";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";

interface WorkflowActionButtonProps {
  /** Button text, e.g. "Close NCR". */
  label: string;
  /** navConfig.ts key for the permission check (ncr, capa, di, audit, calibration, suppliers). */
  navKey: string;
  /** A useWorkflowAction/useWorkflowUpdate mutation — variables shape differs per action, only isPending is read here. */
  action: Pick<UseMutationResult<unknown, unknown, unknown>, "isPending">;
  onClick: () => void;
  /**
   * Eligibility (a sequence check like "status must be corrective_action" —
   * see the Rules Dictionary): false means this transition doesn't apply to
   * the record's current state, so the button doesn't render at all — same
   * as the existing `{status !== "closed" && <button>}` convention.
   * Permission hides the button. The record strip explains why
   * (READ_ONLY_REASON) so a control the user can't use isn't left looking
   * broken. Default true (always eligible unless the caller says otherwise).
   */
  visible?: boolean;
  variant?: "primary" | "outline";
}

/**
 * Generic, permission- and pending-aware transition button — the one real
 * shared "WorkflowTransitionButton" this pass needed. Every module's
 * dedicated-endpoint actions (NCR/CAPA/DI/Audit/Supplier) use this instead
 * of a bespoke inline <button onClick={...}> so permission-hiding and the
 * pending/error states aren't duplicated five times.
 */
export function WorkflowActionButton({ label, navKey, action, onClick, visible = true, variant = "outline" }: WorkflowActionButtonProps) {
  const canEdit = useCanEditWorkflow(navKey);
  if (!visible || !canEdit) return null;

  return (
    <button
      onClick={onClick}
      disabled={action.isPending}
      className={clsx(
        "rounded-md px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" ? "bg-button text-button-foreground" : "border border-border hover:bg-muted"
      )}
    >
      {action.isPending ? "Working…" : label}
    </button>
  );
}

import type { ReactNode } from "react";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";

interface WorkflowRuleGuardProps {
  /** navConfig.ts key for the permission check (ncr, capa, di, audit, calibration, suppliers). */
  navKey: string;
  children: ReactNode;
  /** Shown instead of nothing when the user lacks access — omit to just hide `children`. */
  fallback?: ReactNode;
}

/**
 * For the cases WorkflowActionButton doesn't cover — hiding a whole toolbar,
 * a form section, or an arbitrary block of UI based on department access,
 * rather than a single button. Most module pages only need
 * WorkflowActionButton; this is for the rest.
 */
export function WorkflowRuleGuard({ navKey, children, fallback = null }: WorkflowRuleGuardProps) {
  const canEdit = useCanEditWorkflow(navKey);
  return <>{canEdit ? children : fallback}</>;
}

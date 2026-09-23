import { READ_ONLY_REASON, UNASSIGNED_PLANT_REASON } from "../lib/opsLanguage";
import { useCanEditWorkflow } from "./useWorkflowAccess";
import { useSites } from "./useSites";

/**
 * Department edit rights, plus a plant assignment. Create buttons on
 * plant-scoped lists use this. A missing plant explains why the button
 * is gone; a read-only department keeps the existing explanation.
 */
export function usePlantWrite(navKey: string): { canEdit: boolean; reason: string | null } {
  const departmentCanEdit = useCanEditWorkflow(navKey);
  const { currentSiteId, isLoading, data } = useSites();
  if (isLoading || (data === undefined && currentSiteId == null)) return { canEdit: false, reason: null };
  if (!currentSiteId) return { canEdit: false, reason: UNASSIGNED_PLANT_REASON };
  if (!departmentCanEdit) return { canEdit: false, reason: READ_ONLY_REASON };
  return { canEdit: true, reason: null };
}

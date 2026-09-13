import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import type { WorkflowHistoryEntry, WorkflowModuleName } from "../api/types";

/**
 * GET /workflow/history/:moduleName/:recordId (built in Phase 6, read-only,
 * backed entirely by audit_trail). One shared hook so every module's history
 * panel fetches and caches the same way. This query key (["workflow-history",
 * moduleName, recordId]) is a different shape than the resource key each
 * page's own mutations invalidate (e.g. useWorkflowAction("ncr", ...)
 * invalidates ["ncr"]) — the two don't overlap by React Query's prefix
 * matching, so every call site performing a transition also passes
 * `invalidateKeys: [["workflow-history", moduleName, recordId]]` (see
 * useWorkflowAction/useWorkflowUpdate) to keep this panel fresh without a
 * manual refetch or remount.
 */
export function useWorkflowHistory(moduleName: WorkflowModuleName, recordId: number | undefined) {
  return useQuery<WorkflowHistoryEntry[]>({
    queryKey: ["workflow-history", moduleName, recordId],
    queryFn: async () => (await apiClient.get(`/workflow/history/${moduleName}/${recordId}`)).data,
    enabled: recordId !== undefined,
  });
}

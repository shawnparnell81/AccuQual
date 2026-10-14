import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import type { CompanyProfile } from "../api/types";
import { digitalTwinEnabled } from "../lib/digitalTwinFlag";
import { receivingInventoryEnabled } from "../lib/receivingInventoryFlag";
import { useAuthStore } from "../store/authStore";

/**
 * GET /company/profile, shared with Company Settings. Unset and a failed
 * read both mean off, so the menu never flashes Digital Twin while loading.
 */
export function useDigitalTwinEnabled() {
  const signedIn = useAuthStore((s) => s.user != null);
  const query = useQuery({
    queryKey: ["company/profile"],
    enabled: signedIn,
    staleTime: 60_000,
    queryFn: async () => (await apiClient.get<CompanyProfile>("/company/profile")).data,
  });
  return {
    enabled: digitalTwinEnabled(query.data?.digitalTwinEnabled),
    /** Receiving & Inventory on/off, from the same profile read. Off while loading. */
    receivingInventory: receivingInventoryEnabled(query.data?.receivingInventoryEnabled),
    plannerUrl: query.data?.engineeringPlannerUrl ?? null,
    ready: !signedIn || query.isSuccess || query.isError,
  };
}

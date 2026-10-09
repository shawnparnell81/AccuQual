import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import type { CompanyProfile } from "../api/types";
import { useCurrentUser } from "./useAuth";
import { navigationLayoutFromProfile } from "../lib/navigationLayout";

/** Sidebar until the company profile says otherwise. A failed read keeps the left menu. */
export function useNavigationLayout() {
  const user = useCurrentUser();
  const query = useQuery({
    queryKey: ["company/profile"],
    queryFn: async () => (await apiClient.get<CompanyProfile>("/company/profile")).data,
    enabled: user != null,
    staleTime: 60_000,
  });
  return navigationLayoutFromProfile(query.data?.navigationLayout);
}

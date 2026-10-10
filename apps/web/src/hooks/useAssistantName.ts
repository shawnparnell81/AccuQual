import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import type { AssistantNameResponse } from "../api/types";
import { useAuthStore } from "../store/authStore";

/**
 * GET /company/assistant-name, shared by every AI-assistant surface (the
 * global floating panel and each page-embedded AiFieldAssistant button) so
 * they all read one cached value instead of each holding its own copy —
 * and so renaming the assistant in Admin updates every button at once.
 */
function useCompanyAssistant() {
  const signedIn = useAuthStore((s) => s.user != null);
  return useQuery({
    queryKey: ["company/assistant-name"],
    enabled: signedIn,
    queryFn: async () => (await apiClient.get<AssistantNameResponse>("/company/assistant-name")).data,
  });
}

export function useAssistantName() {
  const query = useCompanyAssistant();
  return { ...query, data: query.data?.assistantName };
}

/** True unless this company has turned AI-assisted features off. Defaults to on while the setting is still loading. */
export function useAiFeaturesEnabled() {
  const query = useCompanyAssistant();
  return query.data?.featuresEnabled !== false;
}

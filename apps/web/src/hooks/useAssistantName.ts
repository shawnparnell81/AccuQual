import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import type { AssistantNameResponse } from "../api/types";

/**
 * GET /tenant/assistant-name, shared by every AI-assistant surface (the
 * global floating panel and each page-embedded AiFieldAssistant button) so
 * they all read one cached value instead of each holding its own copy —
 * and so renaming the assistant in Admin updates every button at once.
 */
export function useAssistantName() {
  return useQuery({
    queryKey: ["tenant/assistant-name"],
    queryFn: async () => (await apiClient.get<AssistantNameResponse>("/company/assistant-name")).data.assistantName,
  });
}

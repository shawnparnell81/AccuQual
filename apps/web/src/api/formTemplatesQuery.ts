import { useQuery } from "@tanstack/react-query";
import { apiClient } from "./client";
import { FORM_TEMPLATES_QUERY_KEY, formTemplatesFromBody, type FormTemplateCacheRow } from "./formTemplatesCache";

export { DEFAULT_FILE_NAME_PATTERN, FORM_TEMPLATES_QUERY_KEY, formTemplatesFromBody, recordFileNamePattern } from "./formTemplatesCache";
export type { FormTemplateCacheRow, FormTemplateStart } from "./formTemplatesCache";

export async function fetchFormTemplates(): Promise<FormTemplateCacheRow[]> {
  const response = await apiClient.get<unknown>("/document-folders/form-templates");
  return formTemplatesFromBody(response.data);
}

export function useFormTemplates(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: FORM_TEMPLATES_QUERY_KEY,
    queryFn: fetchFormTemplates,
    select: formTemplatesFromBody,
    ...(options && "enabled" in options ? { enabled: options.enabled } : {}),
  });
}

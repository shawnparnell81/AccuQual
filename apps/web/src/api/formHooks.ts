import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client";
import type { FormDataRecord, FormTemplate, FormVersion } from "../types/forms";

// Every hook here requires a real `entityId` (the NCR/CAPA/... row this form
// is attached to) — there's no "blank new form" flow yet since every "Open
// Form" entry point in the UI opens from a page that already has one.

export function useFormTemplate(formType: string) {
  return useQuery({
    queryKey: ["form-template", formType],
    queryFn: async () => (await apiClient.get<FormTemplate>(`/forms/${formType}/template`)).data,
  });
}

export function useFormData(formType: string, entityId: number) {
  return useQuery({
    queryKey: ["form-data", formType, entityId],
    queryFn: async () => (await apiClient.get<FormDataRecord | null>(`/forms/${formType}/${entityId}`)).data,
  });
}

export function useSaveForm(formType: string, entityId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) =>
      (await apiClient.post<FormDataRecord>(`/forms/${formType}/${entityId}/save`, { entityId, data })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["form-data", formType, entityId] }),
  });
}

export function useCreateFormVersion(formType: string, entityId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await apiClient.post<FormDataRecord>(`/forms/${formType}/${entityId}/version`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["form-data", formType, entityId] });
      queryClient.invalidateQueries({ queryKey: ["form-history", formType, entityId] });
      // "Save version" on the Calibration Record form also writes a real row
      // into `calibrations` server-side (see forms.controller.ts's
      // createVersion) — refresh the equipment list/detail/history queries
      // (all prefixed "equipment") so the due-date and status color pick it
      // up immediately instead of waiting for their own next refetch.
      if (formType === "calibration") {
        queryClient.invalidateQueries({ queryKey: ["equipment"] });
      }
    },
  });
}

export function useFormHistory(formType: string, entityId: number) {
  return useQuery({
    queryKey: ["form-history", formType, entityId],
    queryFn: async () => (await apiClient.get<FormVersion[]>(`/forms/${formType}/${entityId}/history`)).data,
  });
}

/** Fetches the exported PDF as bytes — used for both the inline preview and the download button. */
export async function exportFormPdf(formType: string, entityId: number): Promise<Uint8Array> {
  const response = await apiClient.post(`/forms/${formType}/${entityId}/export`, null, { responseType: "arraybuffer" });
  return new Uint8Array(response.data as ArrayBuffer);
}

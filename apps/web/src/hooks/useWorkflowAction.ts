import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { apiClient } from "../api/client";
import { useToast } from "../components/shared/ToastProvider";

/** Matches AppError's serialized shape (see services/api/src/utils/appError.ts + errorHandler.ts). */
interface ApiErrorBody {
  error?: string;
  message?: string;
}

/** Also used directly by places that don't go through these two hooks (e.g. DocumentRetentionPanel's existing bespoke mutations). */
export function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<ApiErrorBody>;
  return axiosErr.response?.data?.message ?? fallback;
}

/**
 * Same shape as createResourceHooks().useAction(action), plus the toast
 * feedback every transition was missing (see the Workflow UI Components
 * brief, section 3/4) — a 400 from one of the new sequence guards, or a 403
 * from a department gate, used to fail completely silently in every module's
 * detail page. One shared place to fix that instead of copy-pasting an
 * onError into every mutate() call site.
 */
export function useWorkflowAction<TVars extends { id: number } = { id: number } & Record<string, unknown>>(
  resource: string,
  action: string,
  options?: { successMessage?: string; invalidateKeys?: unknown[][] }
): UseMutationResult<unknown, unknown, TVars> {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async ({ id, ...payload }: TVars) => (await apiClient.post(`/${resource}/${id}/${action}`, payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [resource] });
      for (const key of options?.invalidateKeys ?? []) queryClient.invalidateQueries({ queryKey: key });
      toast.success(options?.successMessage ?? `${action.replace(/-/g, " ")} succeeded.`);
    },
    onError: (err) => {
      toast.error(extractErrorMessage(err, `Couldn't ${action.replace(/-/g, " ")} — please try again.`));
    },
  });
}

/** Same idea for the generic PATCH path (crudFactory's update) — used where a transition has no dedicated endpoint yet (see the Transitions/Rules Dictionaries). */
export function useWorkflowUpdate<TVars extends { id: number } = { id: number } & Record<string, unknown>>(
  resource: string,
  options?: { successMessage?: string; invalidateKeys?: unknown[][] }
): UseMutationResult<unknown, unknown, TVars> {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async ({ id, ...payload }: TVars) => (await apiClient.patch(`/${resource}/${id}`, payload)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [resource] });
      for (const key of options?.invalidateKeys ?? []) queryClient.invalidateQueries({ queryKey: key });
      toast.success(options?.successMessage ?? "Updated.");
    },
    onError: (err) => {
      toast.error(extractErrorMessage(err, "Couldn't update — please try again."));
    },
  });
}

import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import { apiClient } from "../api/client";
import { useToast } from "../components/shared/ToastProvider";

/** Matches AppError's serialized shape (see services/api/src/utils/appError.ts + errorHandler.ts). */
interface ApiErrorBody {
  error?: string;
  message?: string;
  /** Present on every API error (also in the X-Request-Id header): the reference that finds this request in the server logs. */
  requestId?: string;
}

/**
 * Also used directly by places that don't go through these two hooks (e.g.
 * DocumentRetentionPanel's existing bespoke mutations).
 *
 * A request made with `responseType: "arraybuffer"` or `"blob"` (PDF/file
 * export/preview — see api/formHooks.ts's exportFormPdf) gets its ERROR body
 * decoded the same way as a successful one: axios hands back the server's
 * real JSON error as raw bytes, not a parsed object, so `data.message` was
 * always undefined and every failure — whatever the real cause — silently
 * fell back to the caller's generic fallback text (reported as "the Preview/
 * Export PDF button is stuck on 'save it first'" regardless of what actually
 * went wrong). Decode + parse that shape here so the real server message
 * always surfaces.
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<ApiErrorBody | ArrayBuffer | Blob>;
  const data = axiosErr.response?.data;

  if (data instanceof ArrayBuffer) {
    try {
      return (JSON.parse(new TextDecoder().decode(data)) as ApiErrorBody).message ?? fallback;
    } catch {
      return fallback;
    }
  }

  // Blob is async-only to read; synchronously we can only fall back — see
  // extractErrorMessageAsync below for callers that can await it.
  if (typeof Blob !== "undefined" && data instanceof Blob) return fallback;

  const body = data as ApiErrorBody | undefined;
  const message = body?.message ?? fallback;
  // A server fault is not something the user can fix, so give them something to quote instead of a bare "unexpected error".
  const status = axiosErr.response?.status ?? 0;
  return status >= 500 && body?.requestId ? `${message} (reference ${body.requestId.slice(0, 8)})` : message;
}

/** Same decoding as extractErrorMessage, but awaits a Blob error body too (axios `responseType: "blob"`) — use where the call site is already async. */
export async function extractErrorMessageAsync(err: unknown, fallback: string): Promise<string> {
  const axiosErr = err as AxiosError<ApiErrorBody | ArrayBuffer | Blob>;
  const data = axiosErr.response?.data;

  if (typeof Blob !== "undefined" && data instanceof Blob) {
    try {
      return (JSON.parse(await data.text()) as ApiErrorBody).message ?? fallback;
    } catch {
      return fallback;
    }
  }

  return extractErrorMessage(err, fallback);
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

import { apiClient } from "../api/client";

export const BEGIN_EDIT_TIMEOUT_MS = 8000;
export const BEGIN_EDIT_ERROR = "Couldn't open this form for editing. Try again.";

/** Unlock request. Times out instead of leaving the Edit button on Opening. */
export async function postBeginEdit(path: string, timeoutMs = BEGIN_EDIT_TIMEOUT_MS): Promise<void> {
  await apiClient.post(path, {}, { timeout: timeoutMs });
}

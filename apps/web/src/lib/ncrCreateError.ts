import type { AxiosError } from "axios";

export interface NcrLogFailure {
  message: string;
  /** The create failed because the server or the network failed. The title was not the problem. */
  retry: boolean;
}

function statusOf(err: unknown): number | undefined {
  const response = (err as AxiosError | undefined)?.response;
  return typeof response?.status === "number" ? response.status : undefined;
}

function serverMessage(err: unknown): string {
  const data = (err as AxiosError<{ message?: string }> | undefined)?.response?.data;
  return typeof data?.message === "string" ? data.message.trim() : "";
}

/**
 * A 5xx or a dropped connection is a server problem. Only a validation
 * response that names the title may tell the user to check it.
 */
export function ncrLogFailure(err: unknown): NcrLogFailure {
  const status = statusOf(err);
  const message = serverMessage(err);
  if (status == null || status >= 500) {
    return { message: "The server couldn't log this NCR. Try again.", retry: true };
  }
  if (status === 400 && /title/i.test(message)) return { message, retry: false };
  if (message) return { message, retry: false };
  return { message: "Couldn't log this NCR. Try again.", retry: false };
}

import { useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { useAuthStore } from "../store/authStore";
import { cachedCompanyLogoFor, currentCompanyLogo, rememberCompanyLogo } from "./companyLogoCache";

const inflight = new Map<string, Promise<string | null>>();

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * Settings stores a logo address. The image request does not send the access
 * token, so the bytes come from GET /company/logo and are inlined before paint
 * and before print. A missing logo stays empty.
 */
export async function loadCompanyLogo(sourceUrl: string | null | undefined): Promise<string | null> {
  const url = sourceUrl?.trim() ?? "";
  if (!url) {
    rememberCompanyLogo("", null);
    return null;
  }
  if (url.startsWith("data:image/")) {
    rememberCompanyLogo(url, url);
    return url;
  }
  const known = cachedCompanyLogoFor(url);
  if (known !== undefined) return known;
  const pending = inflight.get(url);
  if (pending) return pending;
  const job = (async () => {
    try {
      const response = await apiClient.get<ArrayBuffer>("/company/logo", { responseType: "arraybuffer" });
      const bytes = response.data ? new Uint8Array(response.data) : new Uint8Array();
      const type = String(response.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
      if (response.status === 204 || bytes.byteLength === 0 || !type.startsWith("image/")) {
        rememberCompanyLogo(url, null);
        return null;
      }
      const dataUrl = bytesToDataUrl(bytes, type);
      rememberCompanyLogo(url, dataUrl);
      return dataUrl;
    } catch {
      return currentCompanyLogo();
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, job);
  return job;
}

/** `pending` is true only while a stored logo is still being fetched. */
export function useCompanyLogo(): { src: string | null; pending: boolean } {
  const logoUrl = useAuthStore((state) => state.company?.branding?.logoUrl)?.trim() ?? "";
  const [src, setSrc] = useState<string | null>(() => (logoUrl ? (cachedCompanyLogoFor(logoUrl) ?? null) : null));
  const [pending, setPending] = useState(() => Boolean(logoUrl) && cachedCompanyLogoFor(logoUrl) === undefined);

  useEffect(() => {
    let live = true;
    if (!logoUrl) {
      rememberCompanyLogo("", null);
      setSrc(null);
      setPending(false);
      return () => {
        live = false;
      };
    }
    const known = cachedCompanyLogoFor(logoUrl);
    if (known !== undefined) {
      setSrc(known);
      setPending(false);
      return () => {
        live = false;
      };
    }
    setPending(true);
    void loadCompanyLogo(logoUrl).then((next) => {
      if (!live) return;
      setSrc(next);
      setPending(false);
    });
    return () => {
      live = false;
    };
  }, [logoUrl]);

  return { src, pending };
}

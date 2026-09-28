import { createHash } from "node:crypto";
import type { Response } from "express";
import { AppError } from "../../utils/appError.js";
import { sendStoredFile } from "../../utils/storedFile.js";
import { buildEditorConfig } from "./editorConfig.js";
import { onlyOfficeSettings } from "./settings.js";
import { signOfficeToken } from "./token.js";

export function officeViewer(value: unknown): "desktop" | "mobile" {
  return value === "mobile" ? "mobile" : "desktop";
}

/** Stable document key material when a file has no stored checksum. */
export function contentKey(...parts: Array<string | number | null | undefined>): string {
  return createHash("sha256").update(parts.map((part) => String(part ?? "")).join(":")).digest("hex");
}

/** Streams one stored file to ONLYOFFICE. The signed token is the only way to reach this. Images and PDFs may display; other types download. */
export async function streamStoredFile(res: Response, filePath: string, mimeType: string, _sizeBytes: number | undefined, fileName: string) {
  await sendStoredFile(res, filePath, fileName, mimeType, "preview");
}

/** A read-only ONLYOFFICE session. Nothing here can save. */
export function viewOfficeSession(input: {
  fileId: number;
  fileName: string;
  sha256: string;
  user: { id: number; name: string };
  fileToken: string;
  fileRoute: "attachment-file" | "folder-file";
  viewer: "desktop" | "mobile";
}) {
  const settings = onlyOfficeSettings();
  if (!settings) throw new AppError("Office editing is not configured on this server.", 503);
  const callbackToken = signOfficeToken(settings.jwtSecret, "oo-view-callback", { userId: input.user.id, fileId: input.fileId });
  const config = buildEditorConfig(
    {
      fileId: input.fileId,
      fileName: input.fileName,
      sha256: input.sha256,
      mode: "view",
      viewer: input.viewer,
      user: input.user,
      fileUrl: `${settings.apiBaseUrl}/onlyoffice/${input.fileRoute}?token=${encodeURIComponent(input.fileToken)}`,
      callbackUrl: `${settings.apiBaseUrl}/onlyoffice/view-callback?token=${encodeURIComponent(callbackToken)}`,
    },
    settings.jwtSecret,
  );
  return { documentServerUrl: settings.publicUrl, mode: "view" as const, fileId: input.fileId, config };
}

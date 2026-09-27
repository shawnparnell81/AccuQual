import { apiClient } from "./client";

export interface OfficeSession {
  documentServerUrl: string;
  mode: "view" | "edit";
  fileId: number;
  config: Record<string, unknown>;
}

export function isOfficeFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".docx") || lower.endsWith(".xlsx") || lower.endsWith(".pptx");
}

export type OfficeSource =
  | { kind: "document"; documentId: number; versionId: number; fileId: number; viewOnly?: boolean }
  | { kind: "attachment"; attachmentId: number }
  | { kind: "folder"; folderId: number };

function viewerForScreen(): "desktop" | "mobile" {
  if (typeof window === "undefined") return "desktop";
  return window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop";
}

/** Opens ONLYOFFICE. A preview passes viewOnly so a draft still opens read-only. */
export async function openOfficeSource(source: OfficeSource): Promise<OfficeSession> {
  const viewer = viewerForScreen();
  if (source.kind === "attachment") {
    const { data } = await apiClient.get<OfficeSession>(`/attachments/${source.attachmentId}/office-session`, { params: { viewer } });
    return data;
  }
  if (source.kind === "folder") {
    const { data } = await apiClient.get<OfficeSession>(`/document-folders/${source.folderId}/office-session`, { params: { viewer } });
    return data;
  }
  const { data } = await apiClient.get<OfficeSession>("/onlyoffice/session", {
    params: {
      documentId: source.documentId,
      versionId: source.versionId,
      fileId: source.fileId,
      mode: source.viewOnly ? "view" : undefined,
      viewer,
    },
  });
  return data;
}

export async function openOfficeSession(documentId: number, versionId: number, fileId: number): Promise<OfficeSession> {
  return openOfficeSource({ kind: "document", documentId, versionId, fileId });
}

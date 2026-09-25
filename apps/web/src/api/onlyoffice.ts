import { apiClient } from "./client";

export interface OfficeSession {
  documentServerUrl: string;
  mode: "view" | "edit";
  fileId: number;
  config: Record<string, unknown>;
}

export function isOfficeFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".docx") || lower.endsWith(".xlsx");
}

export async function openOfficeSession(documentId: number, versionId: number, fileId: number): Promise<OfficeSession> {
  const { data } = await apiClient.get<OfficeSession>("/onlyoffice/session", { params: { documentId, versionId, fileId } });
  return data;
}

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "./client";
import type { AccuQualDocument } from "./types";
import type { VersionFull } from "./versioning";

// Client for controlled-document versioning (services/api/src/modules/documents). The lifecycle itself (draft, review,
// publish, rollback, diff) is the shared engine, used through useVersioning("/documents", id); this file adds what is
// specific to documents: the revision's shape, files, links, and the reviewer list.

export type LinkType = "workflow" | "equipment" | "supplier" | "ncr" | "capa" | "audit" | "training";

export const LINK_TYPES: { value: LinkType; label: string; route: (id: number) => string }[] = [
  { value: "equipment", label: "Equipment", route: (id) => `/calibration/${id}` },
  { value: "supplier", label: "Supplier", route: (id) => `/suppliers/${id}` },
  { value: "workflow", label: "Workflow", route: (id) => `/workflow/${id}` },
  { value: "ncr", label: "NCR", route: (id) => `/ncr/${id}` },
  { value: "capa", label: "CAPA", route: (id) => `/capa/${id}` },
  { value: "audit", label: "Audit", route: (id) => `/audits/${id}` },
  { value: "training", label: "Training", route: (id) => `/training/${id}` },
];
export const linkTypeLabel = (t: LinkType) => LINK_TYPES.find((x) => x.value === t)?.label ?? t;

export interface DocumentLink {
  type: LinkType;
  id: number;
  label: string;
}

export interface DocumentAttachmentRef {
  id: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

/** What one revision of a controlled document holds. */
export interface DocumentPayload {
  title: string;
  category: string | null;
  content: string;
  revisionCode: string;
  effectiveDate: string | null;
  expirationDate: string | null;
  retentionPeriodDays: number | null;
  attachments: DocumentAttachmentRef[];
  links: DocumentLink[];
}

export type DocumentVersion = VersionFull<DocumentPayload>;

export const ACCEPTED_FILES = ".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.gif,.webp";

export function useLinkTargets(type: LinkType, q: string, enabled = true) {
  return useQuery<{ id: number; label: string }[]>({
    queryKey: ["document-link-targets", type, q],
    queryFn: async () => (await apiClient.get("/documents/link-targets", { params: { type, q } })).data,
    enabled,
    staleTime: 10_000,
  });
}

export interface LinkHistoryEntry {
  type: LinkType;
  id: number;
  label: string;
  typeLabel: string;
  firstVersion: number;
  lastVersion: number;
  inForce: boolean;
  versions: number[];
}

export function useLinkHistory(documentId: number) {
  return useQuery<{ newestVersion: number; links: LinkHistoryEntry[] }>({
    queryKey: ["document-link-history", documentId],
    queryFn: async () => (await apiClient.get(`/documents/${documentId}/link-history`)).data,
  });
}

export function useReviewers() {
  return useQuery<{ id: number; name: string | null; email: string; role: string }[]>({
    queryKey: ["document-reviewers"],
    queryFn: async () => (await apiClient.get("/documents/reviewers")).data,
    staleTime: 60_000,
  });
}

export async function uploadAttachment(documentId: number, versionId: number, file: File): Promise<{ attachment: DocumentAttachmentRef; version: DocumentVersion }> {
  const form = new FormData();
  form.append("file", file);
  return (await apiClient.post(`/documents/${documentId}/version/${versionId}/attachments`, form)).data;
}

export async function removeAttachment(documentId: number, versionId: number, attachmentId: number): Promise<void> {
  await apiClient.delete(`/documents/${documentId}/version/${versionId}/attachments/${attachmentId}`);
}

/** Opens a file of one revision through a short-lived signed link (the API issues it, and audits its use). */
export async function openAttachment(documentId: number, versionId: number, attachmentId: number): Promise<void> {
  const { data } = await apiClient.get<{ url: string }>(`/documents/${documentId}/version/${versionId}/attachments/${attachmentId}/url`);
  window.open(`${apiClient.defaults.baseURL ?? ""}${data.url}`, "_blank", "noopener");
}

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Controlled-document row as GET /documents returns it, including the soft-delete flag the list type otherwise omits. */
export type ControlledDocumentOption = AccuQualDocument & { isDeleted?: boolean };

export function controlledDocumentLabel(doc: Pick<ControlledDocumentOption, "title" | "revisionCode">): string {
  return doc.revisionCode ? `${doc.title} (${doc.revisionCode})` : doc.title;
}

/** Label for a stored required-document id. Unknown or removed rows stay removable as "Document #id". */
export function labelForRequiredDocument(id: string, documents: ControlledDocumentOption[] | undefined): string {
  const doc = documents?.find((d) => String(d.id) === id);
  return doc ? controlledDocumentLabel(doc) : `Document #${id}`;
}

/** Same query key as ResourceListPage's documents list (`["documents", undefined]`). */
export function useControlledDocuments(enabled = true) {
  return useQuery<ControlledDocumentOption[]>({
    queryKey: ["documents", undefined],
    queryFn: async () => (await apiClient.get<ControlledDocumentOption[]>("/documents")).data,
    enabled,
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client";

// Client for the shared draft -> review -> publish engine (services/api/src/modules/versioning). The same eight endpoints
// serve workflows (/workflow/:id/...), Management Review (/management-review/1/...) and Context of the Organization
// (/context/1/...), so one hook set drives all three screens.

export type VersionStatus = "draft" | "in_review" | "published" | "archived";

export interface VersionSummary {
  id: number;
  subjectType: string;
  subjectId: number;
  versionNumber: number;
  status: VersionStatus;
  metadata: { summary?: string; bootstrapped?: boolean; note?: string } & Record<string, unknown>;
  basedOnVersion: number | null;
  isRollback: boolean;
  createdBy: number | null;
  createdAt: string | null;
  createdByName?: string | null;
  updatedAt: string | null;
  submittedBy: number | null;
  submittedAt: string | null;
  submittedByName?: string | null;
  reviewedBy: number | null;
  reviewedAt: string | null;
  reviewedByName?: string | null;
  reviewDecision: "approved" | "rejected" | null;
  reviewNotes: string | null;
  publishedBy: number | null;
  publishedAt: string | null;
  publishedByName?: string | null;
}

export interface VersionFull<P = Record<string, unknown>> extends VersionSummary {
  payload: P;
}

export interface CurrentState<P = Record<string, unknown>> {
  published: VersionFull<P> | null;
  open: VersionFull<P> | null;
}

export interface DiffEntry {
  change: "added" | "removed" | "changed";
  scope: "node" | "transition" | "metadata" | "field" | "row" | "content" | "attachment" | "link";
  key: string;
  label: string;
  from?: unknown;
  to?: unknown;
  details?: { field: string; from: unknown; to: unknown }[];
  /** A text body's line-by-line comparison (controlled documents). */
  lines?: { op: "add" | "del" | "same"; text: string }[];
}
export interface VersionDiff {
  from: { id: number; versionNumber: number; status: VersionStatus } | null;
  to: { id: number; versionNumber: number; status: VersionStatus };
  entries: DiffEntry[];
  summary: { added: number; removed: number; changed: number };
}

export interface ValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
  edge?: string;
}
export interface ValidationReport {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/** Roles that may review and publish — mirrors REVIEWER_ROLES on the server, which is what actually enforces it. */
export const REVIEWER_ROLES = ["admin", "platform_admin", "quality_manager"];

export function useVersioning<P = Record<string, unknown>>(basePath: string, id: number) {
  const queryClient = useQueryClient();
  const root = `${basePath}/${id}`;
  const key = ["versioning", basePath, id];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

  const current = useQuery<CurrentState<P>>({ queryKey: [...key, "current"], queryFn: async () => (await apiClient.get(`${root}/current`)).data });
  const versions = useQuery<VersionSummary[]>({ queryKey: [...key, "versions"], queryFn: async () => (await apiClient.get(`${root}/versions`)).data });

  const createDraft = useMutation({
    mutationFn: async (input: { summary?: string } = {}) => (await apiClient.post<VersionFull<P>>(`${root}/draft`, input)).data,
    onSuccess: invalidate,
  });
  const saveDraft = useMutation({
    mutationFn: async ({ versionId, payload, summary }: { versionId: number; payload?: P; summary?: string }) => (await apiClient.put<VersionFull<P>>(`${root}/versions/${versionId}`, { payload, summary })).data,
    // Autosave: no refetch per keystroke — the editor already holds the truth. Keep the cached open version current so
    // switching to another version and back doesn't show stale content.
    onSuccess: (saved) => {
      queryClient.setQueryData<CurrentState<P>>([...key, "current"], (old) => (old && old.open?.id === saved.id ? { ...old, open: { ...old.open, ...saved } } : old));
    },
  });
  const discard = useMutation({ mutationFn: async (versionId: number) => apiClient.delete(`${root}/versions/${versionId}`), onSuccess: invalidate });
  const review = useMutation({
    mutationFn: async (input: { versionId: number; action: "request" | "approve" | "reject"; notes?: string; reviewerId?: number }) => (await apiClient.post<VersionFull<P>>(`${root}/review`, input)).data,
    onSuccess: invalidate,
  });
  const publish = useMutation({
    mutationFn: async (versionId: number) => (await apiClient.post<VersionFull<P>>(`${root}/publish`, { versionId })).data,
    onSuccess: () => {
      void invalidate();
      // The live record changed under whatever else is on screen (the workflow list, the health report, ...).
      void queryClient.invalidateQueries({ queryKey: ["workflow"] });
    },
  });
  const rollback = useMutation({
    mutationFn: async (versionNumber: number) => (await apiClient.post<VersionFull<P>>(`${root}/rollback`, { versionNumber })).data,
    onSuccess: invalidate,
  });

  return { root, current, versions, createDraft, saveDraft, discard, review, publish, rollback };
}

export function useVersionPayload<P = Record<string, unknown>>(basePath: string, id: number, versionId: number | null) {
  return useQuery<VersionFull<P>>({
    queryKey: ["versioning", basePath, id, "version", versionId],
    queryFn: async () => (await apiClient.get(`${basePath}/${id}/versions/${versionId}`)).data,
    enabled: versionId !== null,
  });
}

export function useVersionDiff(basePath: string, id: number, versionId: number | null, againstId?: number | null) {
  return useQuery<VersionDiff>({
    queryKey: ["versioning", basePath, id, "diff", versionId, againstId ?? "previous"],
    queryFn: async () => (await apiClient.get(`${basePath}/${id}/version/${versionId}/diff`, { params: againstId ? { against: againstId } : undefined })).data,
    enabled: versionId !== null,
    staleTime: 0,
    gcTime: 0,
  });
}

export async function validatePayload(basePath: string, id: number, payload: unknown): Promise<ValidationReport> {
  return (await apiClient.post(`${basePath}/${id}/validate`, { payload })).data;
}

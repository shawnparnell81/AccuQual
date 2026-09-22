import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client";
import type { CalendarItem } from "../hooks/useCalendarItems";

// Client for Worker Runtime (services/api/src/modules/worker) — a small profile on top of `users`, plus a read-only activity
// view reused from the existing per-user Calendar aggregator rather than a second one.

export const EMPLOYMENT_STATUSES = ["active", "on_leave", "terminated"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const EMPLOYMENT_STATUS_LABEL: Record<EmploymentStatus, string> = {
  active: "Active",
  on_leave: "On leave",
  terminated: "Terminated",
};

export interface WorkerProfile {
  userId: number;
  name: string | null;
  email: string;
  department: string | null;
  roleName: string | null;
  isActive: boolean;
  jobTitle: string | null;
  shift: string | null;
  hireDate: string | null;
  skills: string[];
  employmentStatus: EmploymentStatus;
  notes: string | null;
  updatedAt: string | null;
}

export interface WorkerDetail {
  profile: WorkerProfile;
  activity: CalendarItem[];
}

export interface UpsertWorkerProfileInput {
  jobTitle?: string | null;
  shift?: string | null;
  hireDate?: string | null;
  skills?: string[];
  employmentStatus?: EmploymentStatus;
  notes?: string | null;
}

export function useWorkers() {
  return useQuery<WorkerProfile[]>({ queryKey: ["workers"], queryFn: async () => (await apiClient.get("/workers")).data });
}

export function useWorker(userId: number) {
  return useQuery<WorkerDetail>({ queryKey: ["workers", userId], queryFn: async () => (await apiClient.get(`/workers/${userId}`)).data, enabled: Number.isFinite(userId) });
}

export function useMyWorkerProfile() {
  return useQuery<WorkerDetail>({ queryKey: ["workers", "me"], queryFn: async () => (await apiClient.get("/workers/me")).data });
}

export function useUpsertWorkerProfile(userId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertWorkerProfileInput) => (await apiClient.patch<WorkerProfile>(`/workers/${userId}`, input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workers"] });
    },
  });
}

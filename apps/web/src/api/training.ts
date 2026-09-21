import { useQuery } from "@tanstack/react-query";
import { apiClient } from "./client";
import { REVIEWER_ROLES } from "./versioning";
import { useCurrentUser } from "../hooks/useAuth";

// Client for training & competency (services/api/src/modules/training).

export type QualificationStatus = "qualified" | "expiring_soon" | "expired" | "revision_changed" | "failed" | "awaiting_evaluation" | "overdue" | "in_progress" | "assigned" | "not_trained";

export const QUALIFICATION_LABEL: Record<QualificationStatus, string> = {
  qualified: "Qualified",
  expiring_soon: "Expires soon",
  expired: "Expired",
  revision_changed: "Document revised — retrain",
  failed: "Failed evaluation",
  awaiting_evaluation: "Awaiting evaluation",
  overdue: "Overdue",
  in_progress: "In progress",
  assigned: "Assigned",
  not_trained: "Not trained",
};

export interface CourseRequirements {
  evaluationRequired?: boolean;
  passingScore?: number;
  criteria?: string[];
  instructions?: string;
}

export interface CourseFull {
  id: number;
  title: string;
  description: string | null;
  requiredForRoleId: number | null;
  requiredForDepartment: string | null;
  requirements: CourseRequirements;
  validityMonths: number | null;
  active: boolean;
  documentId: number | null;
}

export interface StatusRow {
  userId: number;
  userName: string | null;
  email: string;
  department: string | null;
  courseId: number;
  courseTitle: string;
  required: boolean;
  status: QualificationStatus;
  expiresAt: string | null;
  lastCompletedAt: string | null;
  openAssignmentId: number | null;
  dueAt: string | null;
}

export interface AttendanceEntry {
  userId: number;
  status: "present" | "absent" | "excused";
  notes?: string;
}

export interface SessionRow {
  id: number;
  courseId: number;
  courseTitle: string;
  title: string | null;
  instructorName: string | null;
  location: string | null;
  capacity: number | null;
  scheduledAt: string;
  status: "scheduled" | "completed" | "cancelled";
  completedAt: string | null;
  attendance: AttendanceEntry[];
  enrolled: number;
  attended: number;
  notes: string | null;
}

export interface CompetencyRow {
  id: number;
  userId: number;
  userName: string | null;
  userEmail: string;
  courseId: number;
  courseTitle: string;
  status: "pending" | "pass" | "fail";
  score: number | null;
  evaluatedAt: string | null;
  expiresAt: string | null;
  evaluatorId: number | null;
  evaluation: { score?: number; criteria?: { name: string; result: string; notes?: string }[]; notes?: string };
  notes: string | null;
}

export interface Person {
  id: number;
  name: string | null;
  email: string;
}

export const DEPARTMENTS = ["quality", "engineering", "production", "customer_service", "purchasing", "material_management", "sales_and_marketing"];
export const departmentLabel = (d: string) => d.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export function useStatusRows(filters: { courseId?: number; userId?: number; status?: string }) {
  return useQuery<StatusRow[]>({ queryKey: ["training", "status", filters], queryFn: async () => (await apiClient.get("/training/status", { params: filters })).data });
}
export function useAttention() {
  return useQuery<StatusRow[]>({ queryKey: ["training", "attention"], queryFn: async () => (await apiClient.get("/training/attention")).data });
}
export function useSessions(filters: { courseId?: number; status?: string }) {
  return useQuery<SessionRow[]>({ queryKey: ["training", "sessions", filters], queryFn: async () => (await apiClient.get("/training/sessions", { params: filters })).data });
}
export function useCompetencies(filters: { courseId?: number; userId?: number }) {
  return useQuery<CompetencyRow[]>({ queryKey: ["training", "competency", filters], queryFn: async () => (await apiClient.get("/training/competency", { params: filters })).data });
}
export function usePeople() {
  return useQuery<Person[]>({ queryKey: ["training", "people"], queryFn: async () => (await apiClient.get("/training/employees")).data, staleTime: 60_000 });
}

/** May this person manage training? The server decides; this only decides which buttons show. */
export function useTrainingAccess() {
  const user = useCurrentUser();
  const reviewer = !!user?.roleName && REVIEWER_ROLES.includes(user.roleName);
  return { mayManage: reviewer || user?.department === "quality" };
}

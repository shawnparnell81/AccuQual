export interface Ncr {
  id: number;
  title: string;
  description: string | null;
  status: "open" | "contained" | "investigating" | "corrective_action" | "closed";
  severity: "low" | "medium" | "high" | "critical" | null;
  containment: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  assignedTo: number | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface Capa {
  id: number;
  ncrId: number | null;
  rootCause: string | null;
  actionPlan: string | null;
  preventiveAction: string | null;
  verification: string | null;
  status: "open" | "in_progress" | "verifying" | "closed";
  ownerId: number | null;
  createdAt: string;
}

export interface Audit {
  id: number;
  name: string;
  type: string | null;
  status: "scheduled" | "in_progress" | "completed";
  auditorId: number | null;
  scheduledAt: string | null;
  completedAt: string | null;
}

export interface AccuQualDocument {
  id: number;
  title: string;
  category: string | null;
  currentVersion: number;
  status: "draft" | "in_review" | "approved" | "obsolete";
  ownerId: number | null;
  expirationDate: string | null;
  expirationWarningDays: number;
  retentionPeriodDays: number;
  retentionAction: "archive" | "delete";
  retentionState: "active" | "archived";
}

export interface TrainingCourse {
  id: number;
  title: string;
  description: string | null;
  requiredForRoleId: number | null;
  documentId: number | null;
}

export interface TrainingAssignment {
  id: number;
  courseId: number;
  userId: number;
  status: "assigned" | "in_progress" | "completed" | "overdue";
  dueAt: string | null;
  completedAt: string | null;
  trainerName: string | null;
  notes: string | null;
  certificatePath: string | null;
  userEmail?: string | null;
  userName?: string | null;
  courseTitle?: string | null;
  documentId?: number | null;
}

export interface DocumentVersion {
  id: number;
  documentId: number;
  version: number;
  fileUrl: string | null;
  changeNotes: string | null;
  approvedBy: number | null;
  approvedAt: string | null;
  approvalNotes: string | null;
  createdBy: number | null;
  createdAt: string;
}

export interface Supplier {
  id: number;
  name: string;
  contactEmail: string | null;
  status: "active" | "probation" | "disqualified";
  riskLevel: string | null;
}

export interface AiSuggestion {
  id: number;
  module: string | null;
  pipeline: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  confidence: string | null;
  createdAt: string;
}

export interface DigitalTwinModel {
  id: number;
  name: string;
  description: string | null;
  modelJson: { nodes: unknown[]; edges: unknown[] };
}

export interface WorkflowDefinition {
  id: number;
  name: string;
  module: string | null;
  definition: { nodes: unknown[]; edges: unknown[] };
}

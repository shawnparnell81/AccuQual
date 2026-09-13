import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, Paperclip } from "lucide-react";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { TextAreaField } from "../../components/forms/Field";
import { TrainingAssignmentModal } from "../../components/training/TrainingAssignmentModal";
import { TrainingCompletionModal } from "../../components/training/TrainingCompletionModal";
import { DocumentApprovalModal } from "../../components/documents/DocumentApprovalModal";
import { DocumentRevisionModal } from "../../components/documents/DocumentRevisionModal";
import { DocumentRetentionPanel } from "../../components/documents/DocumentRetentionPanel";
import { DocumentHistoryPanel } from "../../components/documents/DocumentHistoryPanel";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { AiFieldAssistant } from "../../components/shared/AiFieldAssistant";
import { useSetAssistantContext } from "../../hooks/useAssistantContext";
import type { AccuQualDocument, TrainingAssignment, TrainingCourse } from "../../api/types";

const trainingHooks = createResourceHooks<TrainingCourse>("training");

/**
 * Training course detail: the course's material (a controlled document once
 * linked — reuses Document Control's approval/revision/retention/history
 * wholesale rather than a parallel "training material" version of the same
 * system) plus its assignment list, one row per employee with the two ways
 * to complete it — the real "Training Record" form (entityId = that
 * assignment, see layouts/training.ts) or the quick TrainingCompletionModal.
 */
export function TrainingDetailPage() {
  const { id } = useParams();
  const courseId = Number(id);
  const { data: course, isLoading } = trainingHooks.useOne(courseId);
  useSetAssistantContext("training", courseId, course ? course.title : `Training Course #${courseId}`);
  const updateCourse = trainingHooks.useUpdate();
  const [assignOpen, setAssignOpen] = useState(false);
  const [completingId, setCompletingId] = useState<number | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);

  const { data: assignments = [] } = useQuery<TrainingAssignment[]>({
    queryKey: ["training-assignments", courseId],
    queryFn: async () => (await apiClient.get(`/training/${courseId}/assignments`)).data,
    enabled: !!course,
  });
  const { data: material } = useQuery<AccuQualDocument>({
    queryKey: ["documents", course?.documentId],
    queryFn: async () => (await apiClient.get(`/documents/${course!.documentId}`)).data,
    enabled: !!course?.documentId,
  });

  async function viewCertificate(assignmentId: number) {
    const res = await apiClient.get(`/training/assignment/${assignmentId}/certificate`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data as Blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  if (isLoading || !course) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{course.title}</h1>
        <button onClick={() => setAssignOpen(true)} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          Assign Training
        </button>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Description / Content</h2>
          <AiFieldAssistant
            module="training_builder"
            recordId={courseId}
            triggerLabel="Build Training Content"
            buildInitialPrompt={() =>
              `Build training content for "${course.title}". Generate a short outline of learning objectives, a bulleted list of the key` +
              " points to cover (summarizing the linked material if one is noted in context), and 3-5 quiz questions with answers to" +
              " check understanding. Keep the difficulty appropriate for a general workforce refresher unless the course title suggests" +
              " otherwise."
            }
            onInsert={(text) => updateCourse.mutate({ id: courseId, description: text })}
            insertLabel="Insert as Description"
          />
        </div>
        <TextAreaField
          label=""
          value={course.description ?? ""}
          placeholder="No description provided."
          onChange={(e) => updateCourse.mutate({ id: courseId, description: e.target.value })}
        />
      </div>

      {material ? (
        <>
          <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
            <div>
              <h2 className="text-sm font-medium">Training Material — {material.title}</h2>
              <p className="text-sm text-muted-foreground capitalize">Status: {material.status.replace("_", " ")}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setReviseOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
                Revise
              </button>
              <button
                onClick={() => setApproveOpen(true)}
                disabled={material.status === "approved" || material.status === "obsolete"}
                className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40"
              >
                Approve
              </button>
            </div>
          </div>
          <DocumentRetentionPanel document={material} />
          <DocumentHistoryPanel documentId={material.id} />
          <DocumentApprovalModal documentId={material.id} isOpen={approveOpen} onClose={() => setApproveOpen(false)} />
          <DocumentRevisionModal documentId={material.id} isOpen={reviseOpen} onClose={() => setReviseOpen(false)} />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          No controlled document linked to this course's material yet — link one via <code>PATCH /training/{courseId}</code>{" "}
          <code>{"{ documentId }"}</code> to get approval, revision, expiration, and retention tracking.
        </p>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Assignments</h2>
          <AiFieldAssistant
            module="training"
            recordId={courseId}
            triggerLabel="AI Compliance Summary"
            buildInitialPrompt={() =>
              `Summarize training compliance for "${course.title}" using the assignment counts provided. Call out how urgent any overdue` +
              " assignments are, and suggest concrete follow-up actions for getting the remaining employees compliant."
            }
          />
        </div>
        <ul className="flex flex-col gap-2 text-sm">
          {assignments.length === 0 && <li className="text-muted-foreground">No employees assigned yet.</li>}
          {assignments.map((a) => {
            return (
              <li key={a.id} className="flex items-center gap-3 border-b border-border pb-2 last:border-0">
                <Link to={`/training/employee/${a.userId}`} className="w-40 flex-none truncate hover:underline">
                  {a.userName ?? a.userEmail}
                </Link>
                <StatusBadge value={a.status} />
                <span className="flex-1 text-xs text-muted-foreground">
                  {a.completedAt ? `Completed ${new Date(a.completedAt).toLocaleDateString()}` : a.dueAt ? `Due ${new Date(a.dueAt).toLocaleDateString()}` : "No due date"}
                </span>
                {a.certificatePath ? (
                  <button onClick={() => viewCertificate(a.id)} className="flex-none text-primary hover:opacity-80" aria-label="View certificate">
                    <FileText size={14} />
                  </button>
                ) : (
                  <Paperclip size={14} className="flex-none text-muted-foreground" aria-hidden />
                )}
                <OpenFormButton formType="training" entityId={a.id} title={`Training Record — ${a.userName ?? a.userEmail}`} label="Open Record" />
                <button onClick={() => setCompletingId(a.id)} className="flex-none rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                  Quick Complete
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <TrainingAssignmentModal courseId={courseId} isOpen={assignOpen} onClose={() => setAssignOpen(false)} />
      {completingId !== null && <TrainingCompletionModal assignmentId={completingId} isOpen onClose={() => setCompletingId(null)} />}
    </div>
  );
}

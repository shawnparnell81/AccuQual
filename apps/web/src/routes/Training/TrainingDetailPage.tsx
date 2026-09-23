import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, Paperclip } from "lucide-react";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import { OpenFormButton } from "../../components/forms/OpenFormButton";
import { PrintFormButton } from "../../components/forms/PrintFormButton";
import { TextAreaField } from "../../components/forms/Field";
import { TrainingAssignmentModal } from "../../components/training/TrainingAssignmentModal";
import { TrainingCompletionModal } from "../../components/training/TrainingCompletionModal";
import { DocumentRetentionPanel } from "../../components/documents/DocumentRetentionPanel";
import { DocumentHistoryPanel } from "../../components/documents/DocumentHistoryPanel";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { CompetencyPanel, QualificationPanel, RequirementsPanel, SessionsPanel } from "../../components/training/TrainingPanels";
import type { CourseFull } from "../../api/training";
import { AiFieldAssistant } from "../../components/shared/AiFieldAssistant";
import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";
import { useSetAssistantContext } from "../../hooks/useAssistantContext";
import { useTrainingAccess } from "../../api/training";
import { RecordGlance } from "../../components/records/RecordStatus";
import { TRAINING_MANAGE_REASON, duePhrase, isPastDue } from "../../lib/opsLanguage";
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
  const { data: course, isLoading, isError } = trainingHooks.useOne(courseId);
  useSetAssistantContext("training", courseId, course ? course.title : `Training Course #${courseId}`);
  const updateCourse = trainingHooks.useUpdate();
  const { mayManage } = useTrainingAccess();
  const [assignOpen, setAssignOpen] = useState(false);
  const [completingId, setCompletingId] = useState<number | null>(null);

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

  if (isError) return <p className="text-sm text-destructive">Couldn't load this course. Refresh the page and try again.</p>;
  if (isLoading || !course) return <p className="text-sm text-muted-foreground">Loading this course…</p>;

  const openAssignments = assignments.filter((row) => row.status !== "completed");
  const soonest = openAssignments.map((row) => row.dueAt).filter((due): due is string => !!due).sort()[0] ?? null;
  const overdue = openAssignments.filter((row) => row.status === "overdue" || isPastDue(row.dueAt, false));
  const next =
    assignments.length === 0
      ? "Assign the people who need to learn this."
      : overdue.length > 0
        ? `${overdue.length} ${overdue.length === 1 ? "person is" : "people are"} late. Follow up, then record completion${course.requirements?.evaluationRequired ? " and the quiz" : ""}.`
        : course.requirements?.evaluationRequired
          ? "When they finish, record the quiz or evaluation."
          : "Mark people complete as they finish.";

  return (
    <div className="flex flex-col gap-4">
      <RecordGlance
        crumbs={[{ label: "Training", to: "/training" }, { label: course.title }]}
        title={course.title}
        standard="Training course"
        stateValue={course.active ? "active" : "obsolete"}
        stateLabel={course.active ? "Active" : "Retired"}
        owner={assignments.length === 0 ? "Unassigned" : `${assignments.length} assigned`}
        due={duePhrase(soonest, !course.active)}
        dueLate={isPastDue(soonest, !course.active)}
        blocked={overdue.length > 0 ? `${overdue.length} late` : assignments.length === 0 ? "Nobody is assigned" : "People still finishing"}
        next={next}
        accessNote={mayManage ? null : TRAINING_MANAGE_REASON}
        actions={
          mayManage ? (
            <button onClick={() => setAssignOpen(true)} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
              Assign people
            </button>
          ) : undefined
        }
      />
      <div className="rounded-lg border border-border bg-card p-3 text-sm">
        {course.documentId && material ? (
          <p>
            Teaches{" "}
            <Link to={`/documents/${material.id}`} className="text-primary hover:underline">
              {material.title}
            </Link>
            . When that document changes, people on this course need to learn the new revision.
          </p>
        ) : course.documentId ? (
          <p className="text-muted-foreground">
            Linked document #{course.documentId}.{" "}
            <Link to={`/documents/${course.documentId}`} className="text-primary hover:underline">
              Open it
            </Link>
            .
          </p>
        ) : (
          <p className="text-muted-foreground">No controlled document is linked. Link the document this course teaches so a revision can send people back here.</p>
        )}
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
              {/* Revising and approving a controlled document happens on the document itself: draft, review, publish. */}
              <Link to={`/documents/${material.id}`} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
                Open document to revise or approve
              </Link>
            </div>
          </div>
          <DocumentRetentionPanel document={material} />
          <DocumentHistoryPanel documentId={material.id} />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          No controlled document linked to this course's material yet — link one via <code>PATCH /training/{courseId}</code>{" "}
          <code>{"{ documentId }"}</code> to get approval, revision, expiration, and retention tracking.
        </p>
      )}

      <RequirementsPanel course={course as CourseFull} />
      <QualificationPanel courseId={courseId} />
      <SessionsPanel course={course as CourseFull} />
      <CompetencyPanel course={course as CourseFull} />

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
          {assignments.length === 0 && <li className="text-muted-foreground">Nobody is assigned yet. Assign the people who need to learn this.</li>}
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
                {a.expiresAt && <span className="flex-none text-xs text-muted-foreground">valid to {new Date(a.expiresAt).toLocaleDateString()}</span>}
                {a.certificatePath ? (
                  <button onClick={() => viewCertificate(a.id)} className="flex-none text-primary hover:opacity-80" aria-label="View certificate">
                    <FileText size={14} />
                  </button>
                ) : (
                  <Paperclip size={14} className="flex-none text-muted-foreground" aria-hidden />
                )}
                <OpenFormButton formType="training" entityId={a.id} title={`Training Record — ${a.userName ?? a.userEmail}`} label="Open Record" />
                <PrintFormButton formType="training" entityId={a.id} label="Print" />
                <button onClick={() => setCompletingId(a.id)} className="flex-none rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                  Quick Complete
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <AttachmentsPanel entityType="training" entityId={courseId} />

      <TrainingAssignmentModal courseId={courseId} isOpen={assignOpen} onClose={() => setAssignOpen(false)} />
      {completingId !== null && <TrainingCompletionModal assignmentId={completingId} isOpen onClose={() => setCompletingId(null)} />}
    </div>
  );
}

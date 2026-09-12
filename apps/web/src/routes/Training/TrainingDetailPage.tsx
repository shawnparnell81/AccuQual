import { useParams } from "react-router-dom";
import { createResourceHooks } from "../../api/resourceHooks";
import { OpenFormButton } from "../../components/forms/OpenFormButton";

interface TrainingCourse {
  id: number;
  title: string;
  description: string | null;
}

const trainingHooks = createResourceHooks<TrainingCourse>("training");

/** Training course detail: course info plus its fillable training record. */
export function TrainingDetailPage() {
  const { id } = useParams();
  const courseId = Number(id);
  const { data: course, isLoading } = trainingHooks.useOne(courseId);
  const completeAction = trainingHooks.useAction("complete");

  if (isLoading || !course) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{course.title}</h1>
        <div className="flex gap-2">
          <OpenFormButton formType="training" entityId={course.id} title={`Training Course #${course.id} Record`} label="Training Record" />
          <button onClick={() => completeAction.mutate({ id: courseId })} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Mark all assignments complete
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">{course.description || "No description provided."}</div>
    </div>
  );
}

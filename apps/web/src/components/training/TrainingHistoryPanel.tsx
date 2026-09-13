import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import { apiClient } from "../../api/client";
import { StatusBadge } from "../tables/StatusBadge";
import { WorkflowHistoryPanel } from "../shared/WorkflowHistoryPanel";
import type { TrainingAssignment } from "../../api/types";

async function viewCertificate(assignmentId: number) {
  const res = await apiClient.get(`/training/assignment/${assignmentId}/certificate`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Every training record for one employee, across every course they've been assigned. */
export function TrainingHistoryPanel({ userId }: { userId: number }) {
  const { data: records = [] } = useQuery<TrainingAssignment[]>({
    queryKey: ["training-employee-history", userId],
    queryFn: async () => (await apiClient.get(`/training/employee/${userId}/history`)).data,
  });

  const sorted = [...records].sort((a, b) => new Date(b.completedAt ?? b.dueAt ?? 0).getTime() - new Date(a.completedAt ?? a.dueAt ?? 0).getTime());

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium">Training History</h3>
      <ul className="flex flex-col gap-2 text-sm">
        {sorted.length === 0 && <li className="text-muted-foreground">No training records yet.</li>}
        {sorted.map((r) => {
          return (
            <li key={r.id} className="flex flex-col gap-1 border-b border-border pb-2 last:border-0">
              <div className="flex items-center gap-3">
                <span className="flex-1 font-medium">
                  {r.documentId ? (
                    <Link to={`/documents/${r.documentId}`} className="hover:underline">
                      {r.courseTitle ?? `Course #${r.courseId}`}
                    </Link>
                  ) : (
                    r.courseTitle ?? `Course #${r.courseId}`
                  )}
                </span>
                <StatusBadge value={r.status} />
                {r.certificatePath && (
                  <button onClick={() => viewCertificate(r.id)} className="text-primary hover:opacity-80" aria-label="View certificate">
                    <FileText size={14} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {r.completedAt && <span>Completed {new Date(r.completedAt).toLocaleDateString()}</span>}
                {r.dueAt && !r.completedAt && <span>Due {new Date(r.dueAt).toLocaleDateString()}</span>}
                {r.trainerName && <span>Trainer: {r.trainerName}</span>}
              </div>
              {r.notes && <p className="text-xs text-muted-foreground">{r.notes}</p>}
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Audit trail</summary>
                <div className="mt-1 pl-3">
                  <WorkflowHistoryPanel moduleName="training" recordId={r.id} bare />
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

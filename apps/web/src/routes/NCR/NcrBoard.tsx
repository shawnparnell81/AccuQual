import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import type { Ncr } from "../../api/types";
import { KanbanBoard, type BoardColumn } from "../../components/board/KanbanBoard";
import { StepMoveModal, type StepRequest } from "../../components/board/StepMoveModal";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { usePersonDirectory } from "../../hooks/usePersonDirectory";
import { duePhrase, isPastDue, statusPhrase } from "../../lib/opsLanguage";

const COLUMNS: BoardColumn[] = [
  { key: "open", label: "Open", tone: "danger" },
  { key: "contained", label: "Contained", tone: "warning" },
  { key: "investigating", label: "Investigating", tone: "info" },
  { key: "corrective_action", label: "Fixing", tone: "primary" },
  { key: "closed", label: "Closed", tone: "success" },
];

const NEXT: Record<Ncr["status"], Ncr["status"] | null> = {
  open: "contained",
  contained: "investigating",
  investigating: "corrective_action",
  corrective_action: "closed",
  closed: null,
};

/** Issues as a board. Each move goes through the same step endpoint (and audit entry) as the issue's own page — nothing here writes a status directly. */
export function NcrBoard({ ncrs, canEdit }: { ncrs: Ncr[]; canEdit: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { label } = usePersonDirectory();
  const [step, setStep] = useState<StepRequest | null>(null);

  async function post(ncr: Ncr, path: string, body?: Record<string, string>, done?: string) {
    try {
      await apiClient.post(`/ncr/${ncr.id}/${path}`, body ?? {});
      await qc.invalidateQueries({ queryKey: ["ncr"] });
      toast.success(done ?? "Moved.");
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't move this issue."));
      throw err;
    }
  }

  function requestMove(ncr: Ncr, to: string) {
    const name = `Issue #${ncr.id}`;
    if (to === "contained")
      setStep({ title: `Contain ${name}`, description: "Describe what you did to stop the problem from spreading. This is what moves it to Contained.", fieldLabel: "Containment", submitLabel: "Mark contained", run: (t) => post(ncr, "containment", { containment: t }, `${name} contained.`) });
    else if (to === "investigating")
      setStep({ title: `Investigate ${name}`, description: "Write down the root cause you found.", fieldLabel: "Root cause", submitLabel: "Save root cause", run: (t) => post(ncr, "root-cause", { rootCause: t }, `${name} is being investigated.`) });
    else if (to === "corrective_action")
      setStep({ title: `Fix ${name}`, description: "Describe the corrective action being taken.", fieldLabel: "Corrective action", submitLabel: "Save corrective action", run: (t) => post(ncr, "corrective-action", { correctiveAction: t }, `${name} moved to fixing.`) });
    else if (to === "closed")
      setStep({ title: `Close ${name}?`, description: "Only close it once the corrective action is done.", submitLabel: "Close issue", run: () => post(ncr, "close", undefined, `${name} closed.`) });
  }

  return (
    <>
      <KanbanBoard<Ncr>
        columns={COLUMNS}
        items={ncrs}
        columnOf={(n) => n.status}
        idOf={(n) => n.id}
        nextOf={(n) => NEXT[n.status]}
        canMove={canEdit}
        onMove={(n, to) => requestMove(n, to)}
        rejectMessage={(n, to) => {
          const next = NEXT[n.status];
          return next
            ? `Issues move one step at a time. #${n.id} goes from ${statusPhrase(n.status)} to ${statusPhrase(next)} first — drop it there.`
            : `#${n.id} is closed and can't move (${statusPhrase(to)}).`;
        }}
        renderCard={(n) => (
          <div onClick={() => navigate(`/ncr/${n.id}`)} className="cursor-pointer">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-semibold text-muted-foreground">#{n.id}</span>
              <StatusBadge value={n.severity} />
            </div>
            <p className="mt-1 text-sm font-medium leading-snug">{n.title}</p>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate">{label(n.assignedTo)}</span>
              <span className={isPastDue(n.dueDate, n.status === "closed") ? "font-medium text-destructive" : ""}>{duePhrase(n.dueDate, n.status === "closed")}</span>
            </div>
          </div>
        )}
      />
      <StepMoveModal step={step} onClose={() => setStep(null)} />
    </>
  );
}

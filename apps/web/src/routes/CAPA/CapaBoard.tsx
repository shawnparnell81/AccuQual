import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import type { Capa } from "../../api/types";
import { KanbanBoard, type BoardColumn } from "../../components/board/KanbanBoard";
import { StepMoveModal, type StepRequest } from "../../components/board/StepMoveModal";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { usePersonDirectory } from "../../hooks/usePersonDirectory";
import { duePhrase, isPastDue, statusPhrase } from "../../lib/opsLanguage";

const COLUMNS: BoardColumn[] = [
  { key: "open", label: "Not started", tone: "danger" },
  { key: "in_progress", label: "In progress", tone: "info" },
  { key: "verifying", label: "Checking it worked", tone: "warning" },
  { key: "closed", label: "Closed", tone: "success" },
];

const NEXT: Record<Capa["status"], Capa["status"] | null> = {
  open: "in_progress",
  in_progress: "verifying",
  verifying: "closed",
  closed: null,
};

/** Fixes as a board. Moves call the same start / verify / close steps (and audit entries) as the fix's own page. */
export function CapaBoard({ capas, canEdit }: { capas: Capa[]; canEdit: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { label } = usePersonDirectory();
  const [step, setStep] = useState<StepRequest | null>(null);

  async function post(capa: Capa, path: string, body?: Record<string, string>, done?: string) {
    try {
      await apiClient.post(`/capa/${capa.id}/${path}`, body ?? {});
      await qc.invalidateQueries({ queryKey: ["capa"] });
      toast.success(done ?? "Moved.");
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't move this fix."));
      throw err;
    }
  }

  function requestMove(capa: Capa, to: string) {
    const name = `Fix #${capa.id}`;
    if (to === "in_progress") setStep({ title: `Start ${name}?`, description: "Mark work on this fix as started.", submitLabel: "Start work", run: () => post(capa, "start", undefined, `${name} started.`) });
    else if (to === "verifying")
      setStep({ title: `Check ${name}`, description: "Record how you confirmed the fix actually worked.", fieldLabel: "How was it verified?", minLength: 10, submitLabel: "Save and move to checking", run: (t) => post(capa, "verify", { verification: t }, `${name} is being checked.`) });
    else if (to === "closed") setStep({ title: `Close ${name}?`, description: "Only close it once the check shows the fix worked.", submitLabel: "Close fix", run: () => post(capa, "close", undefined, `${name} closed.`) });
  }

  return (
    <>
      <KanbanBoard<Capa>
        columns={COLUMNS}
        items={capas}
        columnOf={(c) => c.status}
        idOf={(c) => c.id}
        nextOf={(c) => NEXT[c.status]}
        canMove={canEdit}
        onMove={(c, to) => requestMove(c, to)}
        rejectMessage={(c, to) => {
          const next = NEXT[c.status];
          return next ? `Fixes move one step at a time. #${c.id} goes from ${statusPhrase(c.status)} to ${statusPhrase(next)} first — drop it there.` : `#${c.id} is closed and can't move (${statusPhrase(to)}).`;
        }}
        renderCard={(c) => (
          <div onClick={() => navigate(`/capa/${c.id}`)} className="cursor-pointer">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-semibold text-muted-foreground">#{c.id}</span>
              <span className="text-xs text-muted-foreground">{c.ncrId ? `Issue #${c.ncrId}` : "Not linked"}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm font-medium leading-snug">{c.rootCause?.trim() || c.actionPlan?.trim() || "Corrective action"}</p>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate">{label(c.ownerId)}</span>
              <span className={isPastDue(c.dueDate, c.status === "closed") ? "font-medium text-destructive" : ""}>{duePhrase(c.dueDate, c.status === "closed")}</span>
            </div>
          </div>
        )}
      />
      <StepMoveModal step={step} onClose={() => setStep(null)} />
    </>
  );
}

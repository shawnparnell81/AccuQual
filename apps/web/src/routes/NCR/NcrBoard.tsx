import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import type { Ncr, NcrStep } from "../../api/types";
import { KanbanBoard, type BoardColumn } from "../../components/board/KanbanBoard";
import { StepMoveModal, type StepRequest } from "../../components/board/StepMoveModal";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { usePersonDirectory } from "../../hooks/usePersonDirectory";
import { duePhrase, formatPerson, isPastDue, ncrStepKey, ncrStepLabel } from "../../lib/opsLanguage";

const COLUMNS: BoardColumn[] = [
  { key: "ncr_created", label: "NCR Created", tone: "danger" },
  { key: "contain", label: "Contain", tone: "warning" },
  { key: "disposition", label: "Disposition", tone: "info" },
  { key: "fix", label: "Fix", tone: "primary" },
  { key: "verify", label: "Verify", tone: "info" },
  { key: "closed", label: "Closed", tone: "success" },
];

const NEXT: Record<NcrStep, NcrStep | null> = {
  ncr_created: "contain",
  contain: "disposition",
  disposition: "fix",
  fix: "verify",
  verify: "closed",
  closed: null,
};

/** Issues as a board. Each move goes through the same step endpoint (and audit entry) as the issue's own page — nothing here writes a status directly. */
export function NcrBoard({ ncrs, canEdit }: { ncrs: Ncr[]; canEdit: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { label, people } = usePersonDirectory();
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
    const name = `NCR #${ncr.id}`;
    if (to === "contain")
      setStep({ title: `Contain ${name}`, description: "Describe what you did to stop the problem from spreading. This moves it to Contain.", fieldLabel: "Containment", submitLabel: "Mark contained", run: (t) => post(ncr, "containment", { containment: t }, `${name} is at Contain.`) });
    else if (to === "disposition")
      setStep({ title: `Disposition for ${name}`, description: "Record the disposition. Quarantine decisions stay on the NCR itself.", fieldLabel: "Disposition note", submitLabel: "Save disposition", run: (t) => post(ncr, "disposition-step", t.trim() ? { note: t.trim() } : {}, `${name} is at Disposition.`) });
    else if (to === "fix")
      setStep({ title: `Fix ${name}`, description: "Describe the fix being taken.", fieldLabel: "Fix", submitLabel: "Save fix", run: (t) => post(ncr, "corrective-action", { correctiveAction: t }, `${name} is at Fix.`) });
    else if (to === "verify")
      setStep({ title: `Verify ${name}`, description: "Describe how you checked that the fix held.", fieldLabel: "Verification", submitLabel: "Mark verified", run: (t) => post(ncr, "verify", { verification: t }, `${name} is at Verify.`) });
    else if (to === "closed")
      setStep({ title: `Close ${name}?`, description: "Only close it once verification is done.", submitLabel: "Close issue", run: () => post(ncr, "close", undefined, `${name} closed.`) });
  }

  return (
    <>
      <KanbanBoard<Ncr>
        columns={COLUMNS}
        items={ncrs}
        columnOf={(n) => ncrStepKey(n.status)}
        idOf={(n) => n.id}
        nextOf={(n) => NEXT[ncrStepKey(n.status) as NcrStep]}
        canMove={canEdit}
        onMove={(n, to) => requestMove(n, to)}
        rejectMessage={(n, to) => {
          const next = NEXT[ncrStepKey(n.status) as NcrStep];
          return next
            ? `NCRs move one step at a time. #${n.id} goes from ${ncrStepLabel(n.status)} to ${ncrStepLabel(next)} first — drop it there.`
            : `#${n.id} is closed and can't move (${ncrStepLabel(to)}).`;
        }}
        people={people.map((person) => ({ id: person.id, name: formatPerson(person) }))}
        assignedTo={(n) => n.assignedTo}
        onAssign={(n, personId, personName) => {
          apiClient
            .post(`/ncr/${n.id}/assign`, { assignedTo: personId })
            .then(() => qc.invalidateQueries({ queryKey: ["ncr"] }))
            .then(() => toast.success(`NCR #${n.id} assigned to ${personName}.`))
            .catch((err) => toast.error(extractErrorMessage(err, "Couldn't assign this NCR.")));
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
              <span className={isPastDue(n.dueDate, ncrStepKey(n.status) === "closed") ? "font-medium text-destructive" : ""}>{duePhrase(n.dueDate, ncrStepKey(n.status) === "closed")}</span>
            </div>
          </div>
        )}
      />
      <StepMoveModal step={step} onClose={() => setStep(null)} />
    </>
  );
}

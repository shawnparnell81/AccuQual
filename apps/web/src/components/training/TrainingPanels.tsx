import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Mail } from "lucide-react";
import { apiClient } from "../../api/client";
import { Modal } from "../modals/Modal";
import { SelectField, TextAreaField, TextField } from "../forms/Field";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import {
  DEPARTMENTS,
  QUALIFICATION_LABEL,
  departmentLabel,
  useAttention,
  useCompetencies,
  usePeople,
  useSessions,
  useStatusRows,
  useTrainingAccess,
  type AttendanceEntry,
  type CompetencyRow,
  type CourseFull,
  type QualificationStatus,
  type SessionRow,
} from "../../api/training";

const TONE: Record<QualificationStatus, string> = {
  qualified: "bg-success/15 text-success",
  expiring_soon: "bg-warning/15 text-warning",
  expired: "bg-destructive/15 text-destructive",
  revision_changed: "bg-warning/15 text-warning",
  failed: "bg-destructive/15 text-destructive",
  awaiting_evaluation: "bg-primary/15 text-primary",
  overdue: "bg-destructive/15 text-destructive",
  in_progress: "bg-primary/15 text-primary",
  assigned: "bg-muted text-muted-foreground",
  not_trained: "bg-muted text-muted-foreground",
};

export function QualificationBadge({ status }: { status: QualificationStatus }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[status]}`}>{QUALIFICATION_LABEL[status]}</span>;
}

const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["training"] });
    void qc.invalidateQueries({ queryKey: ["training-assignments"] });
  };
}

// ---- Attention strip (list page) ------------------------------------------------------------------------------------------------------------------

/** People who need to do something about their training now, and a button that emails the same list to Quality. */
export function TrainingAttentionStrip() {
  const { mayManage } = useTrainingAccess();
  const { data = [] } = useAttention();
  const toast = useToast();
  const refresh = useRefresh();
  const digest = useMutation({
    mutationFn: async () => (await apiClient.post("/training/notify-due")).data as { items: number; notified: number },
    onSuccess: (r) => {
      refresh();
      toast.success(r.items === 0 ? "Nothing needs attention." : `Sent to ${r.notified} ${r.notified === 1 ? "person" : "people"} in Quality.`);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't send the digest.")),
  });
  if (data.length === 0) return null;
  const counts = data.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle size={15} /> {data.length} {data.length === 1 ? "training item needs" : "training items need"} attention
        </p>
        <span className="text-xs text-muted-foreground">
          {(Object.keys(QUALIFICATION_LABEL) as QualificationStatus[])
            .filter((s) => counts[s])
            .map((s) => `${counts[s]} ${QUALIFICATION_LABEL[s].toLowerCase()}`)
            .join(" · ")}
        </span>
        {mayManage && (
          <button onClick={() => digest.mutate()} disabled={digest.isPending} className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-60">
            <Mail size={12} /> Email this to Quality
          </button>
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {data.slice(0, 8).map((r) => (
          <li key={`${r.userId}-${r.courseId}`}>
            <Link to={`/training/employee/${r.userId}`} className="text-primary hover:underline">
              {r.userName ?? r.email}
            </Link>{" "}
            <span className="text-muted-foreground">
              — {r.courseTitle}: {QUALIFICATION_LABEL[r.status].toLowerCase()}
            </span>
          </li>
        ))}
        {data.length > 8 && <li className="text-muted-foreground">…and {data.length - 8} more</li>}
      </ul>
    </div>
  );
}

// ---- Requirements -----------------------------------------------------------------------------------------------------------------------------------

export function RequirementsPanel({ course }: { course: CourseFull }) {
  const { mayManage } = useTrainingAccess();
  const [open, setOpen] = useState(false);
  const req = course.requirements ?? {};
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium">Requirements</h2>
        {mayManage && (
          <button onClick={() => setOpen(true)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
            Edit
          </button>
        )}
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Required for</dt>
          <dd className="font-medium">{course.requiredForDepartment ? departmentLabel(course.requiredForDepartment) : course.requiredForRoleId ? `Role #${course.requiredForRoleId}` : "Nobody in particular"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Valid for</dt>
          <dd className="font-medium">{course.validityMonths ? `${course.validityMonths} months` : "Does not expire"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Evaluation</dt>
          <dd className="font-medium">{req.evaluationRequired ? `Required${req.passingScore !== undefined ? ` — pass at ${req.passingScore}` : ""}` : "Not required"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Evaluator checks</dt>
          <dd className="font-medium">{req.criteria?.length ? req.criteria.join(", ") : "—"}</dd>
        </div>
      </dl>
      {open && <RequirementsModal course={course} onClose={() => setOpen(false)} />}
    </div>
  );
}

function RequirementsModal({ course, onClose }: { course: CourseFull; onClose: () => void }) {
  const req = course.requirements ?? {};
  const [dept, setDept] = useState(course.requiredForDepartment ?? "");
  const [months, setMonths] = useState(course.validityMonths ? String(course.validityMonths) : "");
  const [evaluation, setEvaluation] = useState(!!req.evaluationRequired);
  const [passing, setPassing] = useState(req.passingScore !== undefined ? String(req.passingScore) : "");
  const [criteria, setCriteria] = useState((req.criteria ?? []).join("\n"));
  const toast = useToast();
  const refresh = useRefresh();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: async () =>
      (
        await apiClient.patch(`/training/${course.id}`, {
          requiredForDepartment: dept || null,
          validityMonths: months ? Number(months) : null,
          requirements: {
            evaluationRequired: evaluation,
            ...(passing ? { passingScore: Number(passing) } : {}),
            criteria: criteria.split("\n").map((c) => c.trim()).filter(Boolean),
          },
        })
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["training"] });
      refresh();
      toast.success("Requirements saved.");
      onClose();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save.")),
  });
  return (
    <Modal title="Course requirements" isOpen onClose={onClose}>
      <div className="flex flex-col gap-3">
        <SelectField label="Required of everyone in" value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">No department</option>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {departmentLabel(d)}
            </option>
          ))}
        </SelectField>
        <TextField label="Stays valid for (months, blank = never expires)" type="number" min={1} value={months} onChange={(e) => setMonths(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={evaluation} onChange={(e) => setEvaluation(e.target.checked)} /> A competency evaluation is needed after the training
        </label>
        {evaluation && (
          <>
            <TextField label="Passing score (0–100, optional)" type="number" min={0} max={100} value={passing} onChange={(e) => setPassing(e.target.value)} />
            <TextAreaField label="What the evaluator checks (one per line)" rows={4} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
          </>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button disabled={save.isPending} onClick={() => save.mutate()} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Who is qualified ---------------------------------------------------------------------------------------------------------------------------------

export function QualificationPanel({ courseId }: { courseId: number }) {
  const { mayManage } = useTrainingAccess();
  const { data = [] } = useStatusRows({ courseId });
  const toast = useToast();
  const refresh = useRefresh();
  const assign = useMutation({
    mutationFn: async () => (await apiClient.post(`/training/${courseId}/assign-required`, {})).data as { assigned: unknown[]; considered: number },
    onSuccess: (r) => {
      refresh();
      toast.success(r.assigned.length === 0 ? "Everyone required is already trained or has it assigned." : `Assigned to ${r.assigned.length} ${r.assigned.length === 1 ? "person" : "people"}.`);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't assign.")),
  });
  const actionable = data.filter((r) => r.required && ["not_trained", "expired", "revision_changed", "failed"].includes(r.status) && !r.openAssignmentId).length;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Training status</h2>
        {mayManage && (
          <button disabled={assign.isPending || actionable === 0} onClick={() => assign.mutate()} title={actionable === 0 ? "Nobody required needs it right now" : undefined} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
            Assign to everyone who needs it{actionable ? ` (${actionable})` : ""}
          </button>
        )}
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody is required to take this course yet — set who it's required of under Requirements, or assign it to people below.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {data.map((r) => (
            <li key={r.userId} className="flex flex-wrap items-center gap-3 border-b border-border pb-1 last:border-0">
              <Link to={`/training/employee/${r.userId}`} className="w-44 flex-none truncate hover:underline">
                {r.userName ?? r.email}
              </Link>
              <span className="w-28 flex-none text-xs text-muted-foreground">{r.department ? departmentLabel(r.department) : "—"}</span>
              <QualificationBadge status={r.status} />
              <span className="text-xs text-muted-foreground">{r.expiresAt ? `valid to ${dt(r.expiresAt)}` : r.lastCompletedAt ? `trained ${dt(r.lastCompletedAt)}` : r.dueAt ? `due ${dt(r.dueAt)}` : ""}</span>
              {!r.required && <span className="text-[10px] uppercase text-muted-foreground">not required</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- Sessions -----------------------------------------------------------------------------------------------------------------------------------------

export function SessionsPanel({ course }: { course: CourseFull }) {
  const { mayManage } = useTrainingAccess();
  const { data = [] } = useSessions({ courseId: course.id });
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [attendFor, setAttendFor] = useState<SessionRow | null>(null);
  const toast = useToast();
  const refresh = useRefresh();
  const cancel = useMutation({
    mutationFn: async (id: number) => {
      const reason = window.prompt("Why is this session cancelled?");
      if (!reason) throw new Error("cancelled by user");
      return (await apiClient.post(`/training/session/${id}/cancel`, { reason })).data;
    },
    onSuccess: () => {
      refresh();
      toast.success("Session cancelled.");
    },
    onError: (err) => {
      if ((err as Error).message !== "cancelled by user") toast.error(extractErrorMessage(err, "Couldn't cancel."));
    },
  });
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium">Sessions</h2>
        {mayManage && course.active && (
          <button onClick={() => setScheduleOpen(true)} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
            Schedule a session
          </button>
        )}
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sessions yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 border-b border-border pb-2 last:border-0">
              <span className="w-28 flex-none font-medium">{new Date(s.scheduledAt).toLocaleDateString()}</span>
              <span className="flex-1 text-muted-foreground">
                {[s.title, s.location, s.instructorName ? `with ${s.instructorName}` : null].filter(Boolean).join(" · ") || "Session"} — {s.status === "completed" ? `${s.attended} of ${s.enrolled} attended` : `${s.enrolled} enrolled`}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.status === "completed" ? "bg-success/15 text-success" : s.status === "cancelled" ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary"}`}>{s.status}</span>
              {mayManage && s.status === "scheduled" && (
                <>
                  <button onClick={() => setAttendFor(s)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                    Attendance &amp; complete
                  </button>
                  <button onClick={() => cancel.mutate(s.id)} className="text-xs text-muted-foreground hover:text-destructive">
                    Cancel
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {scheduleOpen && <ScheduleModal courseId={course.id} onClose={() => setScheduleOpen(false)} />}
      {attendFor && <AttendanceModal session={attendFor} onClose={() => setAttendFor(null)} />}
    </div>
  );
}

function ScheduleModal({ courseId, onClose }: { courseId: number; onClose: () => void }) {
  const { data: people = [] } = usePeople();
  const [when, setWhen] = useState("");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [capacity, setCapacity] = useState("");
  const [instructor, setInstructor] = useState("");
  const [roster, setRoster] = useState<number[]>([]);
  const toast = useToast();
  const refresh = useRefresh();
  const create = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post("/training/session", {
          courseId,
          scheduledAt: when,
          title: title || undefined,
          location: location || undefined,
          capacity: capacity ? Number(capacity) : undefined,
          instructorId: instructor ? Number(instructor) : undefined,
          attendance: roster.map((userId) => ({ userId, status: "present" })),
        })
      ).data,
    onSuccess: () => {
      refresh();
      toast.success("Session scheduled.");
      onClose();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't schedule.")),
  });
  return (
    <Modal title="Schedule a session" isOpen onClose={onClose}>
      <div className="flex flex-col gap-3">
        <TextField label="Date and time" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <TextField label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
          <TextField label="Places" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </div>
        <SelectField label="Instructor" value={instructor} onChange={(e) => setInstructor(e.target.value)}>
          <option value="">Not chosen</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name ?? p.email}
            </option>
          ))}
        </SelectField>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">Who is coming</legend>
          <ul className="max-h-40 overflow-y-auto rounded-md border border-border p-2 text-sm">
            {people.map((p) => (
              <li key={p.id}>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={roster.includes(p.id)} onChange={(e) => setRoster((r) => (e.target.checked ? [...r, p.id] : r.filter((x) => x !== p.id)))} />
                  {p.name ?? p.email}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button disabled={!when || create.isPending} onClick={() => create.mutate()} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {create.isPending ? "Scheduling…" : "Schedule"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AttendanceModal({ session, onClose }: { session: SessionRow; onClose: () => void }) {
  const { data: people = [] } = usePeople();
  const name = (id: number) => people.find((p) => p.id === id)?.name ?? people.find((p) => p.id === id)?.email ?? `#${id}`;
  const [rows, setRows] = useState<AttendanceEntry[]>(session.attendance);
  const [extra, setExtra] = useState("");
  const toast = useToast();
  const refresh = useRefresh();
  const complete = useMutation({
    mutationFn: async () => (await apiClient.post(`/training/session/${session.id}/complete`, { attendance: rows })).data as { recorded: number },
    onSuccess: (r) => {
      refresh();
      toast.success(`Session completed — training recorded for ${r.recorded} ${r.recorded === 1 ? "person" : "people"}.`);
      onClose();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't complete the session.")),
  });
  const addable = people.filter((p) => !rows.some((r) => r.userId === p.id));
  return (
    <Modal title="Attendance" isOpen onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Mark who attended. Everyone marked present gets this training recorded against them.</p>
        <ul className="flex flex-col gap-2 text-sm">
          {rows.map((r, i) => (
            <li key={r.userId} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{name(r.userId)}</span>
              <select className="rounded-md border border-form-field bg-background px-2 py-1 text-sm" value={r.status} onChange={(e) => setRows((all) => all.map((x, j) => (j === i ? { ...x, status: e.target.value as AttendanceEntry["status"] } : x)))} aria-label={`Attendance of ${name(r.userId)}`}>
                <option value="present">Present</option>
                <option value="absent">Absent</option>
                <option value="excused">Excused</option>
              </select>
              <button className="text-xs text-muted-foreground hover:text-destructive" onClick={() => setRows((all) => all.filter((_, j) => j !== i))}>
                Remove
              </button>
            </li>
          ))}
          {rows.length === 0 && <li className="text-muted-foreground">Nobody listed yet.</li>}
        </ul>
        {addable.length > 0 && (
          <div className="flex gap-2">
            <select className="min-w-0 flex-1 rounded-md border border-form-field bg-background px-2 py-1 text-sm" value={extra} onChange={(e) => setExtra(e.target.value)} aria-label="Add someone">
              <option value="">Add someone…</option>
              {addable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? p.email}
                </option>
              ))}
            </select>
            <button
              disabled={!extra}
              onClick={() => {
                setRows((all) => [...all, { userId: Number(extra), status: "present" }]);
                setExtra("");
              }}
              className="rounded-md border border-border px-3 py-1 text-sm hover:bg-muted disabled:opacity-50"
            >
              Add
            </button>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button disabled={rows.length === 0 || complete.isPending} onClick={() => complete.mutate()} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {complete.isPending ? "Saving…" : "Complete session"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Competency -----------------------------------------------------------------------------------------------------------------------------------------

export function CompetencyPanel({ course }: { course: CourseFull }) {
  const { mayManage } = useTrainingAccess();
  const { data = [] } = useCompetencies({ courseId: course.id });
  const [deciding, setDeciding] = useState<CompetencyRow | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium">Competency evaluations</h2>
        {mayManage && (
          <button onClick={() => setRequestOpen(true)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
            Request an evaluation
          </button>
        )}
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{course.requirements?.evaluationRequired ? "No evaluations yet. Completing a session creates one for each person who attended." : "This course doesn't require an evaluation, but one can be recorded."}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 border-b border-border pb-2 last:border-0">
              <Link to={`/training/employee/${c.userId}`} className="w-40 flex-none truncate hover:underline">
                {c.userName ?? c.userEmail}
              </Link>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c.status === "pass" ? "bg-success/15 text-success" : c.status === "fail" ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-primary"}`}>{c.status === "pending" ? "Waiting" : c.status}</span>
              <span className="text-xs text-muted-foreground">
                {c.status === "pending" ? "not yet evaluated" : `${c.score !== null ? `score ${c.score} · ` : ""}${dt(c.evaluatedAt)}${c.expiresAt ? ` · valid to ${dt(c.expiresAt)}` : ""}`}
              </span>
              {c.evaluation?.criteria?.length ? <span className="flex-1 truncate text-xs text-muted-foreground">{c.evaluation.criteria.map((k) => `${k.name}: ${k.result}`).join(", ")}</span> : <span className="flex-1" />}
              {mayManage && c.status === "pending" && (
                <button onClick={() => setDeciding(c)} className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">
                  Evaluate
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {deciding && <EvaluateModal course={course} row={deciding} onClose={() => setDeciding(null)} />}
      {requestOpen && <RequestModal course={course} onClose={() => setRequestOpen(false)} />}
    </div>
  );
}

function EvaluateModal({ course, row, onClose }: { course: CourseFull; row: CompetencyRow; onClose: () => void }) {
  const criteria = course.requirements?.criteria ?? [];
  const [results, setResults] = useState<Record<string, "pass" | "fail" | "n/a">>(Object.fromEntries(criteria.map((c) => [c, "pass"])));
  const [score, setScore] = useState("");
  const [notes, setNotes] = useState("");
  const toast = useToast();
  const refresh = useRefresh();
  const anyFail = Object.values(results).includes("fail");
  const decide = useMutation({
    mutationFn: async (status: "pass" | "fail") =>
      (
        await apiClient.post(`/training/competency/${row.id}/evaluate`, {
          status,
          score: score ? Number(score) : undefined,
          evaluation: criteria.length ? { criteria: criteria.map((name) => ({ name, result: results[name] ?? "n/a" })) } : undefined,
          notes: notes || undefined,
        })
      ).data,
    onSuccess: () => {
      refresh();
      toast.success("Evaluation recorded.");
      onClose();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't record the evaluation.")),
  });
  return (
    <Modal title={`Evaluate ${row.userName ?? row.userEmail}`} isOpen onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {course.title}. A decision is part of the record and can't be edited; a re-evaluation is a new one. You can't evaluate yourself.
        </p>
        {criteria.length > 0 && (
          <ul className="flex flex-col gap-2 text-sm">
            {criteria.map((c) => (
              <li key={c} className="flex items-center justify-between gap-2">
                <span>{c}</span>
                <select className="rounded-md border border-form-field bg-background px-2 py-1 text-sm" value={results[c]} onChange={(e) => setResults((r) => ({ ...r, [c]: e.target.value as "pass" | "fail" | "n/a" }))} aria-label={c}>
                  <option value="pass">Pass</option>
                  <option value="fail">Fail</option>
                  <option value="n/a">Not applicable</option>
                </select>
              </li>
            ))}
          </ul>
        )}
        <TextField label={`Score (0–100${course.requirements?.passingScore !== undefined ? `, pass at ${course.requirements.passingScore}` : ""})`} type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} />
        <TextAreaField label="Notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button disabled={decide.isPending} onClick={() => decide.mutate("fail")} className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive disabled:opacity-60">
            Record as fail
          </button>
          <button disabled={decide.isPending || anyFail} title={anyFail ? "A criterion failed" : undefined} onClick={() => decide.mutate("pass")} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            Record as pass
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RequestModal({ course, onClose }: { course: CourseFull; onClose: () => void }) {
  const { data: people = [] } = usePeople();
  const [userId, setUserId] = useState("");
  const toast = useToast();
  const refresh = useRefresh();
  const request = useMutation({
    mutationFn: async () => (await apiClient.post("/training/competency", { userId: Number(userId), courseId: course.id })).data,
    onSuccess: () => {
      refresh();
      toast.success("Evaluation requested.");
      onClose();
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't request it.")),
  });
  return (
    <Modal title="Request an evaluation" isOpen onClose={onClose}>
      <div className="flex flex-col gap-3">
        <SelectField label="Who should be evaluated" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Choose…</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name ?? p.email}
            </option>
          ))}
        </SelectField>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button disabled={!userId || request.isPending} onClick={() => request.mutate()} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            Request
          </button>
        </div>
      </div>
    </Modal>
  );
}

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BackButton } from "../../components/layout/BackButton";
import { CalendarItemList } from "../../components/shared/CalendarItemList";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useCanEditWorkflow } from "../../hooks/useWorkflowAccess";
import { useWorker, useUpsertWorkerProfile, EMPLOYMENT_STATUSES, EMPLOYMENT_STATUS_LABEL, type EmploymentStatus } from "../../api/workers";

interface FormState {
  jobTitle: string;
  shift: string;
  hireDate: string;
  skillsText: string;
  employmentStatus: EmploymentStatus;
  notes: string;
}

/**
 * Worker Runtime's detail page: the small profile layered on `users`
 * (job title, shift, hire date, skills, employment status, notes), and a
 * read-only activity view — what this person is currently assigned to
 * across the app — reusing the exact same aggregation the self-service
 * Calendar/Workflow Inbox already computes (see worker.service.ts's
 * getWorkerActivity), rendered by the same CalendarItemList component.
 */
export function WorkerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const userId = Number(id);
  const { data, isLoading, isError } = useWorker(userId);
  const upsert = useUpsertWorkerProfile(userId);
  const canManage = useCanEditWorkflow("worker_profile");
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (data?.profile) {
      setForm({
        jobTitle: data.profile.jobTitle ?? "",
        shift: data.profile.shift ?? "",
        hireDate: data.profile.hireDate ? data.profile.hireDate.slice(0, 10) : "",
        skillsText: data.profile.skills.join(", "),
        employmentStatus: data.profile.employmentStatus,
        notes: data.profile.notes ?? "",
      });
    }
  }, [data?.profile]);

  if (isLoading || !form) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (isError || !data) return <div className="p-6 text-sm text-destructive">Couldn't load this worker.</div>;

  const { profile, activity } = data;

  async function save() {
    try {
      await upsert.mutateAsync({
        jobTitle: form!.jobTitle.trim() || null,
        shift: form!.shift.trim() || null,
        hireDate: form!.hireDate || null,
        skills: form!.skillsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        employmentStatus: form!.employmentStatus,
        notes: form!.notes.trim() || null,
      });
      toast.success("Profile saved");
      setEditing(false);
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't save this profile."));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <BackButton />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{profile.name ?? profile.email}</h1>
          <p className="text-sm text-muted-foreground">
            {profile.email} · {profile.department ? profile.department.replace(/_/g, " ") : "No department"} · {profile.roleName ?? "No role"}
          </p>
        </div>
        {canManage && !editing && (
          <button onClick={() => setEditing(true)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Edit profile
          </button>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Worker profile</h2>
        {editing ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Job title
              <input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} className="rounded-md border border-border bg-background px-3 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Shift
              <input value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })} placeholder="day, evening, night, A shift…" className="rounded-md border border-border bg-background px-3 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Hire date
              <input type="date" value={form.hireDate} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} className="rounded-md border border-border bg-background px-3 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Skills (comma separated)
              <input value={form.skillsText} onChange={(e) => setForm({ ...form, skillsText: e.target.value })} placeholder="forklift certified, CNC setup…" className="rounded-md border border-border bg-background px-3 py-1.5" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Employment status
              <select value={form.employmentStatus} onChange={(e) => setForm({ ...form, employmentStatus: e.target.value as EmploymentStatus })} className="rounded-md border border-border bg-background px-3 py-1.5">
                {EMPLOYMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {EMPLOYMENT_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Notes
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="rounded-md border border-border bg-background px-3 py-1.5" />
            </label>
            <div className="flex gap-2">
              <button onClick={save} disabled={upsert.isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {upsert.isPending ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setEditing(false)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Job title</dt>
              <dd>{profile.jobTitle ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Shift</dt>
              <dd>{profile.shift ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Hire date</dt>
              <dd>{profile.hireDate ? new Date(profile.hireDate).toLocaleDateString(undefined, { timeZone: "UTC" }) : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Employment status</dt>
              <dd>{EMPLOYMENT_STATUS_LABEL[profile.employmentStatus]}</dd>
            </div>
            <div className="col-span-2 sm:col-span-3">
              <dt className="text-muted-foreground">Skills</dt>
              <dd>{profile.skills.length ? profile.skills.join(", ") : "—"}</dd>
            </div>
            <div className="col-span-2 sm:col-span-3">
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="whitespace-pre-wrap">{profile.notes ?? "—"}</dd>
            </div>
          </dl>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Currently assigned to</h2>
        <CalendarItemList items={activity} emptyMessage="Nothing currently assigned to this person." />
      </div>
    </div>
  );
}

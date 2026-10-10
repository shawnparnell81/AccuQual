import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { TextField, SelectField } from "../../components/forms/Field";
import { UserAvatar } from "../../components/shared/UserAvatar";
import { passwordStrength } from "../../lib/passwordStrength";
import { DEPARTMENTS } from "../../components/layout/navConfig";
import {
  EMPLOYMENT_LABELS,
  SHIFT_LABELS,
  TEAM_STEPS,
  type TeamDraft,
} from "./newTeamMember";

export interface WizardRole {
  id: number;
  name: string;
  displayName?: string;
}
export interface WizardPerson {
  id: number;
  name: string | null;
  email: string;
  isActive: boolean;
}
export interface WizardSite {
  id: number;
  name: string;
}
export interface WizardCourse {
  id: number;
  title: string;
  description: string | null;
}
export interface WizardDocument {
  id: number;
  title: string;
  status: string;
}
export interface WizardPermissionRole {
  id: number;
  roleName: string;
  description?: string | null;
}
export interface AccessPreview {
  capabilities: string[];
  departmentAccess: string[];
  extraRoles: { id: number; name: string; grants: string[] }[];
  adjustPath: string;
}

function roleLabel(role: WizardRole): string {
  return role.displayName || role.name;
}

function personLabel(person: WizardPerson): string {
  return person.name?.trim() || person.email;
}

export function NewTeamMemberWizard({
  step,
  draft,
  error,
  busy,
  roles,
  people,
  sites,
  courses,
  documents,
  permissionRoles,
  preview,
  created,
  onDraft,
  onStep,
  onNext,
  onCreate,
  onAddAnother,
}: {
  step: number;
  draft: TeamDraft;
  error: string | null;
  busy: boolean;
  roles: WizardRole[];
  people: WizardPerson[];
  sites: WizardSite[];
  courses: WizardCourse[];
  documents: WizardDocument[];
  permissionRoles: WizardPermissionRole[];
  preview: AccessPreview | null;
  created: { id: number; name: string } | null;
  onDraft: (next: TeamDraft) => void;
  onStep: (step: number) => void;
  onNext: () => void;
  onCreate: () => void;
  onAddAnother: () => void;
}) {
  if (created) {
    return (
      <section className="mx-auto flex w-full max-w-xl flex-col gap-4 rounded-lg border border-border bg-card p-6" data-testid="team-success">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Team member added</p>
        <h1 className="text-2xl font-semibold">{`${created.name} can sign in`}</h1>
        <p className="text-sm text-muted-foreground">
          Their temporary password works once. AccuQual asks them to choose their own password, then to set a signature PIN, before any other page opens.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to={`/admin/users/${created.id}`} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
            View profile
          </Link>
          <button type="button" onClick={onAddAnother} className="rounded-md border border-border px-3 py-1.5 text-sm">
            Add another
          </button>
        </div>
      </section>
    );
  }

  const last = step === TEAM_STEPS.length - 1;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (last) onCreate();
    else onNext();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="team-wizard" data-step={TEAM_STEPS[step]?.id}>
      <header className="flex flex-col gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">New team member</p>
          <h1 className="text-2xl font-semibold">Add someone to the quality system</h1>
          <p className="text-sm text-muted-foreground">
            Step {step + 1} of {TEAM_STEPS.length}. What you enter stays on this page if you leave and come back. The temporary password does not.
          </p>
        </div>
        <nav aria-label="Progress" className="overflow-x-auto">
          <ol className="flex min-w-max gap-1">
            {TEAM_STEPS.map((item, index) => {
              const current = index === step;
              const done = index < step;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={current ? "step" : undefined}
                    disabled={!done && !current}
                    onClick={() => done && onStep(index)}
                    className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs ${current ? "bg-primary text-primary-foreground" : done ? "text-primary hover:bg-primary/10" : "text-muted-foreground"}`}
                  >
                    <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${current ? "bg-primary-foreground/20" : "bg-muted"}`}>{index + 1}</span>
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </header>

      <div className="rounded-lg border border-border bg-card p-4">
        {step === 0 && <IdentityStep draft={draft} roles={roles} people={people} sites={sites} onDraft={onDraft} />}
        {step === 1 && <AboutStep draft={draft} onDraft={onDraft} />}
        {step === 2 && <AccessStep draft={draft} permissionRoles={permissionRoles} preview={preview} onDraft={onDraft} />}
        {step === 3 && <TrainingStep draft={draft} courses={courses} documents={documents} onDraft={onDraft} />}
        {step === 4 && (
          <ReviewStep
            draft={draft}
            roles={roles}
            people={people}
            sites={sites}
            courses={courses}
            documents={documents}
            permissionRoles={permissionRoles}
            onStep={onStep}
          />
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-background/95 py-3">
        <button type="button" onClick={() => onStep(Math.max(0, step - 1))} disabled={step === 0 || busy} className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-40">
          Back
        </button>
        <button type="submit" disabled={busy} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
          {busy ? "Saving…" : last ? "Create team member" : "Next"}
        </button>
      </div>
    </form>
  );
}

function IdentityStep({
  draft,
  roles,
  people,
  sites,
  onDraft,
}: {
  draft: TeamDraft;
  roles: WizardRole[];
  people: WizardPerson[];
  sites: WizardSite[];
  onDraft: (next: TeamDraft) => void;
}) {
  const managers = people.filter((person) => person.isActive);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <TextField label="Full name" name="full-name" autoComplete="off" required value={draft.name} onChange={(e) => onDraft({ ...draft, name: e.target.value })} />
      <TextField label="Preferred name" name="preferred-name" autoComplete="off" value={draft.preferredName} onChange={(e) => onDraft({ ...draft, preferredName: e.target.value })} />
      <TextField label="Job title" name="job-title" autoComplete="off" value={draft.jobTitle} onChange={(e) => onDraft({ ...draft, jobTitle: e.target.value })} />
      <SelectField label="Role" name="roleId" required value={draft.roleId} onChange={(e) => onDraft({ ...draft, roleId: e.target.value })}>
        <option value="">Choose a role</option>
        {roles.map((role) => (
          <option key={role.id} value={role.id}>
            {roleLabel(role)}
          </option>
        ))}
      </SelectField>
      <SelectField label="Department" name="department" value={draft.department} onChange={(e) => onDraft({ ...draft, department: e.target.value })}>
        <option value="">None</option>
        {DEPARTMENTS.map((department) => (
          <option key={department.key} value={department.key}>
            {department.label}
          </option>
        ))}
      </SelectField>
      <SelectField label="Manager" name="managerId" value={draft.managerId} onChange={(e) => onDraft({ ...draft, managerId: e.target.value })}>
        <option value="">None</option>
        {managers.map((person) => (
          <option key={person.id} value={person.id}>
            {personLabel(person)}
          </option>
        ))}
      </SelectField>
      <fieldset className="md:col-span-2">
        <legend className="mb-1 text-xs font-semibold text-muted-foreground">Sites</legend>
        <div className="flex flex-wrap gap-2">
          <SiteChoice
            label="All sites"
            checked={draft.allSites}
            onChange={(checked) => onDraft({ ...draft, allSites: checked, siteIds: checked ? sites.map((site) => site.id) : [] })}
          />
          {sites.map((site) => (
            <SiteChoice
              key={site.id}
              label={site.name}
              checked={draft.allSites || draft.siteIds.includes(site.id)}
              onChange={(checked) => {
                const siteIds = checked ? [...draft.siteIds, site.id] : draft.siteIds.filter((id) => id !== site.id);
                const allSites = sites.length > 0 && siteIds.length === sites.length;
                onDraft({ ...draft, siteIds, allSites });
              }}
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function SiteChoice({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={`inline-flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm ${checked ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function AboutStep({ draft, onDraft }: { draft: TeamDraft; onDraft: (next: TeamDraft) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <TextField label="Work email" name="work-email" type="email" inputMode="email" autoComplete="off" required value={draft.email} onChange={(e) => onDraft({ ...draft, email: e.target.value })} />
      <TextField label="Phone or extension" name="phone" autoComplete="off" value={draft.phone} onChange={(e) => onDraft({ ...draft, phone: e.target.value })} />
      <TextField label="Employee ID" name="employee-id" autoComplete="off" placeholder="From payroll or HR" value={draft.employeeId} onChange={(e) => onDraft({ ...draft, employeeId: e.target.value })} />
      <TextField label="Hire date" name="hire-date" type="date" value={draft.hireDate} onChange={(e) => onDraft({ ...draft, hireDate: e.target.value })} />
      <SelectField label="Employment type" name="employment-type" value={draft.employmentType} onChange={(e) => onDraft({ ...draft, employmentType: e.target.value })}>
        <option value="">Not set</option>
        {Object.entries(EMPLOYMENT_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </SelectField>
      <SelectField label="Shift" name="shift" value={draft.shift} onChange={(e) => onDraft({ ...draft, shift: e.target.value })}>
        <option value="">Not set</option>
        {Object.entries(SHIFT_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </SelectField>
      <TextField label="Location within the site" name="site-location" autoComplete="off" value={draft.siteLocation} onChange={(e) => onDraft({ ...draft, siteLocation: e.target.value })} />
      <label className="flex flex-col gap-1 text-sm md:col-span-2">
        <span className="text-xs font-semibold text-muted-foreground">Short bio</span>
        <textarea
          name="bio"
          maxLength={500}
          rows={3}
          value={draft.bio}
          onChange={(e) => onDraft({ ...draft, bio: e.target.value })}
          className="w-full rounded-[9px] border border-form-field bg-[hsl(var(--form-input))] px-2.5 py-2 text-sm outline-none focus:border-ring"
        />
      </label>
      <PhotoCrop preview={draft.photoDataUrl} name={draft.preferredName || draft.name} onChange={(photoDataUrl) => onDraft({ ...draft, photoDataUrl })} />
    </div>
  );
}

function PhotoCrop({ preview, name, onChange }: { preview: string; name: string; onChange: (dataUrl: string) => void }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  function applyCrop() {
    const img = imgRef.current;
    if (!img) return;
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight) * zoom;
    const width = img.naturalWidth * scale;
    const height = img.naturalHeight * scale;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, (size - width) / 2, (size - height) / 2, width, height);
    onChange(canvas.toDataURL("image/jpeg", 0.9));
    setSource(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-4 md:col-span-2">
      <UserAvatar name={name} src={preview || null} size={64} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <label className="text-xs font-semibold text-muted-foreground">
          Profile photo
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="mt-1 block text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setSource(URL.createObjectURL(file));
              setZoom(1);
            }}
          />
        </label>
        {source && (
          <div className="flex flex-col gap-2">
            <img ref={imgRef} src={source} alt="Crop preview" className="h-28 w-28 rounded-md object-cover" />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Zoom
              <input type="range" min={1} max={2.5} step={0.1} value={zoom} aria-label="Photo zoom" onChange={(event) => setZoom(Number(event.target.value))} />
            </label>
            <button type="button" onClick={applyCrop} className="w-fit rounded-md border border-border px-2 py-1 text-xs">
              Use this crop
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AccessStep({
  draft,
  permissionRoles,
  preview,
  onDraft,
}: {
  draft: TeamDraft;
  permissionRoles: WizardPermissionRole[];
  preview: AccessPreview | null;
  onDraft: (next: TeamDraft) => void;
}) {
  const meter = passwordStrength(draft.password);
  return (
    <div className="flex flex-col gap-4">
      <div aria-hidden="true" className="pointer-events-none absolute h-0 w-0 overflow-hidden">
        <input type="text" tabIndex={-1} autoComplete="username" name="username" defaultValue="" />
        <input type="password" tabIndex={-1} autoComplete="current-password" name="current-password" defaultValue="" />
      </div>
      <TextField
        label="Temporary password"
        name="temporary-password"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        value={draft.password}
        onChange={(e) => onDraft({ ...draft, password: e.target.value })}
      />
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-semibold text-muted-foreground">Strength</span>
          <span>{meter.label}</span>
        </div>
        <div className="flex gap-1" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <span key={index} className={`h-1.5 flex-1 rounded-full ${index < meter.score ? "bg-primary" : "bg-muted"}`} />
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">They must change this the first time they sign in. That step is always on for a password an administrator sets.</p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={draft.requireMfa} onChange={(e) => onDraft({ ...draft, requireMfa: e.target.checked })} />
        <span>Require two-step sign-in. They set it up with the same grace period the company already uses.</span>
      </label>
      <section className="rounded-md border border-border p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">What this role can do</h2>
          <Link to={preview?.adjustPath ?? "/admin/roles-permissions"} className="text-xs text-primary hover:underline">
            Adjust on the permissions screen
          </Link>
        </div>
        <PlainList
          title="Stored on the role"
          items={preview?.capabilities ?? []}
          empty={
            !draft.roleId
              ? "Choose a role to see the permissions stored on it."
              : preview
                ? "This role has no extra permissions stored. Day-to-day access comes from the department."
                : "Loading the permissions stored on this role."
          }
        />
        <PlainList
          title="From the department"
          items={preview?.departmentAccess ?? []}
          empty={
            !draft.department
              ? "No department is selected."
              : preview
                ? "That department has no module access stored yet. An administrator sets it on the permissions screen."
                : "Loading department access."
          }
        />
        {permissionRoles.length > 0 && (
          <fieldset className="mt-3">
            <legend className="mb-1 text-xs font-semibold text-muted-foreground">Extra permission roles</legend>
            <div className="flex flex-col gap-1">
              {permissionRoles.map((role) => {
                const checked = draft.permissionRoleIds.includes(role.id);
                const grants = preview?.extraRoles.find((extra) => extra.id === role.id)?.grants ?? [];
                return (
                  <label key={role.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      onChange={(event) => {
                        const permissionRoleIds = event.target.checked ? [...draft.permissionRoleIds, role.id] : draft.permissionRoleIds.filter((id) => id !== role.id);
                        onDraft({ ...draft, permissionRoleIds });
                      }}
                    />
                    <span>
                      {role.roleName}
                      {checked && grants.length > 0 && <span className="mt-0.5 block text-xs text-muted-foreground">{grants.join(" ")}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
      </section>
    </div>
  );
}

function PlainList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="mt-2">
      <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1 list-disc pl-4 text-sm">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrainingStep({
  draft,
  courses,
  documents,
  onDraft,
}: {
  draft: TeamDraft;
  courses: WizardCourse[];
  documents: WizardDocument[];
  onDraft: (next: TeamDraft) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <CheckList
        title="Required training"
        hint="Chosen courses are assigned when you create the account."
        empty="No active training courses yet."
        options={courses.map((course) => ({ id: course.id, label: course.title, detail: course.description }))}
        selected={draft.trainingCourseIds}
        onChange={(trainingCourseIds) => onDraft({ ...draft, trainingCourseIds })}
      />
      <CheckList
        title="Documents to acknowledge"
        hint="Saved on their profile as a checklist. Document Control does not assign a read-and-sign on its own."
        empty="No approved or in-review documents yet."
        options={documents.map((doc) => ({ id: doc.id, label: doc.title, detail: doc.status }))}
        selected={draft.documentIds}
        onChange={(documentIds) => onDraft({ ...draft, documentIds })}
      />
    </div>
  );
}

function CheckList({
  title,
  hint,
  empty,
  options,
  selected,
  onChange,
}: {
  title: string;
  hint: string;
  empty: string;
  options: { id: number; label: string; detail?: string | null }[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{title}</legend>
      <p className="mb-2 text-xs text-muted-foreground">{hint}</p>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex max-h-64 flex-col gap-1 overflow-auto rounded-md border border-border p-2">
          {options.map((option) => (
            <label key={option.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.includes(option.id)}
                onChange={(event) => onChange(event.target.checked ? [...selected, option.id] : selected.filter((id) => id !== option.id))}
              />
              <span>
                {option.label}
                {option.detail && <span className="block text-xs text-muted-foreground">{option.detail}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function ReviewStep({
  draft,
  roles,
  people,
  sites,
  courses,
  documents,
  permissionRoles,
  onStep,
}: {
  draft: TeamDraft;
  roles: WizardRole[];
  people: WizardPerson[];
  sites: WizardSite[];
  courses: WizardCourse[];
  documents: WizardDocument[];
  permissionRoles: WizardPermissionRole[];
  onStep: (step: number) => void;
}) {
  const role = roles.find((item) => String(item.id) === draft.roleId);
  const manager = people.find((person) => String(person.id) === draft.managerId);
  const department = DEPARTMENTS.find((item) => item.key === draft.department)?.label;
  const siteNames = draft.allSites ? "All sites" : sites.filter((site) => draft.siteIds.includes(site.id)).map((site) => site.name).join(", ");
  const courseNames = courses.filter((course) => draft.trainingCourseIds.includes(course.id)).map((course) => course.title);
  const documentNames = documents.filter((doc) => draft.documentIds.includes(doc.id)).map((doc) => doc.title);
  const extra = permissionRoles.filter((roleItem) => draft.permissionRoleIds.includes(roleItem.id)).map((roleItem) => roleItem.roleName);

  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid="team-review">
      <UserAvatar name={draft.preferredName || draft.name} src={draft.photoDataUrl || null} size={72} />
      <Summary title="Identity & role" onEdit={() => onStep(0)}>
        <Line label="Name" value={draft.name} />
        <Line label="Preferred name" value={draft.preferredName} />
        <Line label="Job title" value={draft.jobTitle} />
        <Line label="Role" value={role ? roleLabel(role) : ""} />
        <Line label="Department" value={department ?? ""} />
        <Line label="Manager" value={manager ? personLabel(manager) : ""} />
        <Line label="Sites" value={siteNames} />
      </Summary>
      <Summary title="About" onEdit={() => onStep(1)}>
        <Line label="Work email" value={draft.email} />
        <Line label="Phone" value={draft.phone} />
        <Line label="Employee ID" value={draft.employeeId} />
        <Line label="Hire date" value={draft.hireDate} />
        <Line label="Employment" value={EMPLOYMENT_LABELS[draft.employmentType] ?? ""} />
        <Line label="Shift" value={SHIFT_LABELS[draft.shift] ?? ""} />
        <Line label="Location" value={draft.siteLocation} />
        <Line label="Bio" value={draft.bio} />
      </Summary>
      <Summary title="Access & sign-in" onEdit={() => onStep(2)}>
        <Line label="Temporary password" value={draft.password ? "Set. They change it at first sign-in." : ""} />
        <Line label="Two-step" value={draft.requireMfa ? "Required" : "Not required"} />
        <Line label="Extra roles" value={extra.join(", ")} />
      </Summary>
      <Summary title="Training & onboarding" onEdit={() => onStep(3)}>
        <Line label="Training" value={courseNames.join(", ")} />
        <Line label="Documents" value={documentNames.join(", ")} />
      </Summary>
    </div>
  );
}

function Summary({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <section className="rounded-md border border-border p-3 md:col-span-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <button type="button" onClick={onEdit} className="text-xs text-primary hover:underline">
          Edit
        </button>
      </div>
      <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">{children}</dl>
    </section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{value.trim() ? value : "—"}</dd>
    </>
  );
}

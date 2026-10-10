import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { isFullAccessRole } from "../../lib/fullAccess";
import { TextField, SelectField } from "../../components/forms/Field";
import { UserAvatar } from "../../components/shared/UserAvatar";
import { EntityAuditTrailPanel } from "../../components/shared/EntityAuditTrailPanel";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { DEPARTMENTS } from "../../components/layout/navConfig";
import { createResourceHooks } from "../../api/resourceHooks";
import type { AppRole } from "../../api/types";
import { EMPLOYMENT_LABELS, SHIFT_LABELS } from "./newTeamMember";
import { useSites } from "../../hooks/useSites";

const roleHooks = createResourceHooks<AppRole>("roles");

interface ProfileDocument {
  id: number;
  title: string;
}
interface ProfileCourse {
  id: number;
  title: string;
}
interface StaffProfile {
  id: number;
  email?: string;
  name: string | null;
  preferredName?: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  employeeId?: string | null;
  hireDate?: string | null;
  employmentType?: string | null;
  shift?: string | null;
  siteLocation?: string | null;
  bio?: string | null;
  roleId?: number | null;
  department?: string | null;
  managerId?: number | null;
  managerName?: string | null;
  isActive?: boolean;
  requireMfa?: boolean;
  avatarUrl?: string | null;
  profileStored?: boolean;
  sites?: { id: number; name: string }[];
  permissionRoles?: { id: number; name: string }[];
  onboardingChecklist?: { documents: ProfileDocument[]; courses: ProfileCourse[] };
}

function dataUrlToFile(dataUrl: string): File {
  const [header, body] = dataUrl.split(",");
  const mime = /data:(.*?);/.exec(header ?? "")?.[1] || "image/jpeg";
  const binary = atob(body ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], "portrait.jpg", { type: mime });
}

export function UserProfilePage() {
  const params = useParams();
  const id = Number(params.id);
  const toast = useToast();
  const queryClient = useQueryClient();
  const current = useCurrentUser();
  const admin = isFullAccessRole(current?.roleName);
  const self = current?.id === id;
  const { data: roles = [] } = roleHooks.useList();
  const siteQuery = useSites();
  const profile = useQuery({
    queryKey: ["users", id],
    enabled: Number.isInteger(id) && id > 0,
    queryFn: async () => (await apiClient.get<StaffProfile>(`/users/${id}`)).data,
  });
  const people = useQuery({
    queryKey: ["users"],
    enabled: admin,
    queryFn: async () => (await apiClient.get<StaffProfile[]>("/users")).data,
  });

  const [editing, setEditing] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [form, setForm] = useState<StaffProfile | null>(null);

  function startEdit(row: StaffProfile) {
    setForm({ ...row, sites: row.sites ?? [] });
    setPhoto(null);
    setEditing(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      let avatarAttachmentId: number | undefined;
      if (photo) {
        const body = new FormData();
        body.append("file", dataUrlToFile(photo));
        const uploaded = await apiClient.post<{ id: number }>("/attachments", body);
        avatarAttachmentId = uploaded.data.id;
      }
      if (self && !admin) {
        await apiClient.patch(`/users/me/profile`, {
          preferredName: form.preferredName ?? null,
          phone: form.phone ?? null,
          siteLocation: form.siteLocation ?? null,
          bio: form.bio ?? null,
          ...(avatarAttachmentId ? { avatarAttachmentId } : {}),
        });
        return;
      }
      const siteIds = (form.sites ?? []).map((site) => site.id);
      await apiClient.patch(`/users/${id}`, {
        name: form.name ?? "",
        email: form.email,
        roleId: form.roleId ?? null,
        department: form.department || null,
        managerId: form.managerId ?? null,
        isActive: form.isActive,
        preferredName: form.preferredName ?? null,
        jobTitle: form.jobTitle ?? null,
        phone: form.phone ?? null,
        employeeId: form.employeeId ?? null,
        hireDate: form.hireDate || null,
        employmentType: form.employmentType || null,
        shift: form.shift || null,
        siteLocation: form.siteLocation ?? null,
        bio: form.bio ?? null,
        requireMfa: form.requireMfa,
        siteIds,
        allSites: false,
        ...(avatarAttachmentId ? { avatarAttachmentId } : {}),
      });
    },
    onSuccess: () => {
      toast.success("Saved.");
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({ queryKey: ["users", id] });
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save that profile.")),
  });

  const row = profile.data;
  if (!Number.isInteger(id) || id <= 0) return <p className="text-sm text-muted-foreground">That profile address isn't valid.</p>;
  if (profile.isLoading) return <p className="text-sm text-muted-foreground">Loading profile…</p>;
  if (profile.isError || !row) return <p className="text-sm text-destructive">Couldn't open that profile.</p>;
  if (row.email == null && !self) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{row.name ?? "Team member"}</h1>
        <p className="text-sm text-muted-foreground">The full profile is available to an administrator, and to this person for their own photo and contact details.</p>
      </div>
    );
  }

  const display = form && editing ? form : row;
  const plants = (siteQuery.data?.sites ?? []).filter((site) => site.status === "active");
  const canEdit = admin || self;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <UserAvatar userId={row.id} name={display.preferredName || display.name} hasPhoto={Boolean(row.avatarUrl)} src={photo} size={56} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Team member</p>
            <h1 className="text-2xl font-semibold">{display.name || display.email}</h1>
            <p className="text-sm text-muted-foreground">
              {[display.preferredName && display.preferredName !== display.name ? `Goes by ${display.preferredName}` : null, display.jobTitle, display.email].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {admin && (
            <Link to="/admin/users" className="rounded-md border border-border px-3 py-1.5 text-sm">
              All users
            </Link>
          )}
          {canEdit && !editing && (
            <button type="button" onClick={() => startEdit(row)} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
              Edit
            </button>
          )}
        </div>
      </div>

      {row.profileStored === false && <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">Profile details appear after the database update runs.</p>}

      {editing && form ? (
        <form
          className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          {admin && <TextField label="Full name" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
          {(admin || self) && <TextField label="Preferred name" value={form.preferredName ?? ""} onChange={(e) => setForm({ ...form, preferredName: e.target.value })} />}
          {admin && <TextField label="Job title" value={form.jobTitle ?? ""} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />}
          {admin && <TextField label="Work email" type="email" required value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
          {(admin || self) && <TextField label="Phone or extension" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}
          {admin && <TextField label="Employee ID" value={form.employeeId ?? ""} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} />}
          {admin && <TextField label="Hire date" type="date" value={form.hireDate ?? ""} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} />}
          {admin && (
            <SelectField label="Employment type" value={form.employmentType ?? ""} onChange={(e) => setForm({ ...form, employmentType: e.target.value || null })}>
              <option value="">Not set</option>
              {Object.entries(EMPLOYMENT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
          )}
          {admin && (
            <SelectField label="Shift" value={form.shift ?? ""} onChange={(e) => setForm({ ...form, shift: e.target.value || null })}>
              <option value="">Not set</option>
              {Object.entries(SHIFT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
          )}
          {(admin || self) && <TextField label="Location within the site" value={form.siteLocation ?? ""} onChange={(e) => setForm({ ...form, siteLocation: e.target.value })} />}
          {admin && (
            <SelectField label="Role" value={form.roleId ? String(form.roleId) : ""} onChange={(e) => setForm({ ...form, roleId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">No role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.displayName || role.name}
                </option>
              ))}
            </SelectField>
          )}
          {admin && (
            <SelectField label="Department" value={form.department ?? ""} onChange={(e) => setForm({ ...form, department: e.target.value || null })}>
              <option value="">None</option>
              {DEPARTMENTS.map((department) => (
                <option key={department.key} value={department.key}>
                  {department.label}
                </option>
              ))}
            </SelectField>
          )}
          {admin && (
            <SelectField label="Manager" value={form.managerId ? String(form.managerId) : ""} onChange={(e) => setForm({ ...form, managerId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">None</option>
              {(people.data ?? [])
                .filter((person) => person.id !== id && person.isActive !== false)
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name || person.email}
                  </option>
                ))}
            </SelectField>
          )}
          {(admin || self) && (
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              <span className="text-xs font-semibold text-muted-foreground">Short bio</span>
              <textarea
                rows={3}
                maxLength={500}
                value={form.bio ?? ""}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
                className="w-full rounded-[9px] border border-form-field bg-[hsl(var(--form-input))] px-2.5 py-2 text-sm outline-none focus:border-ring"
              />
            </label>
          )}
          {(admin || self) && (
            <label className="text-xs font-semibold text-muted-foreground md:col-span-2">
              Profile photo
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="mt-1 block text-sm font-normal"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => setPhoto(typeof reader.result === "string" ? reader.result : null);
                  reader.readAsDataURL(file);
                }}
              />
            </label>
          )}
          {admin && (
            <fieldset className="md:col-span-2">
              <legend className="mb-1 text-xs font-semibold text-muted-foreground">Sites</legend>
              <div className="flex flex-wrap gap-2">
                {plants.map((site) => {
                  const checked = (form.sites ?? []).some((chosen) => chosen.id === site.id);
                  return (
                    <label key={site.id} className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const sites = event.target.checked ? [...(form.sites ?? []), { id: site.id, name: site.name }] : (form.sites ?? []).filter((chosen) => chosen.id !== site.id);
                          setForm({ ...form, sites });
                        }}
                      />
                      {site.name}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          {admin && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.requireMfa === true} onChange={(e) => setForm({ ...form, requireMfa: e.target.checked })} />
              Require two-step sign-in
            </label>
          )}
          {admin && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive !== false} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              Active — they can sign in
            </label>
          )}
          <div className="flex gap-2 md:col-span-2">
            <button type="submit" disabled={save.isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
              {save.isPending ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-border px-3 py-1.5 text-sm">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <Card title="Identity & role">
            <Fact label="Preferred name" value={row.preferredName} />
            <Fact label="Job title" value={row.jobTitle} />
            <Fact label="Role" value={roles.find((role) => role.id === row.roleId)?.displayName || roles.find((role) => role.id === row.roleId)?.name} />
            <Fact label="Department" value={DEPARTMENTS.find((department) => department.key === row.department)?.label} />
            <Fact label="Manager" value={row.managerName} />
            <Fact label="Sites" value={(row.sites ?? []).map((site) => site.name).join(", ")} />
          </Card>
          <Card title="About">
            <Fact label="Work email" value={row.email} />
            <Fact label="Phone" value={row.phone} />
            <Fact label="Employee ID" value={row.employeeId} />
            <Fact label="Hire date" value={row.hireDate} />
            <Fact label="Employment" value={row.employmentType ? EMPLOYMENT_LABELS[row.employmentType] : null} />
            <Fact label="Shift" value={row.shift ? SHIFT_LABELS[row.shift] : null} />
            <Fact label="Location" value={row.siteLocation} />
            <Fact label="Bio" value={row.bio} />
          </Card>
          <Card title="Access">
            <Fact label="Two-step required" value={row.requireMfa ? "Yes" : "No"} />
            <Fact label="Extra permission roles" value={(row.permissionRoles ?? []).map((role) => role.name).join(", ")} />
            {admin && (
              <p className="text-sm">
                <Link to="/admin/roles-permissions" className="text-primary hover:underline">
                  Adjust permissions
                </Link>
              </p>
            )}
          </Card>
          <Card title="Training & documents">
            <Fact label="Training" value={(row.onboardingChecklist?.courses ?? []).map((course) => course.title).join(", ")} />
            <Fact label="Documents to acknowledge" value={(row.onboardingChecklist?.documents ?? []).map((doc) => doc.title).join(", ")} />
          </Card>
        </div>
      )}

      {(admin || self) && <EntityAuditTrailPanel entityType="User" entityId={id} title="Record history" />}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">{children}</dl>
    </section>
  );
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{value?.trim() ? value : "—"}</dd>
    </>
  );
}

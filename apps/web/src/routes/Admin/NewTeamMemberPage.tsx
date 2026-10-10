import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { createResourceHooks } from "../../api/resourceHooks";
import { useSites } from "../../hooks/useSites";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import type { AppRole, AppUser } from "../../api/types";
import { emptyTeamDraft, validateTeamStep, type TeamDraft } from "./newTeamMember";
import { NewTeamMemberWizard, type AccessPreview, type WizardCourse, type WizardDocument, type WizardPermissionRole } from "./NewTeamMemberWizard";

const userHooks = createResourceHooks<AppUser>("users");
const roleHooks = createResourceHooks<AppRole>("roles");
const DRAFT_KEY = "accuqual.new-team-member";

function duplicateEmail(step: number, draft: TeamDraft, people: { email: string }[]): string | null {
  if (step !== 1) return null;
  const email = draft.email.trim().toLowerCase();
  if (!email) return null;
  return people.some((person) => person.email.trim().toLowerCase() === email) ? "That email is already in use." : null;
}

function readStored(): { step: number; draft: TeamDraft } | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { step?: number; draft?: Partial<TeamDraft> };
    if (!parsed.draft || typeof parsed.step !== "number") return null;
    return { step: Math.min(4, Math.max(0, parsed.step)), draft: { ...emptyTeamDraft(), ...parsed.draft, password: "" } };
  } catch {
    return null;
  }
}

function dataUrlToFile(dataUrl: string): File {
  const [header, body] = dataUrl.split(",");
  const mime = /data:(.*?);/.exec(header ?? "")?.[1] || "image/jpeg";
  const binary = atob(body ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], "portrait.jpg", { type: mime });
}

export function NewTeamMemberPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const stored = readStored();
  const [step, setStep] = useState(stored?.step ?? 0);
  const [draft, setDraft] = useState<TeamDraft>(stored?.draft ?? emptyTeamDraft());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: number; name: string } | null>(null);

  const { data: users = [] } = userHooks.useList();
  const { data: roles = [] } = roleHooks.useList();
  const siteQuery = useSites();
  const plants = siteQuery.data?.sites ?? [];
  const catalog = useQuery({
    queryKey: ["onboarding-catalog"],
    queryFn: async () => (await apiClient.get<{ courses: WizardCourse[]; documents: WizardDocument[] }>("/users/onboarding-catalog")).data,
  });
  const permissionRoles = useQuery({
    queryKey: ["permissions", "roles"],
    queryFn: async () => (await apiClient.get<WizardPermissionRole[]>("/permissions/roles")).data,
  });
  const preview = useQuery({
    queryKey: ["access-preview", draft.roleId, draft.department, draft.permissionRoleIds.join(",")],
    enabled: draft.roleId !== "",
    queryFn: async () =>
      (
        await apiClient.get<AccessPreview>("/users/access-preview", {
          params: {
            roleId: draft.roleId,
            department: draft.department || undefined,
            permissionRoleIds: draft.permissionRoleIds.join(","),
          },
        })
      ).data,
  });

  useEffect(() => {
    if (created) return;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step, draft: { ...draft, password: "" } }));
  }, [draft, step, created]);

  function go(next: number) {
    setError(null);
    setStep(next);
  }

  function next() {
    const problem = validateTeamStep(step, draft) ?? duplicateEmail(step, draft, users);
    if (problem) {
      setError(problem);
      return;
    }
    go(step + 1);
  }

  async function create() {
    for (let index = 0; index < 3; index++) {
      const problem = validateTeamStep(index, draft) ?? duplicateEmail(index, draft, users);
      if (problem) {
        setError(problem);
        setStep(index);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      let avatarAttachmentId: number | null = null;
      if (draft.photoDataUrl) {
        const body = new FormData();
        body.append("file", dataUrlToFile(draft.photoDataUrl));
        const uploaded = await apiClient.post<{ id: number }>("/attachments", body);
        avatarAttachmentId = uploaded.data.id;
      }
      const res = await apiClient.post<{ id: number; name: string | null; profileStored?: boolean }>("/users", {
        email: draft.email.trim(),
        password: draft.password,
        name: draft.name.trim(),
        roleId: Number(draft.roleId),
        department: draft.department || null,
        managerId: draft.managerId ? Number(draft.managerId) : null,
        preferredName: draft.preferredName.trim() || null,
        jobTitle: draft.jobTitle.trim() || null,
        phone: draft.phone.trim() || null,
        employeeId: draft.employeeId.trim() || null,
        hireDate: draft.hireDate || null,
        employmentType: draft.employmentType || null,
        shift: draft.shift || null,
        siteLocation: draft.siteLocation.trim() || null,
        bio: draft.bio.trim() || null,
        avatarAttachmentId,
        requireMfa: draft.requireMfa,
        siteIds: draft.siteIds,
        allSites: draft.allSites,
        trainingCourseIds: draft.trainingCourseIds,
        documentIds: draft.documentIds,
        permissionRoleIds: draft.permissionRoleIds,
      });
      sessionStorage.removeItem(DRAFT_KEY);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      if (res.data.profileStored === false) toast.error("The account was created. Profile details wait until the database update runs.");
      else toast.success("Team member created. They'll choose their own password the first time they sign in.");
      setCreated({ id: res.data.id, name: res.data.name?.trim() || draft.name.trim() });
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't create that team member."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <NewTeamMemberWizard
      step={step}
      draft={draft}
      error={error}
      busy={busy}
      roles={roles}
      people={users}
      sites={plants.filter((site) => site.status === "active").map((site) => ({ id: site.id, name: site.name }))}
      courses={catalog.data?.courses ?? []}
      documents={catalog.data?.documents ?? []}
      permissionRoles={permissionRoles.data ?? []}
      preview={preview.data ?? null}
      created={created}
      onDraft={(nextDraft) => {
        setDraft(nextDraft);
        setError(null);
      }}
      onStep={go}
      onNext={next}
      onCreate={() => void create()}
      onAddAnother={() => {
        setCreated(null);
        setDraft(emptyTeamDraft());
        setStep(0);
        setError(null);
      }}
    />
  );
}

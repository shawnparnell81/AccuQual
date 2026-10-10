export const TEAM_STEPS = [
  { id: "identity", label: "Identity & role" },
  { id: "about", label: "About" },
  { id: "access", label: "Access & sign-in" },
  { id: "training", label: "Training" },
  { id: "review", label: "Review" },
] as const;

export interface TeamDraft {
  name: string;
  preferredName: string;
  jobTitle: string;
  roleId: string;
  department: string;
  managerId: string;
  siteIds: number[];
  allSites: boolean;
  email: string;
  phone: string;
  employeeId: string;
  hireDate: string;
  employmentType: string;
  shift: string;
  siteLocation: string;
  bio: string;
  photoDataUrl: string;
  password: string;
  requireMfa: boolean;
  permissionRoleIds: number[];
  trainingCourseIds: number[];
  documentIds: number[];
}

export function emptyTeamDraft(): TeamDraft {
  return {
    name: "",
    preferredName: "",
    jobTitle: "",
    roleId: "",
    department: "",
    managerId: "",
    siteIds: [],
    allSites: false,
    email: "",
    phone: "",
    employeeId: "",
    hireDate: "",
    employmentType: "",
    shift: "",
    siteLocation: "",
    bio: "",
    photoDataUrl: "",
    password: "",
    requireMfa: false,
    permissionRoleIds: [],
    trainingCourseIds: [],
    documentIds: [],
  };
}

export function validateTeamStep(step: number, draft: TeamDraft): string | null {
  if (step === 0) {
    if (!draft.name.trim()) return "Enter their full name.";
    if (!draft.roleId) return "Choose a role.";
    if (!draft.allSites && draft.siteIds.length === 0) return "Choose at least one site, or All sites.";
    return null;
  }
  if (step === 1) {
    if (!draft.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) return "Enter their work email. That address is how they sign in.";
    if (draft.hireDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.hireDate)) return "Use a hire date like 2026-04-02.";
    return null;
  }
  if (step === 2) {
    if (draft.password.length < 12) return "The temporary password needs at least 12 characters.";
    return null;
  }
  return null;
}

export const EMPLOYMENT_LABELS: Record<string, string> = {
  full_time: "Full time",
  part_time: "Part time",
  contractor: "Contractor",
  temporary: "Temporary",
};

export const SHIFT_LABELS: Record<string, string> = {
  day: "Day",
  evening: "Evening",
  night: "Night",
  rotating: "Rotating",
};

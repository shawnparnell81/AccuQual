/** GET /dashboard/overview — real counts only. Null means this person can't see that module. */

export interface DashboardOverview {
  partial: boolean;
  scope: { allPlants: boolean; label: string; siteIds: number[] };
  kpis: {
    openIssues: { access: boolean; value: number | null; highCritical: number | null; spark: number[] };
    overdueFixes: { access: boolean; value: number | null; openTotal: number | null };
    docsDue: { access: boolean; value: number | null; waitingApproval: number | null; companyWide: true };
    training: { access: boolean; percent: number | null; overdue: number | null; assigned: number | null };
    calibration: { access: boolean; value: number | null; overdue: number | null; failed: number | null; dueSoon: number | null; companyWide: true };
    auditFindings: { access: boolean; value: number | null; total: number | null };
  };
  engineering: {
    changes: { access: boolean; open: number | null; inReview: number | null; approved: number | null; companyWide: true };
    ppap: { access: boolean; pending: number | null; awaitingCustomer: number | null; companyWide: true };
    deviations: { available: false; reason: string };
    apqp: { available: false; reason: string };
  };
  trend: { access: boolean; labels: string[]; opened: number[]; closed: number[] };
  pareto: { access: boolean; basis: "root-cause"; items: { label: string; value: number }[] };
  aging: { categories: string[]; issues: number[] | null; fixes: number[] | null };
  tasks: { id: string; href: string; ref: string; title: string; kind: string; due: string | null }[];
  stuck: { id: string; href: string; ref: string; title: string; why: string; tone: "warn" | "bad"; who: string }[];
  plants: {
    id: number;
    name: string;
    code: string;
    openIssues: number | null;
    lateFixes: number | null;
    trainingPercent: number | null;
    trainingOverdue: number | null;
  }[];
  gagesByPlant: false;
  activity: { id: number; at: string | null; text: string; href: string | null; by: string }[];
  openWork: OpenWork;
}

/** Open quality records on the signed-in dashboard. Counts are real rows only. */
export interface OpenWork {
  cards: { key: string; label: string; value: number; foot: string; href: string | null; module: string | null; modules?: string[] | null }[];
  modules: { key: string; label: string }[];
  plants: { id: number; name: string }[];
  records: {
    id: string;
    module: string;
    href: string;
    number: string;
    title: string;
    status: string;
    plantId: number | null;
    plant: string | null;
    owner: string | null;
    updatedAt: string | null;
    ageDays: number | null;
  }[];
  truncated: boolean;
}

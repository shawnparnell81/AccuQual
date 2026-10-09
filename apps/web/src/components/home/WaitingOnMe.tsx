import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";

interface WaitingItem {
  id: string;
  module: string;
  number: string;
  description: string;
  assignedTo: string;
  dueDate: string | null;
  timing: string;
  status: string;
  href: string;
}

interface WaitingResponse {
  items: WaitingItem[];
  groups: { key: string; items: WaitingItem[] }[];
  prefs: { sort: string; group: string; module: string; timing: string };
}

const SORTS = [
  ["due", "Due"],
  ["module", "Module"],
  ["status", "Status"],
] as const;
const GROUPS = [
  ["module", "Module"],
  ["status", "Status"],
  ["none", "None"],
] as const;
const TIMINGS = [
  ["all", "All"],
  ["late", "Late"],
  ["due", "Has a due date"],
] as const;

/** Records already assigned to this person, or due in a module they can read. */
export function WaitingOnMe() {
  const qc = useQueryClient();
  const [prefs, setPrefs] = useState<WaitingResponse["prefs"] | null>(null);
  const active = prefs;
  const list = useQuery({
    queryKey: ["dashboard", "waiting-on-me", active],
    queryFn: async () => (await apiClient.get<WaitingResponse>("/dashboard/waiting-on-me", { params: active ?? {} })).data,
  });
  const shown = active ?? list.data?.prefs;
  const save = useMutation({
    mutationFn: async (next: WaitingResponse["prefs"]) => (await apiClient.put("/users/me/workspace-layout", { waitingOnMe: next })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users/me/workspace-layout"] }),
  });

  function update(patch: Partial<WaitingResponse["prefs"]>) {
    const next = { sort: "due", group: "module", module: "all", timing: "all", ...shown, ...patch };
    setPrefs(next);
    save.mutate(next);
  }

  const modules = ["all", ...new Set((list.data?.items ?? []).map((row) => row.module))];
  const groups = list.data?.groups ?? [];

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wide">WAITING ON ME</h2>
          <p className="text-sm text-muted-foreground">Open work assigned to you, plus gages you can already see.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <select className="rounded-md border border-border bg-background px-2 py-1" value={shown?.sort ?? "due"} onChange={(event) => update({ sort: event.target.value })}>
            {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select className="rounded-md border border-border bg-background px-2 py-1" value={shown?.group ?? "module"} onChange={(event) => update({ group: event.target.value })}>
            {GROUPS.map(([value, label]) => <option key={value} value={value}>Group: {label}</option>)}
          </select>
          <select className="rounded-md border border-border bg-background px-2 py-1" value={shown?.module ?? "all"} onChange={(event) => update({ module: event.target.value })}>
            {modules.map((value) => <option key={value} value={value}>{value === "all" ? "All modules" : value}</option>)}
          </select>
          <select className="rounded-md border border-border bg-background px-2 py-1" value={shown?.timing ?? "all"} onChange={(event) => update({ timing: event.target.value })}>
            {TIMINGS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>
      {list.isLoading && <p className="mt-3 text-sm text-muted-foreground">Loading your list…</p>}
      {list.isError && <p className="mt-3 text-sm text-destructive">The waiting list could not be loaded.</p>}
      {!list.isLoading && groups.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Nothing is waiting on you.</p>}
      <div className="mt-3 flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.key}>
            {shown?.group !== "none" && <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.key}</h3>}
            <ul className="divide-y divide-border text-sm">
              {group.items.map((row) => (
                <li key={row.id} className="grid gap-1 py-2 sm:grid-cols-[8rem_1fr_8rem_8rem]">
                  <Link to={row.href} className="font-medium text-primary hover:underline">{row.number}</Link>
                  <span>{row.description}</span>
                  <span className="text-muted-foreground">{row.assignedTo} · {row.status}</span>
                  <span className={row.timing.includes("late") ? "text-destructive" : "text-muted-foreground"}>{row.timing}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

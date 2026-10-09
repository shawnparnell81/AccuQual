import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { apiClient } from "../../api/client";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { TruncatedName } from "../../components/shared/TruncatedName";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

interface LoginHistoryItem {
  occurredAt: string;
  userName: string | null;
  email: string | null;
  event: "signed_in" | "sign_in_failed" | "signed_out";
  eventLabel: string;
  success: boolean;
  reason: string | null;
  ipAddress: string | null;
  location: string;
  device: string;
  userAgent: string | null;
}

interface LoginHistoryPageData {
  items: LoginHistoryItem[];
  page: number;
  pageSize: number;
  total: number;
  unavailable: boolean;
}

const EVENT_OPTIONS = [
  { value: "", label: "All events" },
  { value: "signed_in", label: "Signed in" },
  { value: "sign_in_failed", label: "Sign-in failed" },
  { value: "signed_out", label: "Signed out" },
];

const RESULT_OPTIONS = [
  { value: "", label: "Succeeded and failed" },
  { value: "true", label: "Succeeded" },
  { value: "false", label: "Failed" },
];

function formatLoginTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function localDayStart(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year!, (month ?? 1) - 1, day ?? 1, 0, 0, 0, 0).toISOString();
}

function localDayEnd(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year!, (month ?? 1) - 1, day ?? 1, 23, 59, 59, 999).toISOString();
}

function userTitle(item: LoginHistoryItem): string {
  const name = item.userName?.trim();
  const email = item.email?.trim();
  if (name && email && name !== email) return `${name} · ${email}`;
  return name || email || "Unknown";
}

function resultText(item: LoginHistoryItem): string {
  const outcome = item.success ? "Succeeded" : "Failed";
  return item.reason ? `${outcome} · ${item.reason}` : outcome;
}

function dash(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

export function LoginHistoryPage() {
  const toast = useToast();
  const [user, setUser] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [event, setEvent] = useState("");
  const [success, setSuccess] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const filters = {
    user: user.trim() || undefined,
    from: from ? localDayStart(from) : undefined,
    to: to ? localDayEnd(to) : undefined,
    event: event || undefined,
    success: success || undefined,
    page,
    pageSize: 25,
  };

  const query = useQuery<LoginHistoryPageData>({
    queryKey: ["login-history", filters],
    queryFn: async () => (await apiClient.get<LoginHistoryPageData>("/login-history", { params: filters })).data,
  });

  const total = query.data?.total ?? 0;
  const pageSize = query.data?.pageSize ?? 25;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const forbidden = query.isError && axios.isAxiosError(query.error) && query.error.response?.status === 403;

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await apiClient.get("/login-history/export", {
        params: { user: filters.user, from: filters.from, to: filters.to, event: filters.event, success: filters.success },
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data as Blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "login-history.csv";
      link.click();
      URL.revokeObjectURL(url);
      if (res.headers["x-export-truncated"] === "1") toast.error("The file has the newest 20,000 matching rows.");
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't export login history."));
    } finally {
      setExporting(false);
    }
  }

  function resetPage(next: () => void) {
    setPage(1);
    next();
  }

  return (
    <div className="flex flex-col gap-4 text-foreground">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Login History</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Who signed in, when, from where, and on what device. Times on this page use your time zone. The CSV file uses UTC. Records are kept for at least a year.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void exportCsv()}
          disabled={exporting || forbidden}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-60"
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      <form
        className="grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          User
          <input
            value={user}
            onChange={(event) => resetPage(() => setUser(event.target.value))}
            placeholder="Name or email"
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <input type="date" value={from} onChange={(event) => resetPage(() => setFrom(event.target.value))} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <input type="date" value={to} onChange={(event) => resetPage(() => setTo(event.target.value))} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Event
          <select value={event} onChange={(event) => resetPage(() => setEvent(event.target.value))} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground">
            {EVENT_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Result
          <select value={success} onChange={(event) => resetPage(() => setSuccess(event.target.value))} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground">
            {RESULT_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </form>

      {query.isLoading ? (
        <LoadingPlaceholder />
      ) : forbidden ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">Login history is limited to roles an administrator has allowed to see it.</p>
      ) : query.isError ? (
        <p className="text-sm text-destructive">Couldn't load login history.</p>
      ) : query.data?.unavailable ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">Login history will appear after the database update runs. Signing in still works.</p>
      ) : query.data?.items.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No sign-in events match these filters.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[960px] text-sm text-foreground">
              <thead className="bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Date/Time</th>
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Result/Reason</th>
                  <th className="px-3 py-2 font-medium">IP address</th>
                  <th className="px-3 py-2 font-medium">Location</th>
                  <th className="px-3 py-2 font-medium">Device</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.items.map((item, index) => (
                  <tr key={`${item.occurredAt}-${item.email ?? "unknown"}-${index}`} className="border-t border-border">
                    <td className="whitespace-nowrap px-3 py-2 text-foreground" title={formatLoginTime(item.occurredAt)}>
                      {formatLoginTime(item.occurredAt)}
                    </td>
                    <td className="max-w-[14rem] px-3 py-2">
                      <TruncatedName name={userTitle(item)} className="block max-w-[14rem] text-foreground" />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-foreground">{item.eventLabel}</td>
                    <td className="max-w-[16rem] px-3 py-2">
                      <TruncatedName name={resultText(item)} className={`block max-w-[16rem] ${item.success ? "text-foreground" : "text-destructive"}`} />
                    </td>
                    <td className="max-w-[10rem] px-3 py-2">
                      <TruncatedName name={dash(item.ipAddress)} className="block max-w-[10rem] text-foreground" />
                    </td>
                    <td className="max-w-[14rem] px-3 py-2">
                      <TruncatedName name={dash(item.location)} className="block max-w-[14rem] text-foreground" />
                    </td>
                    <td className="max-w-[18rem] px-3 py-2">
                      <TruncatedName name={dash(item.device)} className="block max-w-[18rem] text-foreground" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              {total === 0 ? "0 events" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
            </span>
            <span className="flex items-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="rounded-md border border-border bg-card px-2 py-1 text-foreground hover:bg-muted disabled:opacity-40">
                Previous
              </button>
              <span className="text-foreground">
                Page {page} of {pageCount}
              </span>
              <button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)} className="rounded-md border border-border bg-card px-2 py-1 text-foreground hover:bg-muted disabled:opacity-40">
                Next
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

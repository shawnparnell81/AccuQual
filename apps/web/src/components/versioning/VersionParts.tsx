import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { ArrowRight, History, RotateCcw } from "lucide-react";
import { Modal } from "../modals/Modal";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useCurrentUser } from "../../hooks/useAuth";
import { REVIEWER_ROLES, type CurrentState, type DiffEntry, type ValidationIssue, type VersionDiff, type VersionStatus, type VersionSummary, useVersionDiff } from "../../api/versioning";

const STATUS_LABEL: Record<VersionStatus, string> = { draft: "Draft", in_review: "In review", published: "Published", archived: "Archived" };
const STATUS_CLASS: Record<VersionStatus, string> = {
  draft: "bg-warning/15 text-warning",
  in_review: "bg-primary/15 text-primary",
  published: "bg-success/15 text-success",
  archived: "bg-muted text-muted-foreground",
};

export function VersionStatusBadge({ status, className }: { status: VersionStatus; className?: string }) {
  return <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", STATUS_CLASS[status], className)}>{STATUS_LABEL[status]}</span>;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

// ---- Timeline -----------------------------------------------------------------------------------------------------------------------------------

interface TimelineProps {
  versions: VersionSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCompare: (id: number) => void;
  /** Present only when the signed-in user may roll back and nothing is already open. */
  onRollback?: (versionNumber: number) => void;
}

/** Newest first. Each entry says what happened and who did it; select one to view it, compare it with the version before, or roll back to it. */
export function VersionTimeline({ versions, selectedId, onSelect, onCompare, onRollback }: TimelineProps) {
  if (versions.length === 0) return <p className="text-sm text-muted-foreground">No versions yet.</p>;
  return (
    <ol className="flex flex-col">
      {versions.map((v, i) => (
        <li key={v.id} className="relative flex gap-3 pb-4 last:pb-0">
          <div className="flex flex-col items-center">
            <span className={clsx("mt-1 h-2.5 w-2.5 rounded-full", v.status === "published" ? "bg-success" : v.status === "draft" ? "bg-warning" : v.status === "in_review" ? "bg-primary" : "bg-muted-foreground/50")} />
            {i < versions.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
          </div>
          <div className={clsx("min-w-0 flex-1 rounded-md border p-2 text-sm", selectedId === v.id ? "border-primary bg-primary/5" : "border-border")}>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => onSelect(v.id)} className="font-semibold hover:underline">
                Version {v.versionNumber}
              </button>
              <VersionStatusBadge status={v.status} />
              {v.isRollback && <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><RotateCcw size={11} /> restores v{v.basedOnVersion}</span>}
            </div>
            {v.metadata?.summary && <p className="mt-0.5 text-xs">{v.metadata.summary}</p>}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {v.publishedAt ? `Published ${when(v.publishedAt)} by ${v.publishedByName ?? "—"}` : v.status === "in_review" ? `Submitted ${when(v.submittedAt)} by ${v.submittedByName ?? "—"}` : `Started ${when(v.createdAt)} by ${v.createdByName ?? "—"}`}
            </p>
            {v.reviewedAt && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {v.reviewDecision === "approved" ? "Approved" : "Sent back"} by {v.reviewedByName ?? "—"}
                {v.reviewNotes ? ` — “${v.reviewNotes}”` : ""}
              </p>
            )}
            <div className="mt-1.5 flex gap-3 text-xs">
              <button onClick={() => onCompare(v.id)} className="inline-flex items-center gap-1 text-primary hover:underline">
                <History size={12} /> Compare with previous
              </button>
              {onRollback && v.status === "archived" && (
                <button onClick={() => onRollback(v.versionNumber)} className="inline-flex items-center gap-1 text-primary hover:underline">
                  <RotateCcw size={12} /> Roll back to this
                </button>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---- Diff viewer ---------------------------------------------------------------------------------------------------------------------------------

const CHANGE_STYLE: Record<DiffEntry["change"], { bar: string; tag: string; label: string }> = {
  added: { bar: "border-l-success", tag: "bg-success/15 text-success", label: "Added" },
  removed: { bar: "border-l-destructive", tag: "bg-destructive/15 text-destructive", label: "Removed" },
  changed: { bar: "border-l-warning", tag: "bg-warning/15 text-warning", label: "Changed" },
};
const SCOPE_TITLE: Record<DiffEntry["scope"], string> = { node: "Steps", transition: "Transitions", metadata: "Details", field: "Fields", row: "Table rows", content: "Content", attachment: "Files", link: "Linked records" };

function show(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("type" in o && "kind" in o) return `${o.label ? `${o.label} — ` : ""}${String(o.type)}: ${String(o.kind)}`; // a whole node
    if ("from" in o && "to" in o) return `${String(o.from)} → ${String(o.to)}${o.branch ? ` (${String(o.branch)})` : ""}`; // a whole transition
    if ("sha256" in o) return `${Number(o.sizeBytes ?? 0).toLocaleString()} bytes · checksum ${String(o.sha256).slice(0, 8)}`; // a stored file
    return Object.values(o).filter((x) => x !== "" && x != null).join(" · ") || JSON.stringify(v);
  }
  return String(v);
}

export function DiffEntries({ entries }: { entries: DiffEntry[] }) {
  if (entries.length === 0) return <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">No differences.</p>;
  const groups = (["node", "transition", "field", "row", "metadata", "content", "attachment", "link"] as const).map((scope) => ({ scope, items: entries.filter((e) => e.scope === scope) })).filter((g) => g.items.length > 0);
  return (
    <div className="flex flex-col gap-4">
      {groups.map(({ scope, items }) => (
        <section key={scope}>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{SCOPE_TITLE[scope]}</h4>
          <ul className="flex flex-col gap-1.5">
            {items.map((e) => (
              <li key={`${e.scope}:${e.key}:${e.change}`} className={clsx("rounded-md border border-border border-l-4 p-2 text-sm", CHANGE_STYLE[e.change].bar)}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={clsx("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", CHANGE_STYLE[e.change].tag)}>{CHANGE_STYLE[e.change].label}</span>
                  <span className="font-medium">{e.label}</span>
                </div>
                {e.lines && <LineDiffBlock lines={e.lines} />}
                {e.change === "changed" && !e.details && !e.lines && (
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded bg-destructive/10 px-1.5 py-0.5 line-through">{show(e.from)}</span>
                    <ArrowRight size={12} className="text-muted-foreground" />
                    <span className="rounded bg-success/10 px-1.5 py-0.5">{show(e.to)}</span>
                  </p>
                )}
                {e.change === "added" && e.to !== undefined && !e.lines && scope !== "node" && scope !== "transition" && <p className="mt-1 rounded bg-success/10 px-1.5 py-0.5 text-xs">{show(e.to)}</p>}
                {e.change === "removed" && e.from !== undefined && !e.lines && scope !== "node" && scope !== "transition" && <p className="mt-1 rounded bg-destructive/10 px-1.5 py-0.5 text-xs line-through">{show(e.from)}</p>}
                {e.details?.map((d) => (
                  <p key={d.field} className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">{d.field}:</span>
                    <span className="rounded bg-destructive/10 px-1.5 py-0.5 line-through">{show(d.from)}</span>
                    <ArrowRight size={12} className="text-muted-foreground" />
                    <span className="rounded bg-success/10 px-1.5 py-0.5">{show(d.to)}</span>
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** A text body's comparison: every changed line, with a little unchanged context; long unchanged runs are folded. */
function LineDiffBlock({ lines }: { lines: NonNullable<DiffEntry["lines"]> }) {
  const CONTEXT = 2;
  const keep = lines.map((l, i) => l.op !== "same" || lines.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some((n) => n.op !== "same"));
  const rows: ReactNode[] = [];
  let folded = 0;
  lines.forEach((l, i) => {
    if (!keep[i]) {
      folded += 1;
      return;
    }
    if (folded > 0) {
      rows.push(<div key={`f${i}`} className="px-2 py-0.5 text-[11px] italic text-muted-foreground">… {folded} unchanged line{folded === 1 ? "" : "s"}</div>);
      folded = 0;
    }
    rows.push(
      <div key={i} className={clsx("whitespace-pre-wrap break-words px-2 py-0.5", l.op === "add" && "bg-success/10", l.op === "del" && "bg-destructive/10 line-through")}>
        <span className="mr-2 select-none text-muted-foreground">{l.op === "add" ? "+" : l.op === "del" ? "−" : " "}</span>
        {l.text || " "}
      </div>,
    );
  });
  if (folded > 0) rows.push(<div key="ftail" className="px-2 py-0.5 text-[11px] italic text-muted-foreground">… {folded} unchanged line{folded === 1 ? "" : "s"}</div>);
  return <div className="mt-1.5 overflow-x-auto rounded-md border border-border bg-background font-mono text-xs">{rows}</div>;
}

/** Loads and shows the comparison of one version with the one before it (or a named one). */
export function VersionDiffViewer({ basePath, id, versionId, againstId }: { basePath: string; id: number; versionId: number; againstId?: number | null }) {
  const { data, isLoading, isError } = useVersionDiff(basePath, id, versionId, againstId);
  if (isLoading) return <p className="text-sm text-muted-foreground">Comparing…</p>;
  if (isError || !data) return <p className="text-sm text-destructive">Couldn't load the comparison.</p>;
  return <DiffBody diff={data} />;
}

function DiffBody({ diff }: { diff: VersionDiff }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Version <strong>{diff.to.versionNumber}</strong> compared with {diff.from ? <>version <strong>{diff.from.versionNumber}</strong></> : "an empty start"} —{" "}
        <span className="text-success">{diff.summary.added} added</span>, <span className="text-destructive">{diff.summary.removed} removed</span>, <span className="text-warning">{diff.summary.changed} changed</span>.
      </p>
      <DiffEntries entries={diff.entries} />
    </div>
  );
}

// ---- Modals --------------------------------------------------------------------------------------------------------------------------------------

export function IssueList({ issues, tone }: { issues: ValidationIssue[]; tone: "error" | "warning" }) {
  if (issues.length === 0) return null;
  return (
    <ul className={clsx("flex flex-col gap-1 rounded-md border p-2 text-xs", tone === "error" ? "border-destructive/40 bg-destructive/10" : "border-warning/40 bg-warning/10")}>
      {issues.map((i, idx) => (
        <li key={`${i.code}-${idx}`}>• {i.message}</li>
      ))}
    </ul>
  );
}

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "request" | "decide";
  versionNumber: number;
  isOwnSubmission?: boolean;
  /** People who could be asked to review (controlled documents). When given, "Request review" can name one. */
  reviewers?: { id: number; label: string }[];
  onSubmit: (action: "request" | "approve" | "reject", notes: string, reviewerId?: number) => Promise<void>;
}

/** Ask for review, or (for a reviewer) approve / send back. Sending back requires saying why. */
export function ReviewModal({ isOpen, onClose, mode, versionNumber, isOwnSubmission, reviewers, onSubmit }: ReviewModalProps) {
  const [notes, setNotes] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function go(action: "request" | "approve" | "reject") {
    if (action === "reject" && !notes.trim()) {
      toast.error("Say why it is being sent back, so the author knows what to fix.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(action, notes, action === "request" && reviewerId ? Number(reviewerId) : undefined);
      setNotes("");
      setReviewerId("");
      onClose();
    } catch (err) {
      toast.error(extractErrorMessage(err, "That didn't work."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={mode === "request" ? `Request review of version ${versionNumber}` : `Review version ${versionNumber}`} isOpen={isOpen} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        {mode === "request" ? (
          <p className="text-muted-foreground">A reviewer (an admin or quality manager) will check this version. While it is in review it can't be edited.</p>
        ) : (
          <p className="text-muted-foreground">Approving lets it be published. Sending it back returns it to draft with your note.</p>
        )}
        {mode === "request" && reviewers && reviewers.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="font-medium">Ask a specific reviewer (optional)</span>
            <select className="rounded-md border border-border bg-background p-2 text-sm" value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
              <option value="">Anyone in Quality</option>
              {reviewers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {mode === "decide" && isOwnSubmission && <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">You submitted this version yourself. As an admin you may review it, but the record will show it was self-reviewed.</p>}
        <label className="flex flex-col gap-1">
          <span className="font-medium">{mode === "request" ? "Note for the reviewer (optional)" : "Notes"}</span>
          <textarea className="min-h-20 rounded-md border border-border bg-background p-2 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          {mode === "request" ? (
            <button disabled={busy} onClick={() => void go("request")} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
              Request review
            </button>
          ) : (
            <>
              <button disabled={busy} onClick={() => void go("reject")} className="rounded-md border border-destructive/50 px-4 py-2 text-sm text-destructive disabled:opacity-60">
                Send back
              </button>
              <button disabled={busy} onClick={() => void go("approve")} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
                Approve
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

interface PublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  versionNumber: number;
  noun: string;
  warnings?: ValidationIssue[];
  onPublish: () => Promise<void>;
}

/** Publishing freezes the version and puts it in force — worth a deliberate confirmation. */
export function PublishModal({ isOpen, onClose, versionNumber, noun, warnings = [], onPublish }: PublishModalProps) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal title={`Publish version ${versionNumber}`} isOpen={isOpen} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        <p>
          This puts version {versionNumber} of the {noun} in force and replaces the current one. Once published it is <strong>frozen</strong> — it can never be edited, only superseded by a newer version (or restored through a rollback).
        </p>
        <IssueList issues={warnings} tone="warning" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onPublish();
                onClose();
              } catch (err) {
                toast.error(extractErrorMessage(err, "Couldn't publish."));
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Lifecycle bar -------------------------------------------------------------------------------------------------------------------------------

export interface LifecycleActions {
  startDraft: () => Promise<unknown>;
  discardDraft: (versionId: number) => Promise<unknown>;
  /** Called before asking for review so pending autosaves are flushed. */
  flush?: () => Promise<void>;
  review: (versionId: number, action: "request" | "approve" | "reject", notes: string, reviewerId?: number) => Promise<unknown>;
  publish: (versionId: number) => Promise<unknown>;
}

interface LifecycleBarProps {
  noun: string;
  state: CurrentState<object>;
  canEdit: boolean;
  /** Blocks "Request review" with a reason (e.g. the workflow has validation errors). */
  blockedReason?: string | null;
  warnings?: ValidationIssue[];
  actions: LifecycleActions;
  /** People who could be named as the reviewer when asking for review. */
  reviewers?: { id: number; label: string }[];
  children?: ReactNode;
}

/** The status strip and the one or two buttons that make sense for where the open version is in its lifecycle. */
export function LifecycleBar({ noun, state, canEdit, blockedReason, warnings, actions, reviewers, children }: LifecycleBarProps) {
  const user = useCurrentUser();
  const toast = useToast();
  const isReviewer = !!user?.roleName && REVIEWER_ROLES.includes(user.roleName);
  const open = state.open;
  const [reviewMode, setReviewMode] = useState<"request" | "decide" | null>(null);
  const [publishing, setPublishing] = useState(false);
  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    try {
      await fn();
    } catch (err) {
      toast.error(extractErrorMessage(err, fallback));
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        {state.published ? (
          <span className="text-sm">
            In force: <strong>version {state.published.versionNumber}</strong> <span className="text-muted-foreground">(published {when(state.published.publishedAt)})</span>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Nothing published yet</span>
        )}
        {open && (
          <>
            <ArrowRight size={14} className="text-muted-foreground" />
            <span className="text-sm">
              Version <strong>{open.versionNumber}</strong>
            </span>
            <VersionStatusBadge status={open.status} />
            {open.status === "in_review" && open.reviewDecision === "approved" && <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold uppercase text-success">Approved</span>}
          </>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {children}
          {!open && canEdit && (
            <button onClick={() => void run(actions.startDraft, "Couldn't start a draft.")} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
              Start a draft
            </button>
          )}
          {open?.status === "draft" && canEdit && (
            <>
              <button
                onClick={() => {
                  if (confirm("Discard this draft? Its changes will be lost.")) void run(() => actions.discardDraft(open.id), "Couldn't discard the draft.");
                }}
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
              >
                Discard draft
              </button>
              <button
                disabled={!!blockedReason}
                title={blockedReason ?? undefined}
                onClick={() => setReviewMode("request")}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                Request review
              </button>
            </>
          )}
          {open?.status === "in_review" && !open.reviewDecision && (isReviewer ? (
            <button onClick={() => setReviewMode("decide")} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
              Review
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">Waiting for a reviewer</span>
          ))}
          {open?.status === "in_review" && open.reviewDecision === "approved" && (isReviewer ? (
            <button onClick={() => setPublishing(true)} className="rounded-md bg-success px-3 py-1.5 text-sm font-medium text-success-foreground">
              Publish
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">Approved — waiting to be published</span>
          ))}
        </div>
      </div>

      {open?.status === "draft" && open.reviewDecision === "rejected" && (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
          <strong>Sent back by {open.reviewedByName ?? "the reviewer"}:</strong> {open.reviewNotes}
        </p>
      )}
      {blockedReason && open?.status === "draft" && <p className="text-xs text-destructive">{blockedReason}</p>}

      {open && (
        <>
          <ReviewModal
            isOpen={reviewMode !== null}
            onClose={() => setReviewMode(null)}
            mode={reviewMode ?? "request"}
            versionNumber={open.versionNumber}
            isOwnSubmission={open.submittedBy === user?.id}
            reviewers={reviewers}
            onSubmit={async (action, notes, reviewerId) => {
              if (action === "request") await actions.flush?.();
              await actions.review(open.id, action, notes, reviewerId);
              toast.success(action === "request" ? "Sent for review." : action === "approve" ? "Approved." : "Sent back to the author.");
            }}
          />
          <PublishModal
            isOpen={publishing}
            onClose={() => setPublishing(false)}
            versionNumber={open.versionNumber}
            noun={noun}
            warnings={warnings}
            onPublish={async () => {
              await actions.publish(open.id);
              toast.success(`Version ${open.versionNumber} is now in force.`);
            }}
          />
        </>
      )}
    </div>
  );
}

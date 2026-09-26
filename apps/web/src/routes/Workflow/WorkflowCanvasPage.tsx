import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Play } from "lucide-react";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { Modal } from "../../components/modals/Modal";
import { TextField, SelectField } from "../../components/forms/Field";
import { LifecycleBar, VersionDiffViewer, VersionStatusBadge, VersionTimeline } from "../../components/versioning/VersionParts";
import { useVersioning, useVersionPayload, validatePayload, type ValidationReport, type VersionFull } from "../../api/versioning";
import type { WorkflowRun } from "../../api/types";
import { WorkflowCanvasEditor } from "./canvas/WorkflowCanvasEditor";
import { DEPARTMENT_OPTIONS } from "./WorkflowConfigFields";
import type { WfMetadata, WfPayload } from "./canvas/graph";

const BASE = "/workflow";

interface WorkflowRow {
  id: number;
  name: string;
  module: string | null;
  isActive: string;
  version: number;
}

/**
 * The workflow canvas: draw the workflow, check it, send it for review, publish it. What runs in production is always the
 * published version; this screen edits a draft beside it, and shows any earlier version read-only.
 */
export function WorkflowCanvasPage() {
  const wid = Number(useParams().id);
  const user = useCurrentUser();
  const toast = useToast();
  const queryClient = useQueryClient();
  const v = useVersioning<WfPayload>(BASE, wid);
  const current = v.current.data;
  const { data: row } = useQuery<WorkflowRow>({ queryKey: ["workflow", wid, "row"], queryFn: async () => (await apiClient.get(`/workflow/${wid}`)).data });
  const { data: actionKinds = [] } = useQuery<string[]>({ queryKey: ["workflow/action-kinds"], queryFn: async () => (await apiClient.get("/workflow/action-kinds")).data });

  const [viewId, setViewId] = useState<number | null>(null);
  const [compareId, setCompareId] = useState<number | null>(null);
  const [tab, setTab] = useState<"inspector" | "checks" | "details">("inspector");
  const [showHistory, setShowHistory] = useState(false);
  const [simResult, setSimResult] = useState<WorkflowRun | null>(null);

  const openId = current?.open?.id ?? null;
  const publishedId = current?.published?.id ?? null;
  const shownId = viewId ?? openId ?? publishedId;
  const isSpecial = shownId !== null && (shownId === openId || shownId === publishedId);
  const other = useVersionPayload<WfPayload>(BASE, wid, shownId !== null && !isSpecial ? shownId : null);
  const shown: VersionFull<WfPayload> | null | undefined = shownId === null ? null : shownId === openId ? current?.open : shownId === publishedId ? current?.published : other.data;

  const isAdmin = user?.roleName === "admin";
  const mayEdit = isAdmin || user?.department === "quality" || user?.roleName === "quality_manager";
  const editable = !!shown && shown.status === "draft" && shown.id === openId && mayEdit;

  // ---- autosave + live checks ----------------------------------------------------------------------------------------------------------------------
  const live = useRef<WfPayload | null>(null);
  const dirty = useRef(false);
  const [tick, setTick] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [report, setReport] = useState<ValidationReport | null>(null);

  const onEditorChange = useCallback((payload: WfPayload) => {
    live.current = payload;
    dirty.current = true;
    setTick((t) => t + 1);
  }, []);

  // Loading a different version resets what the editor last reported.
  useEffect(() => {
    live.current = null;
    dirty.current = false;
    setSaveState("idle");
  }, [shown?.id]);

  const saveNow = useCallback(async () => {
    if (!editable || !shown || !dirty.current || !live.current) return;
    setSaveState("saving");
    try {
      await v.saveDraft.mutateAsync({ versionId: shown.id, payload: live.current });
      dirty.current = false;
      setSaveState("saved");
    } catch (err) {
      setSaveState("idle");
      toast.error(extractErrorMessage(err, "Couldn't save your changes."));
    }
  }, [editable, shown?.id]);

  useEffect(() => {
    if (!editable || !dirty.current) return;
    const t = setTimeout(() => void saveNow(), 1500);
    return () => clearTimeout(t);
  }, [tick, editable, saveNow]);

  useEffect(() => {
    if (!shown) return;
    const payload = live.current ?? shown.payload;
    const t = setTimeout(() => {
      validatePayload(BASE, wid, payload)
        .then(setReport)
        .catch(() => setReport(null));
    }, tick === 0 ? 0 : 600);
    return () => clearTimeout(t);
  }, [tick, shown?.id, wid]);

  const errors = report?.errors ?? [];
  const blocked = errors.length > 0 ? `${errors.length} problem${errors.length === 1 ? "" : "s"} to fix before this can be reviewed — see Checks.` : null;

  const actions = useMemo(
    () => ({
      startDraft: async () => {
        const d = await v.createDraft.mutateAsync({});
        setViewId(d.id);
      },
      discardDraft: async (id: number) => {
        await v.discard.mutateAsync(id);
        setViewId(null);
      },
      flush: saveNow,
      review: (id: number, action: "request" | "approve" | "reject", notes: string) => v.review.mutateAsync({ versionId: id, action, notes }),
      publish: async (id: number) => {
        await v.publish.mutateAsync(id);
        setViewId(null);
        void queryClient.invalidateQueries({ queryKey: ["workflow", wid] });
      },
    }),
    [v.createDraft, v.discard, v.review, v.publish, saveNow, queryClient, wid],
  );

  const simulate = useMutation({
    mutationFn: async () => (await apiClient.post<WorkflowRun>(`/workflow/${wid}/run`, { context: {}, simulate: true })).data,
    onSuccess: setSimResult,
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't run the simulation.")),
  });
  const toggleActive = useMutation({
    mutationFn: async () => (await apiClient.patch(`/workflow/${wid}`, { isActive: row?.isActive === "true" ? "false" : "true" })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workflow", wid] }),
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't change that.")),
  });

  const name = (shown?.payload?.metadata?.name as string | undefined) || row?.name || "Workflow";
  const canRollback = mayEdit && !current?.open;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Link to="/workflow" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
          <ArrowLeft size={12} /> All workflows
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{name}</h1>
          {row && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${row.isActive === "true" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>{row.isActive === "true" ? "Active" : "Inactive"}</span>}
          {row?.module && <span className="text-sm text-muted-foreground">{row.module}</span>}
        </div>
      </div>

      {current && (
        <LifecycleBar noun="workflow" state={current} canEdit={mayEdit} blockedReason={blocked} warnings={report?.warnings} actions={actions}>
          {editable && saveState !== "idle" && <span className="text-xs text-muted-foreground">{saveState === "saving" ? "Saving…" : "Draft saved"}</span>}
          {current.published && (
            <>
              <button onClick={() => simulate.mutate()} disabled={simulate.isPending} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50" title="Runs the published version without performing any real action">
                <Play size={13} /> Simulate
              </button>
              {mayEdit && (
                <button onClick={() => toggleActive.mutate()} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
                  {row?.isActive === "true" ? "Deactivate" : "Activate"}
                </button>
              )}
            </>
          )}
        </LifecycleBar>
      )}

      {shown && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            Showing <strong>version {shown.versionNumber}</strong>
          </span>
          <VersionStatusBadge status={shown.status} />
          {!editable && <span className="text-xs text-muted-foreground">Read-only{shown.status === "published" ? " — this is the version in force" : ""}</span>}
          {viewId !== null && (
            <button onClick={() => setViewId(null)} className="text-xs text-primary hover:underline">
              Back to {openId ? "the draft" : "the published version"}
            </button>
          )}
        </div>
      )}

      {!shown ? (
        <p className="text-sm text-muted-foreground">{v.current.isLoading ? "Loading…" : "Nothing here yet."}</p>
      ) : (
        <WorkflowCanvasEditor
          key={`${shown.id}:${editable}`}
          initial={shown.payload}
          editable={editable}
          actionKinds={actionKinds}
          issues={report?.errors ?? []}
          onChange={onEditorChange}
          sidePanel={({ metadata, setMetadata, selectNode, inspector }) => (
            <div className="flex flex-col gap-3">
              <div className="flex gap-1 border-b border-border text-sm">
                {(["inspector", "checks", "details"] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} className={`px-2.5 py-1.5 capitalize ${tab === t ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground"}`}>
                    {t}
                    {t === "checks" && report && (errors.length > 0 ? <span className="ml-1 rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">{errors.length}</span> : <span className="ml-1 text-success">✓</span>)}
                  </button>
                ))}
              </div>
              {tab === "inspector" && inspector}
              {tab === "checks" && <ChecksPanel report={report} onSelect={selectNode} />}
              {tab === "details" && <DetailsPanel metadata={metadata} setMetadata={setMetadata} editable={editable} />}
            </div>
          )}
        />
      )}

      <div className="rounded-lg border border-border bg-card">
        <button onClick={() => setShowHistory((s) => !s)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium">
          Version history &amp; compare
          <span className="text-xs text-muted-foreground">{showHistory ? "Hide" : `${v.versions.data?.length ?? 0} versions`}</span>
        </button>
        {showHistory && (
          <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-2">
            <VersionTimeline
              versions={v.versions.data ?? []}
              selectedId={shownId}
              onSelect={(id) => setViewId(id === (openId ?? publishedId) ? null : id)}
              onCompare={setCompareId}
              onRollback={
                canRollback
                  ? async (n) => {
                      try {
                        const d = await v.rollback.mutateAsync(n);
                        setViewId(d.id);
                        toast.success(`Started a draft restoring version ${n}. Check it, request review, and publish it like any change.`);
                      } catch (err) {
                        toast.error(extractErrorMessage(err, "Couldn't start the rollback."));
                      }
                    }
                  : undefined
              }
            />
            {compareId ? <VersionDiffViewer basePath={BASE} id={wid} versionId={compareId} /> : <p className="text-sm text-muted-foreground">Choose “Compare with previous” on a version to see what changed.</p>}
          </div>
        )}
      </div>

      <Modal title="Simulation result — no real actions were performed" isOpen={simResult !== null} onClose={() => setSimResult(null)}>
        <p className="mb-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">Every action shows what WOULD have happened. An approval step is treated as approved.</p>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{JSON.stringify(simResult?.context, null, 2)}</pre>
      </Modal>
    </div>
  );
}

function ChecksPanel({ report, onSelect }: { report: ValidationReport | null; onSelect: (nodeId: string) => void }) {
  if (!report) return <p className="text-sm text-muted-foreground">Checking…</p>;
  if (report.errors.length === 0 && report.warnings.length === 0) return <p className="text-sm text-success">No problems found. This workflow can be sent for review.</p>;
  const group = (issues: typeof report.errors, tone: "error" | "warning", title: string) =>
    issues.length > 0 && (
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        <ul className="flex flex-col gap-1">
          {issues.map((i, idx) => (
            <li key={`${i.code}-${idx}`}>
              <button
                disabled={!i.nodeId}
                onClick={() => i.nodeId && onSelect(i.nodeId)}
                className={`w-full rounded-md border p-2 text-left text-xs ${tone === "error" ? "border-destructive/40 bg-destructive/10" : "border-warning/40 bg-warning/10"} ${i.nodeId ? "hover:opacity-80" : "cursor-default"}`}
              >
                {i.message}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      {group(report.errors, "error", "Must fix")}
      {group(report.warnings, "warning", "Worth a look")}
    </div>
  );
}

function DetailsPanel({ metadata, setMetadata, editable }: { metadata: WfMetadata; setMetadata: (m: WfMetadata) => void; editable: boolean }) {
  const set = (patch: Partial<WfMetadata>) => setMetadata({ ...metadata, ...patch });
  return (
    <fieldset disabled={!editable} className="flex flex-col gap-3">
      <TextField label="Name" value={metadata.name ?? ""} onChange={(e) => set({ name: e.target.value })} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Description</span>
        <textarea className="min-h-16 rounded-md border border-border bg-background p-2 text-sm" value={metadata.description ?? ""} onChange={(e) => set({ description: e.target.value })} />
      </label>
      <TextField label="Category" placeholder="e.g. quality, purchasing" value={metadata.category ?? ""} onChange={(e) => set({ category: e.target.value })} />
      <TextField label="Module it listens to" placeholder="e.g. ncr, capa, receiving" value={metadata.module ?? ""} onChange={(e) => set({ module: e.target.value })} />
      <SelectField label="Department in charge" value={String(metadata.ownerDepartment ?? "")} onChange={(e) => set({ ownerDepartment: e.target.value || undefined })}>
        <option value="">—</option>
        {DEPARTMENT_OPTIONS.map((d) => (
          <option key={d} value={d}>
            {d.replace(/_/g, " ")}
          </option>
        ))}
      </SelectField>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={metadata.allowLoops === true} onChange={(e) => set({ allowLoops: e.target.checked })} />
        <span>
          Allow loops
          <span className="block text-xs text-muted-foreground">Off by default: a path that returns to an earlier step is usually a mistake. Each step still runs once per run.</span>
        </span>
      </label>
    </fieldset>
  );
}

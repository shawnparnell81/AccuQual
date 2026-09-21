import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { createResourceHooks } from "../../api/resourceHooks";
import { apiClient } from "../../api/client";
import type { AccuQualDocument } from "../../api/types";
import { useVersioning, useVersionPayload, validatePayload, REVIEWER_ROLES, type ValidationReport, type VersionFull } from "../../api/versioning";
import { useReviewers, type DocumentPayload } from "../../api/documents";
import { DocumentHistoryPanel } from "../../components/documents/DocumentHistoryPanel";
import { DocumentRetentionPanel } from "../../components/documents/DocumentRetentionPanel";
import { DocumentDetailsPanel } from "../../components/documents/DocumentDetailsPanel";
import { DocumentFilesPanel } from "../../components/documents/DocumentFilesPanel";
import { DocumentLinkHistory, DocumentLinksPanel } from "../../components/documents/DocumentLinksPanel";
import { LifecycleBar, VersionDiffViewer, VersionStatusBadge, VersionTimeline } from "../../components/versioning/VersionParts";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { AiFieldAssistant } from "../../components/shared/AiFieldAssistant";
import { useToast } from "../../components/shared/ToastProvider";
import { useCurrentUser } from "../../hooks/useAuth";
import { useSetAssistantContext } from "../../hooks/useAssistantContext";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

const documentHooks = createResourceHooks<AccuQualDocument>("documents");
const BASE = "/documents";

// "Released" is the ISO document-control term for "approved" — kept as a
// label override on the shared StatusBadge rather than its own color map.
const STATUS_LABELS: Record<AccuQualDocument["status"], string> = {
  draft: "Draft",
  in_review: "In Review",
  approved: "Released",
  obsolete: "Obsolete",
};

type Tab = "details" | "files" | "links" | "versions" | "compliance";
const TABS: { id: Tab; label: string }[] = [
  { id: "details", label: "Document" },
  { id: "files", label: "Files" },
  { id: "links", label: "Linked records" },
  { id: "versions", label: "Versions" },
  { id: "compliance", label: "Retention & history" },
];

const blankPayload = (title = ""): DocumentPayload => ({ title, category: null, content: "", revisionCode: "Rev A", effectiveDate: null, expirationDate: null, retentionPeriodDays: null, attachments: [], links: [] });

/**
 * One controlled document. What everyone reads is the released revision; changes are made on a draft that a reviewer
 * approves and publishes, after which that revision is frozen. Drafting, review, publication, rollback and comparison
 * all go through the shared version-control engine (see api/versioning.ts); this page adds the document's own parts —
 * details and content, files, and links to other records.
 */
interface DocumentDetailPageProps {
  /** When set (embedded in a window), used instead of the route's :id param. */
  entityId?: number;
}

export function DocumentDetailPage({ entityId }: DocumentDetailPageProps = {}) {
  const { id } = useParams();
  const documentId = entityId ?? Number(id);
  const { data: doc, isLoading, isError } = documentHooks.useOne(documentId);
  useSetAssistantContext("sop_generator", documentId, doc ? doc.title : `Document #${documentId}`);
  const user = useCurrentUser();
  const toast = useToast();
  const queryClient = useQueryClient();
  const v = useVersioning<DocumentPayload>(BASE, documentId);
  const reviewers = useReviewers();
  const current = v.current.data;

  const [tab, setTab] = useState<Tab>("details");
  const [viewId, setViewId] = useState<number | null>(null);
  const [compareId, setCompareId] = useState<number | null>(null);
  const [againstId, setAgainstId] = useState<number | null>(null);

  // What is on screen: an explicitly chosen version, else the open draft, else what is in force.
  const openId = current?.open?.id ?? null;
  const publishedId = current?.published?.id ?? null;
  const shownId = viewId ?? openId ?? publishedId;
  const isSpecial = shownId !== null && (shownId === openId || shownId === publishedId);
  const other = useVersionPayload<DocumentPayload>(BASE, documentId, shownId !== null && !isSpecial ? shownId : null);
  const shown: VersionFull<DocumentPayload> | null | undefined = shownId === null ? null : shownId === openId ? current?.open : shownId === publishedId ? current?.published : other.data;

  const isReviewer = !!user?.roleName && REVIEWER_ROLES.includes(user.roleName);
  const mayEdit = isReviewer || user?.department === "quality" || user?.department === "engineering";
  const editable = !!shown && shown.status === "draft" && shown.id === openId && mayEdit;

  // Local copy of the draft being typed into, autosaved a moment after the last change.
  const [values, setValues] = useState<DocumentPayload>(blankPayload());
  const [summary, setSummary] = useState("");
  const loadedFor = useRef<number | null>(null);
  const dirty = useRef(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  useEffect(() => {
    if (shown && loadedFor.current !== shown.id) {
      loadedFor.current = shown.id;
      dirty.current = false;
      setValues({ ...blankPayload(), ...(shown.payload ?? {}) });
      setSummary(typeof shown.metadata?.summary === "string" ? shown.metadata.summary : "");
      setSaveState("idle");
    }
  }, [shown]);

  const valuesRef = useRef(values);
  valuesRef.current = values;
  const summaryRef = useRef(summary);
  summaryRef.current = summary;
  const saveNow = async () => {
    if (!editable || !shown || !dirty.current) return;
    setSaveState("saving");
    try {
      await v.saveDraft.mutateAsync({ versionId: shown.id, payload: valuesRef.current, summary: summaryRef.current });
      dirty.current = false;
      setSaveState("saved");
    } catch (err) {
      setSaveState("idle");
      toast.error(extractErrorMessage(err, "Couldn't save your changes."));
    }
  };
  useEffect(() => {
    if (!editable || !dirty.current) return;
    const t = setTimeout(() => void saveNow(), 1200);
    return () => clearTimeout(t);
  }, [values, summary, editable]);

  function change(patch: Partial<DocumentPayload>) {
    dirty.current = true;
    setValues((prev) => ({ ...prev, ...patch }));
  }

  // Live check of the same rules review and publishing apply.
  const [report, setReport] = useState<ValidationReport | null>(null);
  useEffect(() => {
    if (!editable) {
      setReport(null);
      return;
    }
    const t = setTimeout(() => void validatePayload(BASE, documentId, values).then(setReport).catch(() => setReport(null)), 500);
    return () => clearTimeout(t);
  }, [values, editable, documentId]);

  // After a file is added or removed the server's list is the truth; adopt it without disturbing text being typed.
  const adoptFiles = async (version: VersionFull<DocumentPayload> | null) => {
    const files = version?.payload.attachments ?? (await v.current.refetch()).data?.open?.payload.attachments;
    if (files) setValues((prev) => ({ ...prev, attachments: files }));
  };

  const actions = useMemo(
    () => ({
      startDraft: async () => {
        const d = await v.createDraft.mutateAsync({});
        loadedFor.current = null;
        setViewId(d.id);
        setTab("details");
      },
      discardDraft: async (vid: number) => {
        await v.discard.mutateAsync(vid);
        loadedFor.current = null;
        setViewId(null);
        void queryClient.invalidateQueries({ queryKey: ["documents"] });
      },
      flush: saveNow,
      review: async (vid: number, action: "request" | "approve" | "reject", notes: string, reviewerId?: number) => {
        await v.review.mutateAsync({ versionId: vid, action, notes, reviewerId });
        void queryClient.invalidateQueries({ queryKey: ["documents"] });
      },
      publish: async (vid: number) => {
        await v.publish.mutateAsync(vid);
        loadedFor.current = null;
        setViewId(null);
        void queryClient.invalidateQueries({ queryKey: ["documents"] });
        void queryClient.invalidateQueries({ queryKey: ["document-link-history", documentId] });
      },
    }),
    [v.createDraft, v.discard, v.review, v.publish, editable, shown?.id],
  );

  if (isError) return <p className="text-sm text-destructive">Couldn't load this record — try refreshing the page.</p>;
  if (isLoading || !doc) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const versionList = v.versions.data ?? [];
  const canRollback = mayEdit && !current?.open && doc.status !== "obsolete";
  const canRetire = isReviewer && doc.status === "approved" && !current?.open;
  const firstError = report?.errors[0]?.message ?? null;
  const shownValues: DocumentPayload = editable ? values : { ...blankPayload(doc.title), ...(shown?.payload ?? {}) };

  async function retire() {
    if (!confirm("Retire this document? It will be marked obsolete and can't be revised any more.")) return;
    try {
      await apiClient.post(`/documents/${documentId}/obsolete`);
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Document retired.");
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't retire this document."));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{doc.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{doc.category ?? "Uncategorized"}</span>
            {doc.currentVersion > 0 ? (
              <span>
                — {doc.revisionCode ?? `Rev ${doc.currentVersion}`} (version {doc.currentVersion})
              </span>
            ) : (
              <span>— not released yet</span>
            )}
            <StatusBadge value={doc.status} label={STATUS_LABELS[doc.status]} />
            {doc.tags.map((t) => (
              <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                {t}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <AiFieldAssistant
            module="sop_generator"
            recordId={documentId}
            triggerLabel="Generate SOP"
            buildInitialPrompt={() =>
              `Draft SOP content for "${doc.title}"${doc.category ? ` (category: ${doc.category})` : ""}. Structure it with Purpose, Scope,` +
              " Responsibilities, Procedure (numbered steps), and Records sections. Suggest steps based on the process this document" +
              " covers, and propose relevant controls and checks. This is a draft for the document owner to refine: paste it into the" +
              " Content field of a draft revision, where it goes through review and publication like any other change."
            }
          />
          {canRetire && (
            <button onClick={() => void retire()} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
              Retire document
            </button>
          )}
        </div>
      </div>

      {current && (
        <LifecycleBar
          noun="document"
          state={current}
          canEdit={mayEdit && doc.status !== "obsolete"}
          blockedReason={firstError}
          warnings={report?.warnings}
          actions={actions}
          reviewers={(reviewers.data ?? []).map((r) => ({ id: r.id, label: `${r.name ?? r.email} (${r.role.replace("_", " ")})` }))}
        >
          {saveState !== "idle" && editable && <span className="text-xs text-muted-foreground">{saveState === "saving" ? "Saving…" : "Draft saved"}</span>}
        </LifecycleBar>
      )}

      <div className="flex flex-wrap gap-1 border-b border-border text-sm">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-1.5 ${tab === t.id ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
            {t.id === "files" && shownValues.attachments.length > 0 && <span className="ml-1 text-xs text-muted-foreground">({shownValues.attachments.length})</span>}
            {t.id === "links" && shownValues.links.length > 0 && <span className="ml-1 text-xs text-muted-foreground">({shownValues.links.length})</span>}
          </button>
        ))}
      </div>

      {tab !== "versions" && tab !== "compliance" && shown && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            Showing <strong>version {shown.versionNumber}</strong> ({shown.payload?.revisionCode ?? "—"})
          </span>
          <VersionStatusBadge status={shown.status} />
          {!editable && <span className="text-xs text-muted-foreground">Read-only{shown.status === "published" ? " — this is the released revision" : shown.status === "draft" && !mayEdit ? " — you can't edit documents" : ""}</span>}
          {viewId !== null && (
            <button onClick={() => setViewId(null)} className="text-xs text-primary hover:underline">
              Back to {openId ? "the draft" : "the released revision"}
            </button>
          )}
        </div>
      )}

      {tab === "details" && (
        <div className="rounded-lg border border-border bg-card p-4">
          {!shown ? <p className="text-sm text-muted-foreground">{v.current.isLoading ? "Loading…" : "Nothing here yet."}</p> : <DocumentDetailsPanel values={shownValues} editable={editable} onChange={change} summary={summary} onSummaryChange={(s) => { dirty.current = true; setSummary(s); }} />}
          {editable && report && report.errors.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-xs text-destructive">
              {report.errors.map((e) => (
                <li key={e.code}>{e.message}</li>
              ))}
            </ul>
          )}
          {editable && report && report.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-warning">
              {report.warnings.map((w) => (
                <li key={w.code}>{w.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "files" && shown && (
        <div className="rounded-lg border border-border bg-card p-4">
          <DocumentFilesPanel documentId={documentId} versionId={shown.id} files={shownValues.attachments} editable={editable} onChanged={(ver) => void adoptFiles(ver)} flush={saveNow} />
        </div>
      )}

      {tab === "links" && shown && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-medium">Linked in version {shown.versionNumber}</h3>
            <DocumentLinksPanel links={shownValues.links} editable={editable} onChange={(links) => change({ links })} />
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-medium">Link history</h3>
            <DocumentLinkHistory documentId={documentId} />
          </div>
        </div>
      )}

      {tab === "versions" && (
        <div className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-medium">Version history</h3>
            <VersionTimeline
              versions={versionList}
              selectedId={shownId}
              onSelect={(vid) => {
                setViewId(vid === (openId ?? publishedId) ? null : vid);
                setTab("details");
              }}
              onCompare={(vid) => {
                setCompareId(vid);
                setAgainstId(null);
              }}
              onRollback={
                canRollback
                  ? async (n) => {
                      try {
                        const d = await v.rollback.mutateAsync(n);
                        loadedFor.current = null;
                        setViewId(d.id);
                        setTab("details");
                        toast.success(`Started a draft restoring version ${n}. Review and publish it like any change.`);
                      } catch (err) {
                        toast.error(extractErrorMessage(err, "Couldn't start the rollback."));
                      }
                    }
                  : undefined
              }
            />
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-medium">Compare</h3>
            {compareId ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    Compare version
                    <select className="rounded-md border border-form-field bg-background px-2 py-1" value={compareId} onChange={(e) => setCompareId(Number(e.target.value))}>
                      {versionList.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.versionNumber}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    with
                    <select className="rounded-md border border-form-field bg-background px-2 py-1" value={againstId ?? ""} onChange={(e) => setAgainstId(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">the one before it</option>
                      {versionList
                        .filter((x) => x.id !== compareId)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            version {x.versionNumber}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <VersionDiffViewer basePath={BASE} id={documentId} versionId={compareId} againstId={againstId} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Pick “Compare with previous” on a version in the history.</p>
            )}
          </div>
        </div>
      )}

      {tab === "compliance" && (
        <div className="flex flex-col gap-4">
          <DocumentRetentionPanel document={doc} />
          <DocumentHistoryPanel documentId={documentId} />
        </div>
      )}
    </div>
  );
}

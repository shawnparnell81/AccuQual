import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { GenericFormRenderer } from "../../components/forms/GenericFormRenderer";
import { getFormLayout } from "../../components/forms/layouts";
import { LifecycleBar, VersionDiffViewer, VersionStatusBadge, VersionTimeline } from "../../components/versioning/VersionParts";
import { useVersioning, useVersionPayload, type VersionFull } from "../../api/versioning";
import { useCurrentUser } from "../../hooks/useAuth";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

// Both documents are a single record per organization (id 1) — the same singleton the generic forms engine has always used.
const RECORD_ID = 1;

interface ControlledDocumentPageProps {
  basePath: "/management-review" | "/context";
  formType: string;
  title: string;
  noun: string;
  description: string;
}

type Payload = Record<string, unknown>;

/**
 * A version-controlled document (Management Review, Context of the Organization): the document itself, drawn from the
 * organization's own form layout, with a draft -> review -> publish lifecycle around it. What everyone reads is the
 * published version; changes are made on a draft that a reviewer approves.
 */
export function ControlledDocumentPage({ basePath, formType, title, noun, description }: ControlledDocumentPageProps) {
  const layout = getFormLayout(formType);
  const user = useCurrentUser();
  const toast = useToast();
  const v = useVersioning<Payload>(basePath, RECORD_ID);
  const current = v.current.data;
  const [viewId, setViewId] = useState<number | null>(null);
  const [compareId, setCompareId] = useState<number | null>(null);
  const [panel, setPanel] = useState<"history" | "compare">("history");

  // What is on screen: an explicitly chosen version, else the open draft, else what is in force.
  const openId = current?.open?.id ?? null;
  const publishedId = current?.published?.id ?? null;
  const shownId = viewId ?? openId ?? publishedId;
  const isSpecial = shownId !== null && (shownId === openId || shownId === publishedId);
  const other = useVersionPayload<Payload>(basePath, RECORD_ID, shownId !== null && !isSpecial ? shownId : null);
  const shown: VersionFull<Payload> | null | undefined = shownId === null ? null : shownId === openId ? current?.open : shownId === publishedId ? current?.published : other.data;

  const isAdmin = user?.roleName === "admin";
  const mayEdit = isAdmin || user?.department === "quality" || user?.roleName === "quality_manager";
  const editable = !!shown && shown.status === "draft" && shown.id === openId && mayEdit;

  // Local copy of the draft being typed into, autosaved a moment after the last keystroke.
  const [values, setValues] = useState<Payload>({});
  const loadedFor = useRef<number | null>(null);
  const dirty = useRef(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  useEffect(() => {
    if (shown && loadedFor.current !== shown.id) {
      loadedFor.current = shown.id;
      dirty.current = false;
      setValues(shown.payload ?? {});
      setSaveState("idle");
    }
  }, [shown]);

  const valuesRef = useRef(values);
  valuesRef.current = values;
  const saveNow = async () => {
    if (!editable || !shown || !dirty.current) return;
    setSaveState("saving");
    try {
      await v.saveDraft.mutateAsync({ versionId: shown.id, payload: valuesRef.current });
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
  }, [values, editable]);

  function change(name: string, value: unknown) {
    dirty.current = true;
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  const noVersions = !current || (!current.published && !current.open);
  const versionList = v.versions.data ?? [];
  const canRollback = mayEdit && !current?.open;

  const actions = useMemo(
    () => ({
      startDraft: async () => {
        const d = await v.createDraft.mutateAsync({});
        setViewId(d.id);
        setPanel("history");
      },
      discardDraft: async (id: number) => {
        await v.discard.mutateAsync(id);
        loadedFor.current = null;
        setViewId(null);
      },
      flush: saveNow,
      review: (id: number, action: "request" | "approve" | "reject", notes: string) => v.review.mutateAsync({ versionId: id, action, notes }),
      publish: async (id: number) => {
        await v.publish.mutateAsync(id);
        loadedFor.current = null;
        setViewId(null);
      },
    }),
    [v.createDraft, v.discard, v.review, v.publish, editable, shown?.id],
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to="/management-system" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
          <ArrowLeft size={12} /> Management System
        </Link>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {current && (
        <LifecycleBar noun={noun} state={current} canEdit={mayEdit} actions={actions}>
          {saveState !== "idle" && editable && <span className="text-xs text-muted-foreground">{saveState === "saving" ? "Saving…" : "Draft saved"}</span>}
        </LifecycleBar>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          {shown && (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span>
                Showing <strong>version {shown.versionNumber}</strong>
              </span>
              <VersionStatusBadge status={shown.status} />
              {!editable && shown.status !== "draft" && <span className="text-xs text-muted-foreground">Read-only{shown.status === "published" ? " — this is the version in force" : ""}</span>}
              {viewId !== null && (
                <button onClick={() => setViewId(null)} className="text-xs text-primary hover:underline">
                  Back to {openId ? "the draft" : "the published version"}
                </button>
              )}
            </div>
          )}
          <div className="rounded-lg border border-border bg-card p-4">
            {noVersions || !shown ? (
              <p className="text-sm text-muted-foreground">{v.current.isLoading ? "Loading…" : "Nothing here yet."}</p>
            ) : layout ? (
              <GenericFormRenderer layout={layout} data={editable ? values : (shown.payload ?? {})} onChange={change} readOnly={!editable} />
            ) : (
              <p className="text-sm text-destructive">No layout is registered for this document.</p>
            )}
          </div>
        </div>

        <aside className="flex flex-col gap-3">
          <div className="flex gap-1 border-b border-border text-sm">
            {(["history", "compare"] as const).map((p) => (
              <button key={p} onClick={() => setPanel(p)} className={`px-3 py-1.5 ${panel === p ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground"}`}>
                {p === "history" ? "Version history" : "Compare"}
              </button>
            ))}
          </div>
          {panel === "history" ? (
            <VersionTimeline
              versions={versionList}
              selectedId={shownId}
              onSelect={(id) => setViewId(id === (openId ?? publishedId) ? null : id)}
              onCompare={(id) => {
                setCompareId(id);
                setPanel("compare");
              }}
              onRollback={
                canRollback
                  ? async (n) => {
                      try {
                        const d = await v.rollback.mutateAsync(n);
                        setViewId(d.id);
                        toast.success(`Started a draft restoring version ${n}. Review and publish it like any change.`);
                      } catch (err) {
                        toast.error(extractErrorMessage(err, "Couldn't start the rollback."));
                      }
                    }
                  : undefined
              }
            />
          ) : compareId ? (
            <VersionDiffViewer basePath={basePath} id={RECORD_ID} versionId={compareId} />
          ) : (
            <p className="text-sm text-muted-foreground">Pick “Compare with previous” on a version in the history.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

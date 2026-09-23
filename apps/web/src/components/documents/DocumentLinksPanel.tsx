import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { LINK_TYPES, linkTypeLabel, useLinkHistory, useLinkTargets, type DocumentLink, type LinkType } from "../../api/documents";

const routeFor = (l: { type: LinkType; id: number }) => LINK_TYPES.find((t) => t.value === l.type)?.route(l.id) ?? "#";

interface Props {
  links: DocumentLink[];
  editable: boolean;
  onChange: (links: DocumentLink[]) => void;
}

/** The records one revision points at (equipment, suppliers, workflows, NCRs, CAPAs, audits, training) — with a picker while it is a draft. */
export function DocumentLinksPanel({ links, editable, onChange }: Props) {
  const [type, setType] = useState<LinkType>("equipment");
  const [q, setQ] = useState("");
  const targets = useLinkTargets(type, q, editable);
  const taken = new Set(links.map((l) => `${l.type}:${l.id}`));
  const choices = (targets.data ?? []).filter((t) => !taken.has(`${type}:${t.id}`));

  return (
    <div className="flex flex-col gap-3">
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">This revision isn't linked to any other record.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {links.map((l) => (
            <li key={`${l.type}:${l.id}`} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase">{linkTypeLabel(l.type)}</span>
              <Link to={routeFor(l)} className="min-w-0 flex-1 truncate text-accent hover:underline">
                {l.label}
              </Link>
              {editable && (
                <button onClick={() => onChange(links.filter((x) => !(x.type === l.type && x.id === l.id)))} className="text-muted-foreground hover:text-destructive" aria-label={`Unlink ${l.label}`}>
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
          <p className="text-xs font-medium">Link another record</p>
          <div className="flex flex-wrap gap-2">
            <select className="rounded-md border border-form-field bg-background px-2 py-1.5 text-sm" value={type} onChange={(e) => setType(e.target.value as LinkType)} aria-label="Kind of record">
              {LINK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <input className="min-w-40 flex-1 rounded-md border border-form-field bg-background px-2 py-1.5 text-sm" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search records" />
          </div>
          {targets.isLoading ? (
            <p className="text-xs text-muted-foreground">Searching…</p>
          ) : choices.length === 0 ? (
            <p className="text-xs text-muted-foreground">No matching {linkTypeLabel(type).toLowerCase()} records{links.some((l) => l.type === type) ? " left to link" : ""}.</p>
          ) : (
            <ul className="flex max-h-44 flex-col gap-1 overflow-y-auto">
              {choices.map((t) => (
                <li key={t.id}>
                  <button onClick={() => onChange([...links, { type, id: t.id, label: t.label }])} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted">
                    <Plus size={13} className="shrink-0 text-primary" />
                    <span className="truncate">{t.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Every record the document has ever been linked to, and in which revisions — kept across versions, so a removed link is still traceable. */
export function DocumentLinkHistory({ documentId }: { documentId: number }) {
  const { data, isLoading } = useLinkHistory(documentId);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data || data.links.length === 0) return <p className="text-sm text-muted-foreground">No record has ever been linked to this document.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {data.links.map((l) => (
        <li key={`${l.type}:${l.id}`} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase">{l.typeLabel}</span>
          <Link to={routeFor(l)} className="min-w-0 flex-1 truncate text-accent hover:underline">
            {l.label}
          </Link>
          <span className="text-xs text-muted-foreground">{l.firstVersion === l.lastVersion ? `version ${l.firstVersion}` : `versions ${l.firstVersion}–${l.lastVersion}`}</span>
          {l.inForce ? <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-success">In force</span> : <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Not in force</span>}
        </li>
      ))}
    </ul>
  );
}

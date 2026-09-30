import clsx from "clsx";
import { formatAuditLine, type AuditEntryLike } from "../../lib/auditLine";

/** Who, what, when, and a short description for one audit entry. */
export function AuditFacts({
  entry,
  when,
  whenIso,
  record,
}: {
  entry: AuditEntryLike;
  when: string;
  whenIso?: string;
  record?: string;
}) {
  const line = formatAuditLine(entry);
  const what = record ? `${line.what} · ${record}` : line.what;

  return (
    <dl className="grid grid-cols-[5.75rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-sm">
      <dt className="text-xs leading-5 text-muted-foreground">Who</dt>
      <dd className="min-w-0 leading-5">{line.who}</dd>
      <dt className="text-xs leading-5 text-muted-foreground">What</dt>
      <dd className={clsx("min-w-0 font-medium leading-5", entry.action === "delete" && "text-destructive")}>{what}</dd>
      <dt className="text-xs leading-5 text-muted-foreground">When</dt>
      <dd className="min-w-0 leading-5 text-muted-foreground">
        <time dateTime={whenIso}>{when}</time>
      </dd>
      <dt className="text-xs leading-5 text-muted-foreground">Description</dt>
      <dd className="min-w-0 leading-5">{line.description}</dd>
    </dl>
  );
}

import { StatusBadge } from "../tables/StatusBadge";

const HIDDEN_KEYS = new Set(["action"]); // already shown as the entry's headline, redundant here

/** Keys whose value looks like a filesystem path or filename — shown as a plain monospace value, not a link. See the limitation note below. */
const PATH_KEY_PATTERN = /path|filename/i;
const DATE_KEY_PATTERN = /(At|Date)$/;
const NOTES_KEY_PATTERN = /notes|summary|comment|reason|action$/i;
const SEVERITY_LIKE_KEYS = new Set(["severity", "userRole", "status", "statusCode"]);

function toLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function formatValue(key: string, value: unknown): { kind: "date" | "badge" | "path" | "notes" | "json" | "plain"; content: string } {
  if (value === null || value === undefined) return { kind: "plain", content: "—" };

  if (DATE_KEY_PATTERN.test(key) && (typeof value === "string" || typeof value === "number")) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return { kind: "date", content: d.toLocaleString() };
  }
  if (SEVERITY_LIKE_KEYS.has(key) && typeof value === "string") return { kind: "badge", content: value };
  if (PATH_KEY_PATTERN.test(key) && typeof value === "string") return { kind: "path", content: value };
  if (NOTES_KEY_PATTERN.test(key) && typeof value === "string") return { kind: "notes", content: value };
  if (typeof value === "object") return { kind: "json", content: JSON.stringify(value, null, 2) };
  return { kind: "plain", content: String(value) };
}

/**
 * Renders one entry's `changes` JSONB generically — every module's shape
 * differs (see the Audit Trail Dictionary: NCR nests real field changes
 * under `changes.patch`, most others keep them flat), so this flattens
 * `patch` alongside any top-level fields rather than assuming one shape.
 *
 * Deliberately does NOT turn certificatePath/filename values into download
 * links: each module's real download route has a different shape
 * (/equipment/calibration/:id/certificate, /training/assignment/:id/
 * certificate, /documents/version/:id/file) and the id it needs isn't
 * always the audit entry's own entityId — Calibration's entries are keyed
 * by equipmentId, not the calibration event the certificate belongs to.
 * Guessing a link here would be as likely to be wrong as right, so the raw
 * value is shown as text instead.
 */
export function WorkflowMetadataViewer({ changes }: { changes: Record<string, unknown> | null }) {
  if (!changes) return <p className="text-xs text-muted-foreground">No metadata recorded.</p>;

  const patch = changes.patch && typeof changes.patch === "object" ? (changes.patch as Record<string, unknown>) : null;
  const entries = Object.entries({ ...changes, ...(patch ?? {}) }).filter(([key]) => key !== "patch" && !HIDDEN_KEYS.has(key));

  if (entries.length === 0) return <p className="text-xs text-muted-foreground">No additional detail recorded.</p>;

  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-xs">
      {entries.map(([key, value]) => {
        const formatted = formatValue(key, value);
        return (
          <div key={key} className="contents">
            <dt className="whitespace-nowrap font-medium text-muted-foreground">{toLabel(key)}</dt>
            <dd className="min-w-0">
              {formatted.kind === "badge" && <StatusBadge value={formatted.content} />}
              {formatted.kind === "path" && <code className="break-all rounded bg-muted px-1 py-0.5 font-mono">{formatted.content}</code>}
              {formatted.kind === "notes" && <p className="whitespace-pre-wrap">{formatted.content}</p>}
              {formatted.kind === "json" && <pre className="whitespace-pre-wrap rounded bg-muted p-2 font-mono">{formatted.content}</pre>}
              {(formatted.kind === "date" || formatted.kind === "plain") && <span>{formatted.content}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

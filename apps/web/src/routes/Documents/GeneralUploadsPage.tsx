import { AttachmentsPanel } from "../../components/shared/AttachmentsPanel";

/**
 * The shared "General Uploads" bin — real files any user uploads that
 * aren't evidence on a specific record (an NCR, an 8D, ...; those get
 * attached directly from their own page instead — see AttachmentsPanel's
 * own comment). Tenant-wide visible, not a private per-user list, same
 * "shared QMS records, not personal silos" spirit as the rest of the app.
 */
export function GeneralUploadsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">General Uploads</h1>
        <p className="text-sm text-muted-foreground">Upload your own documents here when they aren't evidence for a specific record — everyone in your organization can see this list.</p>
      </div>
      <AttachmentsPanel title="Files" />
    </div>
  );
}

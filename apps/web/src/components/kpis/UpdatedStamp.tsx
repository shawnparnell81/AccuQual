import { formatUpdatedEt } from "../../lib/updatedStamp";

export function UpdatedStamp({ at }: { at: Date | string | null | undefined }) {
  if (!at) return null;
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return <p className="text-xs text-muted-foreground">{formatUpdatedEt(date)}</p>;
}

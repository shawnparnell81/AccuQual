import { useEffect } from "react";

/** Same "Saving… / Saved" line the NCR workspace uses, plus a browser warning while a change has not landed. */
export function SaveStatus({ saving, unsaved }: { saving: boolean; unsaved: boolean }) {
  useEffect(() => {
    if (!saving && !unsaved) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saving, unsaved]);

  const text = saving ? "Saving…" : unsaved ? "Unsaved changes" : "Saved";
  return (
    <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
      {text}
    </span>
  );
}

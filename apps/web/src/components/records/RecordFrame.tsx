import { useEffect, type ReactNode } from "react";
import { RECORD_STEP_ANCHOR } from "../../lib/stepDocuments";
import { PrintRecordButton } from "./PrintRecordButton";

/**
 * Outer skeleton for a record: header, the existing body, and a References
 * strip. The body is whatever the page already rendered — this does not
 * rebuild the form.
 */
export function RecordFrame({
  header,
  children,
  related,
  relatedPlacement = "side",
  className,
}: {
  header: ReactNode;
  children: ReactNode;
  related: ReactNode;
  relatedPlacement?: "side" | "below";
  className?: string;
}) {
  useEffect(() => {
    if (window.location.hash !== `#${RECORD_STEP_ANCHOR}`) return;
    document.getElementById(RECORD_STEP_ANCHOR)?.scrollIntoView({ block: "start" });
  }, []);

  const side = relatedPlacement === "side";
  return (
    <div className={className ? `record-frame flex flex-col gap-4 ${className}` : "record-frame flex flex-col gap-4"}>
      <div className="record-frame-header">
        <div className="no-print mb-2 flex justify-end">
          <PrintRecordButton />
        </div>
        {header}
      </div>
      <div className={side ? "grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]" : "flex flex-col gap-4"}>
        <div id={RECORD_STEP_ANCHOR} className="flex min-w-0 flex-col gap-4">
          {children}
        </div>
        <aside aria-label="References" className={side ? "record-related no-print flex flex-col gap-3 xl:sticky xl:top-4" : "record-related no-print flex flex-col gap-3"}>
          {related}
        </aside>
      </div>
    </div>
  );
}

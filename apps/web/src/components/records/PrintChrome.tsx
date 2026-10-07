import { useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { offersScreenPrint } from "../../lib/printDocument";
import { PrintRecordButton } from "./PrintRecordButton";

/**
 * Print for form pages that are not inside RecordFrame. Pages that use the
 * frame already carry the button, including grids added later.
 */
export function PrintChrome() {
  const { pathname } = useLocation();
  const host = useRef<HTMLDivElement>(null);
  const [framed, setFramed] = useState(false);
  const offer = offersScreenPrint(pathname);

  useLayoutEffect(() => {
    if (!offer) return;
    const parent = host.current?.parentElement;
    if (!parent) return;
    const sync = () => setFramed(parent.querySelector(".record-frame") != null);
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(parent, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [offer, pathname]);

  if (!offer) return null;

  return (
    <div ref={host} className={framed ? "hidden" : "no-print mb-3 flex justify-end"}>
      {!framed && <PrintRecordButton />}
    </div>
  );
}

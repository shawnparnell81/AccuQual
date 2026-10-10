import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { draftKey } from "../lib/sectionKeepAlive";
import { useDirtyPathStore } from "../store/dirtyPathStore";

/**
 * Tell the tab strip this page has unsaved edits. A sub-tab id keeps the dot
 * on that tab. The flag clears when the page unmounts, which happens when
 * the whole section is left, not when a sibling sub-page is hidden.
 */
export function useReportTabDirty(dirty: boolean, subtab?: string) {
  const path = draftKey(useLocation().pathname, subtab);
  const setDirtyPath = useDirtyPathStore((state) => state.setDirtyPath);
  useEffect(() => {
    setDirtyPath(path, dirty);
    return () => setDirtyPath(path, false);
  }, [dirty, path, setDirtyPath]);
}

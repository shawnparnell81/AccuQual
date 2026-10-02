import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useDirtyPathStore } from "../store/dirtyPathStore";

/** Tell the tab strip this page has unsaved edits. Clears when the page unmounts. */
export function useReportTabDirty(dirty: boolean) {
  const path = useLocation().pathname;
  const setDirtyPath = useDirtyPathStore((state) => state.setDirtyPath);
  useEffect(() => {
    setDirtyPath(path, dirty);
    return () => setDirtyPath(path, false);
  }, [dirty, path, setDirtyPath]);
}

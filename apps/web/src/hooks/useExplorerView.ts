import { useEffect, useState } from "react";
import { useCurrentUser } from "./useAuth";
import { readExplorerView, viewStorageKey, writeExplorerView, type ExplorerView, type ExplorerViewPage } from "../lib/explorerView";

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The view chosen for this page, remembered for this user in localStorage. */
export function useExplorerView(page: ExplorerViewPage): [ExplorerView, (view: ExplorerView) => void] {
  const userId = useCurrentUser()?.id ?? null;
  const [view, setView] = useState<ExplorerView>(() => readExplorerView(browserStorage(), viewStorageKey(page, null)));

  useEffect(() => {
    setView(readExplorerView(browserStorage(), viewStorageKey(page, userId)));
  }, [page, userId]);

  function choose(next: ExplorerView) {
    setView(next);
    writeExplorerView(browserStorage(), viewStorageKey(page, userId), next);
  }

  return [view, choose];
}

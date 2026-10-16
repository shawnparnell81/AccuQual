import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { apiClient } from "../../api/client";
import { folderPathLookupEnabled } from "../../lib/folderPath";
import { FolderPathBar } from "./FolderPathBar";

/** The open document's folder path, when this person can already see that folder. */
export function useItemFolderPath(): string {
  const { pathname } = useLocation();
  const enabled = folderPathLookupEnabled(pathname);
  // Only this page's path, not the whole folder tree (over a megabyte on a large company).
  const found = useQuery({
    queryKey: ["document-folders", "item-path", pathname],
    queryFn: async () => (await apiClient.get<{ folderId: number | null; path: string }>("/document-folders/item-path", { params: { route: pathname } })).data,
    enabled,
    retry: false,
    staleTime: 15_000,
  });
  if (!enabled || !found.data) return "";
  return found.data.path;
}

/** Path line at the top of a document or form. Hidden when this page is not a filed item. */
export function ItemFolderPath() {
  const path = useItemFolderPath();
  if (!path) return null;
  return <FolderPathBar path={path} />;
}

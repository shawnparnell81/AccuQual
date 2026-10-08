import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { apiClient } from "../../api/client";
import type { BrowseFolder } from "../../lib/folderBrowse";
import { folderNodeForRoute, folderNodePath, folderPathLookupEnabled } from "../../lib/folderPath";
import { FolderPathBar } from "./FolderPathBar";

/** The open document's folder path, when this person can already see that folder. */
export function useItemFolderPath(): string {
  const { pathname } = useLocation();
  const enabled = folderPathLookupEnabled(pathname);
  const folders = useQuery({
    queryKey: ["document-folders"],
    queryFn: async () => (await apiClient.get<BrowseFolder[]>("/document-folders")).data,
    enabled,
    retry: false,
    staleTime: 15_000,
  });
  if (!enabled || !folders.data) return "";
  const node = folderNodeForRoute(folders.data, pathname);
  if (!node) return "";
  return folderNodePath(folders.data, node.id);
}

/** Path line at the top of a document or form. Hidden when this page is not a filed item. */
export function ItemFolderPath() {
  const path = useItemFolderPath();
  if (!path) return null;
  return <FolderPathBar path={path} />;
}

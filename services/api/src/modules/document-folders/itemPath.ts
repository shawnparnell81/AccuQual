interface PathFolder {
  id: number;
  name: string;
  parentId: number | null;
  linkedPath?: string | null;
  documentId?: number | null;
}

/**
 * The filed row for an open page and its path, the same match the web app's
 * folderNodeForRoute makes: the linked page, a built form's template link for
 * its editor, or a document's own row. A row with a parent wins, then the lowest id.
 */
export function folderPathForRoute(folders: PathFolder[], route: string): { folderId: number | null; path: string } {
  const editor = /^\/form-builder\/(\d+)$/.exec(route);
  const document = /^\/documents\/(\d+)$/.exec(route);
  const matches = folders.filter((folder) => {
    const linked = folder.linkedPath?.split("?")[0] ?? "";
    if (linked && linked === route) return true;
    if (editor && linked === `/form-builder/template/${editor[1]}`) return true;
    if (document && folder.documentId === Number(document[1])) return true;
    return false;
  });
  const node = [...matches].sort((a, b) => (a.parentId == null ? 1 : 0) - (b.parentId == null ? 1 : 0) || a.id - b.id)[0];
  if (!node) return { folderId: null, path: "" };
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const seen = new Set<number>();
  let current: PathFolder | undefined = node;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId == null ? undefined : byId.get(current.parentId);
  }
  return { folderId: node.id, path: names.map((name) => name.trim()).filter(Boolean).join("\\") };
}

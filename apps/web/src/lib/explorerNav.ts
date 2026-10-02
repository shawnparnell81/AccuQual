/** Folder Explorer back/forward history and windowed lists. Filing rules stay in folderBrowse. */

export interface ExplorerPlace {
  deptId: number | null;
  folderId: number | null;
}

export interface ExplorerHistory {
  entries: ExplorerPlace[];
  index: number;
}

export interface Crumb {
  id: number | null;
  name: string;
}

export function initialExplorerHistory(): ExplorerHistory {
  return { entries: [{ deptId: null, folderId: null }], index: 0 };
}

export function currentExplorerPlace(history: ExplorerHistory): ExplorerPlace {
  return history.entries[history.index] ?? { deptId: null, folderId: null };
}

export function sameExplorerPlace(a: ExplorerPlace, b: ExplorerPlace): boolean {
  return a.deptId === b.deptId && a.folderId === b.folderId;
}

export function pushExplorerPlace(history: ExplorerHistory, place: ExplorerPlace): ExplorerHistory {
  const current = currentExplorerPlace(history);
  if (sameExplorerPlace(current, place)) return history;
  const entries = history.entries.slice(0, history.index + 1);
  entries.push(place);
  return { entries, index: entries.length - 1 };
}

export function stepExplorerHistory(history: ExplorerHistory, delta: number): ExplorerHistory {
  const index = Math.min(history.entries.length - 1, Math.max(0, history.index + delta));
  if (index === history.index) return history;
  return { ...history, index };
}

export function canGoBack(history: ExplorerHistory): boolean {
  return history.index > 0;
}

export function canGoForward(history: ExplorerHistory): boolean {
  return history.index < history.entries.length - 1;
}

export function explorerCrumbs(chain: { id: number; name: string }[]): Crumb[] {
  return [{ id: null, name: "Documents" }, ...chain.map((crumb) => ({ id: crumb.id, name: crumb.name }))];
}

/** Parent folder id, or null when the next step up is the department shelf. */
export function parentFolderId(chain: { id: number }[]): number | null {
  if (chain.length < 2) return null;
  return chain[chain.length - 2]?.id ?? null;
}

export interface VirtualWindow {
  start: number;
  end: number;
  offset: number;
  height: number;
}

/** Slice a long list to the rows near the scroll position. Small lists are returned whole. */
export function virtualRange(count: number, scrollTop: number, viewport: number, rowHeight: number, overscan = 4): VirtualWindow {
  const height = Math.max(0, count) * rowHeight;
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0, offset: 0, height: 0 };
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight) - overscan);
  const visible = Math.ceil(Math.max(rowHeight, viewport) / rowHeight) + overscan * 2;
  const end = Math.min(count, start + visible);
  return { start, end, offset: start * rowHeight, height };
}

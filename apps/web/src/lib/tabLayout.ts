export interface LayoutTab {
  id: string;
  pinned?: boolean;
}

/** Pinned tabs stay on the left, in the order they were pinned. */
export function withPinsLeft<T extends LayoutTab>(tabs: T[]): T[] {
  return [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)];
}

export function moveTab<T extends LayoutTab>(tabs: T[], fromId: string, toId: string): T[] {
  if (fromId === toId) return tabs;
  const from = tabs.findIndex((tab) => tab.id === fromId);
  const to = tabs.findIndex((tab) => tab.id === toId);
  if (from < 0 || to < 0) return tabs;
  const next = tabs.slice();
  const [row] = next.splice(from, 1);
  if (!row) return tabs;
  next.splice(to, 0, row);
  return withPinsLeft(next);
}

export function setTabPinned<T extends LayoutTab>(tabs: T[], id: string, pinned: boolean): T[] {
  return withPinsLeft(tabs.map((tab) => (tab.id === id ? { ...tab, pinned } : tab)));
}

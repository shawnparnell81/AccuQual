import type { SidebarPlacementInput } from "./users.validation.js";

/** Folder Explorer opened on Blank Forms Templates. Kept in sync with apps/web blankFormsFolderHref(). */
const BLANK_FORMS_TEMPLATES_HREF = "/documents/folders?name=Blank%20Forms%20Templates";
const BLANK_FORMS_PIN_KEY = "pin-blank-form-templates";

/**
 * Menu rows the app always keeps. Matches LOCKED_SIDEBAR_KEYS in the web catalog.
 * Home is the first item. A saved layout that hid it or nested it is repaired on read.
 */
const LOCKED_SIDEBAR_KEYS = ["home"] as const;

export interface SidebarShortcutPrefs {
  hidden: string[];
  pinned: { key: string; label: string; path: string }[];
  layout: SidebarPlacementInput[] | null;
  groups: { key: string; label: string }[];
  /** Catalog rows already offered to this saved menu. A later hide of one of these keys stays hidden. */
  offered: string[];
  /** 2 is the ERP group menu. Missing means a menu saved before those groups. */
  menuEdition?: number;
}

export const BLANK_FORMS_SIDEBAR_KEY = "blank-forms";

export function emptySidebarShortcuts(): SidebarShortcutPrefs {
  return { hidden: [], pinned: [], layout: null, groups: [], offered: [] };
}

function isLockedSidebarKey(key: string): boolean {
  return (LOCKED_SIDEBAR_KEYS as readonly string[]).includes(key);
}

function trimPath(path: string): string {
  const trimmed = path.trim();
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
}

/**
 * A saved QMS Forms shortcut opens Blank Forms, or the saved-copy folder for one form.
 * The catalog pin is dropped because Blank Forms is already a menu row.
 */
function cleanPin(pin: { key: string; label: string; path: string }): { key: string; label: string; path: string } | null {
  if (pin.key === "blank:master_document_register") return null;
  const raw = trimPath(pin.path);
  if (raw === "/qms-forms/master_document_register") return null;
  let path = raw;
  let label = pin.label;
  const wasCatalog = pin.key === "qms-forms" || label === "QMS Forms" || raw === "/qms-forms";
  if (raw === "/qms-forms" || pin.key === "qms-forms") {
    path = "/blank-forms";
    label = "Blank Forms";
  } else {
    const typeOnly = raw.match(/^\/qms-forms\/([A-Za-z0-9_-]+)$/);
    if (typeOnly) {
      const formType = typeOnly[1] ?? "";
      path = formType === "first_article_inspection" ? "/blank-forms" : `/form-folders/${formType}`;
      if (label === "QMS Forms") label = path === "/blank-forms" ? "Blank Forms" : label;
    }
  }
  if (wasCatalog && path === "/blank-forms") return null;
  if (label === "QMS Forms") label = path.startsWith("/form-folders/") ? "Saved forms" : "Blank Forms";
  return { ...pin, path, label };
}

function layoutContainsKey(nodes: { key?: string; children?: unknown }[] | null | undefined, key: string): boolean {
  for (const node of nodes ?? []) {
    if (node?.key === key) return true;
    if (Array.isArray(node?.children) && layoutContainsKey(node.children as { key?: string; children?: unknown }[], key)) return true;
  }
  return false;
}

function mapQmsFormsPlacement(nodes: SidebarPlacementInput[]): SidebarPlacementInput[] {
  const seen = new Set<string>();
  function walk(items: SidebarPlacementInput[]): SidebarPlacementInput[] {
    const out: SidebarPlacementInput[] = [];
    for (const node of items) {
      const key = node.key === "qms-forms" ? BLANK_FORMS_SIDEBAR_KEY : node.key;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const children = node.children ? walk(node.children) : undefined;
      out.push(children && children.length > 0 ? { key, children } : { key });
    }
    return out;
  }
  return walk(nodes);
}

function cleanSidebarLayout(nodes: { key: string; children?: unknown }[] | null | undefined): SidebarPlacementInput[] | null {
  if (!nodes) return null;
  const seen = new Set<string>();
  let count = 0;
  function walk(items: { key: string; children?: unknown }[], depth: number): SidebarPlacementInput[] {
    if (depth > 8) return [];
    const out: SidebarPlacementInput[] = [];
    for (const node of items) {
      if (count > 400 || !node || typeof node.key !== "string") continue;
      const key = node.key;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      count += 1;
      const nested = Array.isArray(node.children) ? walk(node.children as { key: string; children?: unknown }[], depth + 1) : undefined;
      out.push(nested && nested.length > 0 ? { key, children: nested } : { key });
    }
    return out;
  }
  const layout = walk(nodes, 0);
  return layout.length > 0 ? layout : null;
}

/** Puts locked rows first. Inserts Home when a saved arrangement left it out. A null layout stays null. */
export function hoistLockedLayout(nodes: SidebarPlacementInput[] | null): SidebarPlacementInput[] | null {
  if (!nodes) return null;
  const found = new Map<string, SidebarPlacementInput>();
  function pull(items: SidebarPlacementInput[]): SidebarPlacementInput[] {
    const out: SidebarPlacementInput[] = [];
    for (const node of items) {
      const children = node.children ? pull(node.children) : undefined;
      if (isLockedSidebarKey(node.key)) {
        if (!found.has(node.key)) found.set(node.key, children && children.length > 0 ? { key: node.key, children } : { key: node.key });
        continue;
      }
      out.push(children && children.length > 0 ? { key: node.key, children } : { key: node.key });
    }
    return out;
  }
  const rest = pull(nodes);
  const locked = LOCKED_SIDEBAR_KEYS.map((key) => found.get(key) ?? { key });
  return [...locked, ...rest];
}

function layoutHasKey(nodes: { key: string; children?: { key: string }[] }[] | null | undefined, key: string): boolean {
  for (const node of nodes ?? []) {
    if (node.key === key) return true;
    if (layoutHasKey(node.children as { key: string; children?: { key: string }[] }[] | undefined, key)) return true;
  }
  return false;
}

function readMenuEdition(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const edition = Math.floor(value);
  if (edition < 0 || edition > 20) return undefined;
  return edition;
}

function normalizeSidebarShortcuts(raw: {
  hidden?: string[];
  pinned?: { key: string; label: string; path: string }[];
  layout?: { key: string; children?: unknown }[] | null;
  groups?: { key: string; label: string }[];
  offered?: string[];
  menuEdition?: number;
} | null | undefined): SidebarShortcutPrefs {
  const alreadyOffered = (raw?.offered ?? []).includes(BLANK_FORMS_SIDEBAR_KEY);
  const sawQmsForms =
    layoutContainsKey(raw?.layout, "qms-forms") ||
    (raw?.pinned ?? []).some((pin) => pin?.key === "qms-forms" || pin?.label === "QMS Forms" || trimPath(pin?.path ?? "") === "/qms-forms");
  const hidden = [
    ...new Set(
      (raw?.hidden ?? []).filter((key) => {
        if (typeof key !== "string" || key.length === 0 || isLockedSidebarKey(key) || key === "qms-forms") return false;
        if (key === BLANK_FORMS_SIDEBAR_KEY && (!alreadyOffered || sawQmsForms)) return false;
        return true;
      }),
    ),
  ];
  const hiddenSet = new Set(hidden);
  const seen = new Set<string>();
  const pinned: SidebarShortcutPrefs["pinned"] = [];
  for (const pin of raw?.pinned ?? []) {
    if (!pin) continue;
    const next = cleanPin(pin);
    if (!next || hiddenSet.has(next.key) || seen.has(next.key)) continue;
    seen.add(next.key);
    pinned.push(next);
  }
  const cleanedLayout = cleanSidebarLayout(raw?.layout);
  let layout = hoistLockedLayout(cleanedLayout ? mapQmsFormsPlacement(cleanedLayout) : null);
  const layoutKeys = new Set<string>();
  function collect(nodes: { key: string; children?: { key: string }[] }[] | null | undefined) {
    for (const node of nodes ?? []) {
      layoutKeys.add(node.key);
      collect(node.children as { key: string; children?: { key: string }[] }[] | undefined);
    }
  }
  collect(layout);
  if (layout && !layoutHasKey(layout, BLANK_FORMS_SIDEBAR_KEY) && !hiddenSet.has(BLANK_FORMS_SIDEBAR_KEY)) {
    layout = [...layout, { key: BLANK_FORMS_SIDEBAR_KEY }];
    layoutKeys.add(BLANK_FORMS_SIDEBAR_KEY);
  }
  if (layoutKeys.has(BLANK_FORMS_PIN_KEY) && !seen.has(BLANK_FORMS_PIN_KEY) && !hiddenSet.has(BLANK_FORMS_PIN_KEY)) {
    pinned.push({ key: BLANK_FORMS_PIN_KEY, label: "Blank Forms Templates", path: BLANK_FORMS_TEMPLATES_HREF });
  }
  const groups: { key: string; label: string }[] = [];
  const groupSeen = new Set<string>();
  for (const group of raw?.groups ?? []) {
    if (!group || groupSeen.has(group.key)) continue;
    groupSeen.add(group.key);
    groups.push(group);
  }
  const offered = [...new Set([...(raw?.offered ?? []).filter((key) => typeof key === "string" && key.length > 0), BLANK_FORMS_SIDEBAR_KEY])];
  const menuEdition = readMenuEdition(raw?.menuEdition);
  return menuEdition === undefined ? { hidden, pinned, layout: layout ?? null, groups, offered } : { hidden, pinned, layout: layout ?? null, groups, offered, menuEdition };
}

export { normalizeSidebarShortcuts };

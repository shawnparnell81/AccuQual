import { Folder, Pin } from "lucide-react";
import { isFolder, isLockedSidebarKey, LOCKED_SIDEBAR_KEYS, SIDEBAR_FOLDERS, type SidebarLink, type SidebarNode } from "../components/layout/sidebarStructure";
import { blankFormsFolderHref } from "./folderBrowse";
import { acceptSidebarPath, filterSidebarByAccess, type SidebarAccess } from "./sidebarAccess";
import { defaultPlacements, findPlacement, moveSidebarItem, nudgeSidebarItem, placementParent, type SidebarPlacement } from "./sidebarLayout";
import {
  applyUserShortcuts,
  EMPTY_SIDEBAR_SHORTCUTS,
  isRetiredShortcut,
  SHORTCUTS_FOLDER_KEY,
  shortcutIcon,
  type PinnedShortcut,
  type SidebarShortcutPrefs,
} from "./sidebarShortcuts";

export const BLANK_FORMS_PIN_KEY = "pin-blank-form-templates";
export const SIDEBAR_PREFS_CACHE = "accuqual-sidebar-prefs";

export interface SidebarGroupPref {
  key: string;
  label: string;
}

/** ERP groups. A saved menu from before this edition gets its group hides cleared once. */
export const MENU_EDITION = 2;

export interface SidebarDraft {
  layout: SidebarPlacement[];
  hidden: string[];
  pinned: PinnedShortcut[];
  groups: SidebarGroupPref[];
  menuEdition: number;
}

export interface SidebarCacheBlob {
  prefs: SidebarShortcutPrefs;
  levels?: Record<string, string>;
}

export interface LayoutRow {
  key: string;
  label: string;
  depth: number;
  kind: "item" | "section" | "pin";
  hidden: boolean;
  /** Home stays at the top. The editor shows it pinned and does not move or hide it. */
  locked: boolean;
}

function collectKeys(nodes: SidebarPlacement[], into = new Set<string>()): Set<string> {
  for (const node of nodes) {
    into.add(node.key);
    if (node.children) collectKeys(node.children, into);
  }
  return into;
}

function insertPlacement(layout: SidebarPlacement[], parentKey: string | null, item: SidebarPlacement, afterKey: string | null) {
  if (parentKey !== null) {
    const parent = findPlacement(layout, parentKey);
    if (!parent) {
      layout.push(item);
      return;
    }
    parent.children ??= [];
  }
  const children = parentKey === null ? layout : findPlacement(layout, parentKey)!.children!;
  const index = afterKey == null ? -1 : children.findIndex((child) => child.key === afterKey);
  if (index >= 0) children.splice(index + 1, 0, item);
  else children.push(item);
}

function ensureCatalogPlaced(layout: SidebarPlacement[], catalog: SidebarNode[], skip: Set<string>): SidebarPlacement[] {
  const next = structuredClone(layout);
  const used = collectKeys(next);
  function walk(nodes: SidebarNode[], parentKey: string | null) {
    let previousKey: string | null = null;
    for (const node of nodes) {
      if (!used.has(node.key) && !skip.has(node.key)) {
        used.add(node.key);
        insertPlacement(next, parentKey, isFolder(node) ? { key: node.key, children: [] } : { key: node.key }, previousKey);
      }
      if (used.has(node.key)) previousKey = node.key;
      if (isFolder(node)) walk(node.children, used.has(node.key) ? node.key : parentKey);
    }
  }
  walk(catalog, null);
  return next;
}

function ensurePinsPlaced(layout: SidebarPlacement[], pinned: PinnedShortcut[]): SidebarPlacement[] {
  const next = structuredClone(layout);
  const used = collectKeys(next);
  const missing = pinned.filter((pin) => !used.has(pin.key));
  if (missing.length === 0) return next;
  return [{ key: SHORTCUTS_FOLDER_KEY, children: missing.map((pin) => ({ key: pin.key })) }, ...next];
}

function ensureGroupsPlaced(layout: SidebarPlacement[], groups: SidebarGroupPref[]): SidebarPlacement[] {
  const next = structuredClone(layout);
  const used = collectKeys(next);
  for (const group of groups) {
    if (!used.has(group.key)) next.push({ key: group.key, children: [] });
  }
  return next;
}

export function normalizePin(pin: PinnedShortcut): PinnedShortcut | null {
  if (!pin?.key || isRetiredShortcut(pin)) return null;
  const path = acceptSidebarPath(pin.path);
  if (!path) return null;
  return { ...pin, path };
}

function rewriteBlankPlacements(nodes: SidebarPlacement[]): SidebarPlacement[] {
  const seen = new Set<string>();
  const out: SidebarPlacement[] = [];
  for (const node of nodes) {
    const key = node.key;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const children = node.children ? rewriteBlankPlacements(node.children) : undefined;
    out.push(children ? { key, children } : { key });
  }
  return out;
}

function indexCatalog(nodes: SidebarNode[], map = new Map<string, SidebarNode>()): Map<string, SidebarNode> {
  for (const node of nodes) {
    map.set(node.key, node);
    if (isFolder(node)) indexCatalog(node.children, map);
  }
  return map;
}

function materialize(items: SidebarPlacement[], ctx: { catalog: Map<string, SidebarNode>; pins: Map<string, PinnedShortcut>; groups: Map<string, SidebarGroupPref>; used: Set<string> }): SidebarNode[] {
  const out: SidebarNode[] = [];
  for (const item of items) {
    if (!item.key || ctx.used.has(item.key)) continue;
    const children = item.children ? materialize(item.children, ctx) : [];
    const node = nodeFor(item.key, children, ctx);
    if (!node) continue;
    ctx.used.add(item.key);
    out.push(node);
  }
  return out;
}

function nodeFor(key: string, children: SidebarNode[], ctx: { catalog: Map<string, SidebarNode>; pins: Map<string, PinnedShortcut>; groups: Map<string, SidebarGroupPref> }): SidebarNode | null {
  if (key === SHORTCUTS_FOLDER_KEY) {
    return { key, label: "Shortcuts", icon: Pin, children };
  }
  const group = ctx.groups.get(key);
  if (group || key.startsWith("group:")) {
    return { key, label: group?.label || "Section", icon: Folder, children };
  }
  const pin = ctx.pins.get(key);
  if (pin || key.startsWith("pin-") || key.startsWith("blank:")) {
    if (!pin) return null;
    return { key: pin.key, label: pin.label, path: pin.path, icon: shortcutIcon(pin.key) };
  }
  const source = ctx.catalog.get(key);
  if (!source) return null;
  if (isFolder(source)) return { ...source, children };
  return source;
}

function dropHidden(nodes: SidebarNode[], hidden: Set<string>): SidebarNode[] {
  const out: SidebarNode[] = [];
  for (const node of nodes) {
    const locked = isLockedSidebarKey(node.key);
    if (!locked && hidden.has(node.key)) continue;
    if (isFolder(node)) {
      const children = dropHidden(node.children, hidden);
      if (!locked && children.length === 0 && !node.path) continue;
      out.push({ ...node, children });
    } else {
      out.push(node);
    }
  }
  return out;
}

function withoutLockedHidden(hidden: string[]): string[] {
  return hidden.filter((key) => !isLockedSidebarKey(key));
}

function catalogFolderKeys(nodes: SidebarNode[], into = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (!isFolder(node)) continue;
    into.add(node.key);
    catalogFolderKeys(node.children, into);
  }
  return into;
}

function readMenuEdition(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

/** Pulls locked rows out of whatever section they were saved in and puts them first. A missing Home is inserted. */
export function hoistLockedPlacements(layout: SidebarPlacement[]): SidebarPlacement[] {
  const found = new Map<string, SidebarPlacement>();
  function pull(nodes: SidebarPlacement[]): SidebarPlacement[] {
    const out: SidebarPlacement[] = [];
    for (const node of nodes) {
      if (!node?.key) continue;
      const children = node.children ? pull(node.children) : undefined;
      if (isLockedSidebarKey(node.key)) {
        if (!found.has(node.key)) found.set(node.key, children && children.length > 0 ? { key: node.key, children } : { key: node.key });
        continue;
      }
      out.push(children && children.length > 0 ? { key: node.key, children } : { key: node.key });
    }
    return out;
  }
  const rest = pull(layout);
  const locked = LOCKED_SIDEBAR_KEYS.map((key) => found.get(key) ?? { key });
  return [...locked, ...rest];
}

/** Moves locked catalog rows to the front of a rendered menu. Does not invent a row the catalog never had. */
function hoistLockedNodes(nodes: SidebarNode[]): SidebarNode[] {
  const found = new Map<string, SidebarNode>();
  function pull(items: SidebarNode[]): SidebarNode[] {
    const out: SidebarNode[] = [];
    for (const node of items) {
      if (isFolder(node)) {
        const children = pull(node.children);
        if (isLockedSidebarKey(node.key)) {
          if (!found.has(node.key)) found.set(node.key, { ...node, children });
          continue;
        }
        out.push({ ...node, children });
      } else if (isLockedSidebarKey(node.key)) {
        if (!found.has(node.key)) found.set(node.key, node);
      } else {
        out.push(node);
      }
    }
    return out;
  }
  const rest = pull(nodes);
  const locked: SidebarNode[] = [];
  for (const key of LOCKED_SIDEBAR_KEYS) {
    const node = found.get(key);
    if (node) locked.push(node);
  }
  return [...locked, ...rest];
}

/**
 * Read-time fix for a saved menu. Home is never hidden and, when this person
 * has their own arrangement, it is the first row. A null layout stays null:
 * that means the built-in menu, which already starts with Home.
 */
export function normalizeSidebarPrefs(prefs: SidebarShortcutPrefs | null | undefined): SidebarShortcutPrefs {
  const edition = readMenuEdition(prefs?.menuEdition);
  let hidden = withoutLockedHidden(prefs?.hidden ?? []);
  if (edition < MENU_EDITION) {
    const folders = catalogFolderKeys(SIDEBAR_FOLDERS);
    hidden = hidden.filter((key) => !folders.has(key));
  }
  const pinned = prefs?.pinned ?? [];
  const groups = prefs?.groups ?? [];
  const layout = prefs?.layout ? hoistLockedPlacements(prefs.layout) : (prefs?.layout ?? null);
  return { hidden, pinned, layout, groups, menuEdition: Math.max(edition, MENU_EDITION) };
}

function settle(draft: SidebarDraft): SidebarDraft {
  return { ...draft, hidden: withoutLockedHidden(draft.hidden), layout: hoistLockedPlacements(draft.layout) };
}

function cleanPins(pins: PinnedShortcut[] | undefined): PinnedShortcut[] {
  const seen = new Set<string>();
  const out: PinnedShortcut[] = [];
  for (const pin of pins ?? []) {
    const next = normalizePin(pin);
    if (!next || seen.has(next.key) || seen.has(next.path)) continue;
    seen.add(next.key);
    seen.add(next.path);
    out.push(next);
  }
  return out;
}

function withBlankPin(layout: SidebarPlacement[], pinned: PinnedShortcut[]): PinnedShortcut[] {
  if (!collectKeys(layout).has(BLANK_FORMS_PIN_KEY)) return pinned;
  if (pinned.some((pin) => pin.key === BLANK_FORMS_PIN_KEY)) return pinned;
  return [...pinned, { key: BLANK_FORMS_PIN_KEY, label: "Blank Forms Templates", path: blankFormsFolderHref() }];
}

/** The menu this person actually sees. No saved layout means the built-in order. */
export function resolveUserSidebar(catalog: SidebarNode[], rawPrefs: SidebarShortcutPrefs | null | undefined, access: SidebarAccess): SidebarNode[] {
  const prefs = normalizeSidebarPrefs(rawPrefs);
  const hidden = prefs.hidden;
  const pinned = cleanPins(prefs.pinned);
  const groups = prefs.groups ?? [];
  let nodes: SidebarNode[];
  if (!prefs.layout) {
    nodes = applyUserShortcuts(catalog, { hidden, pinned });
  } else {
    const layout = hoistLockedPlacements(
      ensureGroupsPlaced(
        ensurePinsPlaced(ensureCatalogPlaced(rewriteBlankPlacements(prefs.layout), catalog, new Set(hidden)), pinned),
        groups,
      ),
    );
    const placedPins = withBlankPin(layout, pinned);
    nodes = materialize(layout, {
      catalog: indexCatalog(catalog),
      pins: new Map(placedPins.map((pin) => [pin.key, pin])),
      groups: new Map(groups.map((group) => [group.key, group])),
      used: new Set<string>(),
    });
    nodes = dropHidden(nodes, new Set(hidden));
  }
  return filterSidebarByAccess(hoistLockedNodes(nodes), access);
}

/** The arrangement being edited, including rows that are currently hidden. */
export function editorNodes(draft: SidebarDraft, catalog: SidebarNode[]): SidebarNode[] {
  return materialize(draft.layout, {
    catalog: indexCatalog(catalog),
    pins: new Map(draft.pinned.map((pin) => [pin.key, pin])),
    groups: new Map(draft.groups.map((group) => [group.key, group])),
    used: new Set<string>(),
  });
}

export function draftFromPrefs(catalog: SidebarNode[], rawPrefs: SidebarShortcutPrefs | null | undefined): SidebarDraft {
  const prefs = normalizeSidebarPrefs(rawPrefs);
  const hidden = [...prefs.hidden];
  const pinned = cleanPins(prefs.pinned);
  const groups = [...(prefs.groups ?? [])];
  const base = prefs.layout ? rewriteBlankPlacements(prefs.layout) : defaultPlacements(catalog);
  const withPins = prefs.layout ? base : ensurePinsPlaced(base, pinned);
  const layout = hoistLockedPlacements(ensureGroupsPlaced(ensurePinsPlaced(ensureCatalogPlaced(withPins, catalog, new Set()), pinned), groups));
  return { layout, hidden, pinned: withBlankPin(layout, pinned), groups, menuEdition: prefs.menuEdition ?? MENU_EDITION };
}

export function draftToPrefs(draft: SidebarDraft): SidebarShortcutPrefs {
  return normalizeSidebarPrefs({
    hidden: [...draft.hidden],
    pinned: cleanPins(draft.pinned),
    layout: draft.layout,
    groups: [...draft.groups],
    menuEdition: draft.menuEdition,
  });
}

export function toggleHidden(draft: SidebarDraft, key: string): SidebarDraft {
  if (isLockedSidebarKey(key)) return draft;
  const hidden = draft.hidden.includes(key) ? draft.hidden.filter((item) => item !== key) : [...draft.hidden, key];
  return settle({ ...draft, hidden });
}

export function nudgeDraft(draft: SidebarDraft, key: string, direction: -1 | 1): SidebarDraft {
  if (isLockedSidebarKey(key)) return draft;
  const place = placementParent(draft.layout, key);
  if (place && direction < 0 && isLockedSidebarKey(place.siblings[place.index - 1]?.key ?? "")) return draft;
  const layout = nudgeSidebarItem(draft.layout, key, direction);
  if (!layout) return draft;
  return settle({ ...draft, layout });
}

export function moveDraftItem(draft: SidebarDraft, key: string, parentKey: string | null, index: number): SidebarDraft {
  if (isLockedSidebarKey(key)) return draft;
  const layout = moveSidebarItem(draft.layout, key, parentKey, index);
  if (!layout) return draft;
  return settle({ ...draft, layout });
}

export function moveDraftInto(draft: SidebarDraft, key: string, parentKey: string | null): SidebarDraft {
  const parent = parentKey ? findPlacement(draft.layout, parentKey) : null;
  const index = parentKey ? (parent?.children?.length ?? 0) : draft.layout.length;
  return moveDraftItem(draft, key, parentKey, index);
}

export function addPin(draft: SidebarDraft, pin: PinnedShortcut): SidebarDraft {
  const next = normalizePin(pin);
  if (!next) return draft;
  if (draft.pinned.some((item) => item.key === next.key || item.path === next.path)) return draft;
  const layout = findPlacement(draft.layout, next.key) ? draft.layout : [{ key: next.key }, ...draft.layout];
  return settle({ ...draft, pinned: [...draft.pinned, next], layout, hidden: draft.hidden.filter((key) => key !== next.key) });
}

function removeKey(nodes: SidebarPlacement[], key: string): SidebarPlacement[] {
  const out: SidebarPlacement[] = [];
  for (const node of nodes) {
    if (node.key === key) continue;
    out.push(node.children ? { ...node, children: removeKey(node.children, key) } : node);
  }
  return out;
}

export function removePin(draft: SidebarDraft, key: string): SidebarDraft {
  if (isLockedSidebarKey(key)) return draft;
  return settle({ ...draft, pinned: draft.pinned.filter((pin) => pin.key !== key), layout: removeKey(draft.layout, key) });
}

function groupKey(label: string, explicit?: string): string {
  if (explicit && /^group:[A-Za-z0-9_-]+$/.test(explicit)) return explicit;
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "section";
  return `group:${slug}-${Date.now().toString(36)}`;
}

export function addGroup(draft: SidebarDraft, label: string, key?: string): SidebarDraft {
  const name = label.trim().slice(0, 40);
  if (!name) return draft;
  const id = groupKey(name, key);
  if (draft.groups.some((group) => group.key === id) || findPlacement(draft.layout, id)) return draft;
  return settle({ ...draft, groups: [...draft.groups, { key: id, label: name }], layout: [...draft.layout, { key: id, children: [] }] });
}

export function removeGroup(draft: SidebarDraft, key: string): SidebarDraft {
  const place = placementParent(draft.layout, key);
  const groups = draft.groups.filter((group) => group.key !== key);
  if (!place) return settle({ ...draft, groups });
  const children = place.siblings[place.index]?.children ?? [];
  const layout = removeKey(structuredClone(draft.layout), key);
  const parentList = place.parentKey === null ? layout : findPlacement(layout, place.parentKey)?.children;
  parentList?.splice(Math.min(place.index, parentList.length), 0, ...children);
  return settle({ ...draft, layout, groups });
}

export function layoutRows(draft: SidebarDraft, catalog: SidebarNode[]): LayoutRow[] {
  const byKey = indexCatalog(catalog);
  const hidden = new Set(draft.hidden);
  const out: LayoutRow[] = [];
  function walk(nodes: SidebarPlacement[], depth: number) {
    for (const node of nodes) {
      const described = describe(node.key, draft, byKey);
      if (!described) continue;
      out.push({
        key: node.key,
        label: described.label,
        depth,
        kind: described.kind,
        hidden: !isLockedSidebarKey(node.key) && hidden.has(node.key),
        locked: isLockedSidebarKey(node.key),
      });
      if (node.children) walk(node.children, depth + 1);
    }
  }
  walk(draft.layout, 0);
  return out;
}

function describe(key: string, draft: SidebarDraft, catalog: Map<string, SidebarNode>): { label: string; kind: LayoutRow["kind"] } | null {
  if (key === SHORTCUTS_FOLDER_KEY) return { label: "Shortcuts", kind: "section" };
  const group = draft.groups.find((item) => item.key === key);
  if (group || key.startsWith("group:")) return { label: group?.label || "Section", kind: "section" };
  const pin = draft.pinned.find((item) => item.key === key);
  if (pin) return { label: pin.label, kind: "pin" };
  const node = catalog.get(key);
  if (!node) return null;
  return { label: node.label, kind: isFolder(node) ? "section" : "item" };
}

export function pinKeyForPath(path: string): string {
  const safe = path.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `pin-${safe || "page"}`;
}

function isPrefs(value: unknown): value is SidebarShortcutPrefs {
  if (!value || typeof value !== "object") return false;
  const prefs = value as SidebarShortcutPrefs;
  return Array.isArray(prefs.hidden) && Array.isArray(prefs.pinned);
}

export function readSidebarCache(storage: Pick<Storage, "getItem">, userId: number): SidebarCacheBlob | null {
  try {
    const raw = storage.getItem(`${SIDEBAR_PREFS_CACHE}:${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const blob = parsed as SidebarCacheBlob;
    if (!isPrefs(blob.prefs)) return null;
    return blob;
  } catch {
    return null;
  }
}

export function writeSidebarCache(storage: Pick<Storage, "getItem" | "setItem">, userId: number, patch: Partial<SidebarCacheBlob>) {
  const current = readSidebarCache(storage, userId);
  const next: SidebarCacheBlob = {
    prefs: patch.prefs ?? current?.prefs ?? EMPTY_SIDEBAR_SHORTCUTS,
    levels: patch.levels ?? current?.levels,
  };
  try {
    storage.setItem(`${SIDEBAR_PREFS_CACHE}:${userId}`, JSON.stringify(next));
  } catch {
    // The server copy still loads. This browser just paints after the request.
  }
}

export function linkPath(node: SidebarNode): string | undefined {
  return isFolder(node) ? node.path : (node as SidebarLink).path;
}

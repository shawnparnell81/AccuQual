import {
  FileText,
  Gauge,
  GitBranch,
  GraduationCap,
  Pin,
  ScrollText,
  ShieldAlert,
  Workflow,
} from "lucide-react";
import { flattenSidebarLinks, isFolder, type SidebarLink, type SidebarNode } from "../components/layout/sidebarStructure";
import { faiValidationDocumentsHref, LEGACY_VALIDATION_REPORTS_PATH } from "./folderBrowse";

export interface PinnedShortcut {
  key: string;
  label: string;
  path: string;
}

export interface SidebarShortcutPrefs {
  hidden: string[];
  pinned: PinnedShortcut[];
}

export const EMPTY_SIDEBAR_SHORTCUTS: SidebarShortcutPrefs = { hidden: [], pinned: [] };

export const SHORTCUTS_FOLDER_KEY = "my-shortcuts";

/**
 * Pages taken off the shared menu that a person can pin back.
 * Blank forms are added in the picker; they are not pinned until someone chooses them.
 */
export const PINNABLE_SHORTCUTS: PinnedShortcut[] = [
  { key: "pin-master-document-list", label: "Master Document List", path: "/documents/master-list" },
  { key: "pin-master-equipment-list", label: "Master Equipment List", path: "/calibration/master-list" },
  { key: "pin-fmea", label: "FMEA", path: "/risk" },
  { key: "pin-turtle", label: "Turtle Diagrams", path: "/iso-forms/frm-prc-001" },
  { key: "pin-cross-training", label: "Cross-training evaluation", path: "/iso-forms/frm-trn-002" },
  { key: "pin-ecn", label: "ECN", path: "/folders/ecn" },
  { key: "pin-ecr", label: "ECR", path: "/folders/ecr" },
  { key: "pin-work-instruction", label: "Work Instruction", path: "/folders/work-instructions" },
];

const PIN_ICONS: Record<string, SidebarLink["icon"]> = {
  "pin-master-document-list": FileText,
  "pin-master-equipment-list": Gauge,
  "pin-fmea": ShieldAlert,
  "pin-turtle": Workflow,
  "pin-cross-training": GraduationCap,
  "pin-ecn": GitBranch,
  "pin-ecr": GitBranch,
  "pin-work-instruction": ScrollText,
};

/** Blank Register pin. The live list pin (`pin-master-document-list`) stays. */
export function isRetiredShortcut(pin: { key?: string; path?: string }): boolean {
  return pin.key === "blank:master_document_register" || pin.path === "/qms-forms/master_document_register";
}

export function isPersonalShortcutKey(key: string): boolean {
  return key === SHORTCUTS_FOLDER_KEY || key.startsWith("pin-") || key.startsWith("blank:");
}

export function shortcutIcon(key: string): SidebarLink["icon"] {
  return PIN_ICONS[key] ?? Pin;
}

function filterHidden(nodes: SidebarNode[], hidden: Set<string>): SidebarNode[] {
  const out: SidebarNode[] = [];
  for (const node of nodes) {
    if (hidden.has(node.key)) continue;
    if (isFolder(node)) {
      const children = filterHidden(node.children, hidden);
      if (children.length === 0 && !node.path) continue;
      out.push({ ...node, children });
    } else {
      out.push(node);
    }
  }
  return out;
}

function toLink(pin: PinnedShortcut): SidebarLink {
  return { key: pin.key, label: pin.label, path: pin.path, icon: shortcutIcon(pin.key) };
}

/**
 * Hides shared items this person turned off and adds a Shortcuts folder for what they pinned.
 * An empty preference leaves the shared menu unchanged.
 */
export function applyUserShortcuts(nodes: SidebarNode[], prefs: SidebarShortcutPrefs | null | undefined): SidebarNode[] {
  const hidden = new Set(prefs?.hidden ?? []);
  const filtered = filterHidden(nodes, hidden);
  const visiblePaths = new Set(flattenSidebarLinks(filtered).map((link) => link.path));
  const seen = new Set<string>();
  const pins: SidebarLink[] = [];
  for (const pin of prefs?.pinned ?? []) {
    if (!pin?.key || hidden.has(pin.key) || isRetiredShortcut(pin)) continue;
    const path = pin.path === LEGACY_VALIDATION_REPORTS_PATH ? faiValidationDocumentsHref() : pin.path;
    if (seen.has(pin.key) || seen.has(path) || visiblePaths.has(path)) continue;
    seen.add(pin.key);
    seen.add(path);
    pins.push(toLink({ ...pin, path }));
  }
  if (pins.length === 0) return filtered;
  return [{ key: SHORTCUTS_FOLDER_KEY, label: "Shortcuts", icon: Pin, children: pins }, ...filtered];
}

export function sidebarToggleRows(nodes: SidebarNode[], depth = 0): { key: string; label: string; depth: number }[] {
  const out: { key: string; label: string; depth: number }[] = [];
  for (const node of nodes) {
    out.push({ key: node.key, label: node.label, depth });
    if (isFolder(node)) out.push(...sidebarToggleRows(node.children, depth + 1));
  }
  return out;
}

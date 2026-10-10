import type { To } from "react-router-dom";
import { normalizeTabPath } from "./tabPaths";
import { workspaceTabKey } from "./workspaceTab";

/**
 * Visited sub-pages of one workspace section stay mounted so form fields,
 * grid edits, toggles, and each page's scroll position survive a sub-tab
 * switch. Leaving the section, or closing its workspace tab, is the only
 * time unsaved edits are discarded — and only after a warning.
 */

export interface KeptPage {
  pathname: string;
  search: string;
  hash: string;
}

export const LEAVE_SECTION_MESSAGE = "This section has unsaved changes. Leave without saving?";
export const CLOSE_TAB_MESSAGE = "Close this tab? Unsaved changes in this section will be lost.";

const SAVE_LABEL = /^(save|save changes|save settings|save draft|apply|update)$/i;
const SAVE_PHRASE = /^save\b/i;

let skipNextLeave = false;
let committedPath = "";

/** The next section change was already confirmed (tab close or tab switch). */
export function skipNextLeaveWarning() {
  skipNextLeave = true;
}

export function takeSkipLeaveWarning(): boolean {
  const skip = skipNextLeave;
  skipNextLeave = false;
  return skip;
}

/** The sub-page the user is actually on. A cancelled leave never commits the other section. */
export function commitSectionPath(path: string) {
  committedPath = normalizeTabPath(path);
}

export function isSectionPathCommitted(path: string): boolean {
  if (!committedPath) return true;
  return normalizeTabPath(path) === committedPath;
}

export function draftKey(path: string, subtab?: string): string {
  const base = normalizeTabPath(path.split("#")[0] ?? path);
  return subtab ? `${base}#${subtab}` : base;
}

export function sectionHasUnsaved(paths: Record<string, boolean>, path: string): boolean {
  return dirtyKeysInSection(paths, path).length > 0;
}

export function dirtyKeysInSection(paths: Record<string, boolean>, path: string): string[] {
  const section = workspaceTabKey(path);
  return Object.keys(paths).filter((entry) => {
    if (!paths[entry]) return false;
    const pathPart = entry.split("#")[0] ?? entry;
    return workspaceTabKey(pathPart) === section;
  });
}

/** True when this sub-route, or one of its in-page tabs, has edits that are not saved. */
export function subrouteHasUnsaved(paths: Record<string, boolean>, path: string): boolean {
  const base = normalizeTabPath(path);
  return Object.entries(paths).some(([entry, on]) => {
    if (!on) return false;
    return normalizeTabPath(entry.split("#")[0] ?? entry) === base;
  });
}

export function subtabHasUnsaved(paths: Record<string, boolean>, path: string, subtab: string): boolean {
  return Boolean(paths[draftKey(path, subtab)]);
}

/** Switching sub-pages of the same section never warns. Leaving a dirty section does. */
export function shouldWarnOnNavigate(paths: Record<string, boolean>, from: string, to: string): boolean {
  if (workspaceTabKey(from) === workspaceTabKey(to)) return false;
  return sectionHasUnsaved(paths, from);
}

export function shouldWarnOnClose(paths: Record<string, boolean>, tabPath: string): boolean {
  return sectionHasUnsaved(paths, tabPath);
}

export function isSaveControl(label: string, type?: string): boolean {
  if (type === "submit") return true;
  const text = label.replace(/\s+/g, " ").trim();
  if (SAVE_LABEL.test(text)) return true;
  // "Save assignments" commits the page. "Save view" only bookmarks a list filter.
  if (SAVE_PHRASE.test(text) && !/^save view$/i.test(text) && !/^save as\b/i.test(text)) return true;
  return false;
}

export function isEditField(tag: string, type?: string, role?: string): boolean {
  if (role === "switch") return true;
  const name = tag.toLowerCase();
  if (name === "textarea" || name === "select") return true;
  if (name !== "input") return false;
  const kind = (type ?? "text").toLowerCase();
  return kind !== "search" && kind !== "button" && kind !== "submit" && kind !== "reset" && kind !== "hidden";
}

export function hrefFromTo(basePath: string, baseSearch: string, to: To): string {
  if (typeof to === "string") {
    const base = `http://accuqual.local${basePath || "/"}${baseSearch || ""}`;
    const url = new URL(to, base);
    return `${url.pathname}${url.search}${url.hash}`;
  }
  const pathname = to.pathname;
  const resolved = pathname
    ? hrefFromTo(basePath, baseSearch, pathname)
    : `${basePath || "/"}${baseSearch || ""}`;
  const url = new URL(resolved, "http://accuqual.local");
  if (to.search != null) url.search = to.search;
  if (to.hash != null) url.hash = to.hash;
  return `${url.pathname}${url.search}${url.hash}`;
}

export interface VisitPlan {
  action: "apply" | "ask";
  kept: KeptPage[];
  active: string;
}

function page(pathname: string, search: string, hash: string): KeptPage {
  return { pathname: normalizeTabPath(pathname), search, hash };
}

function withCurrent(kept: KeptPage[], next: KeptPage): KeptPage[] {
  const section = workspaceTabKey(next.pathname);
  const same = kept.filter((entry) => workspaceTabKey(entry.pathname) === section);
  const index = same.findIndex((entry) => entry.pathname === next.pathname);
  if (index < 0) return [...same, next];
  const copy = same.slice();
  copy[index] = next;
  return copy;
}

/**
 * Decide which sub-pages stay mounted. Same-section navigation keeps every
 * visited sub-page. A different section drops the previous ones, and asks
 * first when any of them have unsaved edits.
 */
export function planSectionVisit(input: {
  kept: KeptPage[];
  from: string;
  toPath: string;
  toSearch: string;
  toHash: string;
  dirty: Record<string, boolean>;
  confirmedLeave: boolean;
}): VisitPlan {
  const next = page(input.toPath, input.toSearch, input.toHash);
  const from = normalizeTabPath(input.from);
  if (!from || from === next.pathname) {
    return { action: "apply", kept: withCurrent(input.kept, next), active: next.pathname };
  }
  if (workspaceTabKey(from) === workspaceTabKey(next.pathname)) {
    return { action: "apply", kept: withCurrent(input.kept, next), active: next.pathname };
  }
  if (sectionHasUnsaved(input.dirty, from) && !input.confirmedLeave) {
    return { action: "ask", kept: input.kept, active: from };
  }
  return { action: "apply", kept: [next], active: next.pathname };
}

export function sameKept(left: KeptPage[], right: KeptPage[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return other != null && entry.pathname === other.pathname && entry.search === other.search && entry.hash === other.hash;
  });
}

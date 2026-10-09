export type NavigationLayout = "sidebar" | "top";

/**
 * Unset, blank, or anything other than "top" stays on the sidebar.
 * The Monday demo keeps the left menu until an admin saves Top bar.
 */
export function navigationLayoutFromProfile(profile: { navigationLayout?: unknown } | null | undefined): NavigationLayout {
  return profile?.navigationLayout === "top" ? "top" : "sidebar";
}

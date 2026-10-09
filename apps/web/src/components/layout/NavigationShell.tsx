import { TopNav } from "./TopNav";

/**
 * The app's top-level navigation. TopNav owns the header and either the
 * sidebar or the top menu, following the company Navigation layout setting.
 */
export function NavigationShell() {
  return <TopNav />;
}

import { TopNav } from "./TopNav";

/**
 * The app's top-level navigation: a fixed top bar (brand, search, plant,
 * theme, notifications, account) and a sidebar of the modules this person
 * can open. TopNav owns both.
 */
export function NavigationShell() {
  return <TopNav />;
}

import { TopNav } from "./TopNav";
import { Header } from "./Header";

/**
 * The app's top-level navigation shell: the existing mega-menu top bar
 * (TopNav — now also carrying the Home button and the placeholder Modules
 * dropdown) plus the existing profile menu (Header — email, role badge,
 * Logout), composed as one unit. AppLayout.tsx renders this in the exact
 * spot it used to render <TopNav/><Header/> directly, so every existing
 * protected route keeps getting the identical chrome, unchanged — this is
 * a composition wrapper, not a rewrite of either piece.
 */
export function NavigationShell() {
  return (
    <>
      <TopNav />
      <Header />
    </>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Command, Search } from "lucide-react";
import { GlobalSearchResults } from "./GlobalSearchResults";
import { NotificationDropdown } from "./NotificationDropdown";
import { WhatsNewDropdown } from "./WhatsNewDropdown";
import { SiteSwitcher } from "./SiteSwitcher";
import { UserMenu } from "./UserMenu";
import { ScanToFindDialog } from "./ScanToFindDialog";
import { ThemeToggleButton } from "./ThemeToggleButton";
import { BackButton } from "./BackButton";
import { flattenSidebarLinks, sidebarLinkOpensNewTab } from "./sidebarStructure";
import { useArrangedSidebar } from "./sidebarOrganize";
import { TopMenuBar } from "./TopMenuBar";
import { useSiteNavigation } from "../../hooks/useSiteNavigation";
import { DmaLogo, PRODUCT_LINE, ProductLine } from "../brand/DmaLogo";
import { isEditableFocusTarget } from "../../lib/editableFocus";

/**
 * Header and the menu bar. The left sidebar is gone: the same arranged
 * menu (company order plus this person's saved shortcuts) is the top bar.
 */
export function TopNav() {
  const [query, setQuery] = useState("");
  const { folders, catalog } = useArrangedSidebar();
  const menuNodes = useSiteNavigation(folders);
  const chromeRef = useRef<HTMLDivElement>(null);
  const links = flattenSidebarLinks(menuNodes);
  const needle = query.trim().toLowerCase();
  const searchResults = needle ? links.filter((leaf) => `${leaf.label} ${leaf.key}`.toLowerCase().includes(needle)) : [];

  useLayoutEffect(() => {
    document.body.classList.add("nav-top");
    document.body.classList.remove("side-collapsed", "side-open");
    const apply = () => {
      const height = chromeRef.current?.offsetHeight ?? 62;
      document.documentElement.style.setProperty("--side-w", "0px");
      document.documentElement.style.setProperty("--top-h", `${height}px`);
      document.documentElement.style.removeProperty("--side-drawer");
    };
    apply();
    const observer = new ResizeObserver(apply);
    if (chromeRef.current) observer.observe(chromeRef.current);
    window.addEventListener("resize", apply);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
      document.body.classList.remove("nav-top", "side-collapsed", "side-open");
      document.documentElement.style.removeProperty("--side-w");
      document.documentElement.style.removeProperty("--top-h");
      document.documentElement.style.removeProperty("--side-drawer");
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setQuery("");
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isEditableFocusTarget(e.target)) return;
        e.preventDefault();
        document.getElementById("gsearch")?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <a className="aq-skip" href="#main-content">
        Skip to content
      </a>
      <div className="aq-chrome" ref={chromeRef}>
        <header className="aq-topbar">
          <Link to="/" className="aq-brand" aria-label={PRODUCT_LINE}>
            <DmaLogo height={34} />
            <ProductLine />
          </Link>

          <div className="aq-search" role="search">
            <Search size={16} />
            <input
              id="gsearch"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search NCRs, documents, gages…"
              aria-label="Global search"
              autoComplete="off"
            />
            <kbd className="aq-hide-sm">/</kbd>
            {query.trim() && (
              <div className="aq-search-pop" role="listbox">
                {searchResults.map((r) =>
                  sidebarLinkOpensNewTab(r) ? (
                    <a key={r.key} href={r.path} target="_blank" rel="noopener noreferrer" onClick={() => setQuery("")} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-primary/10">
                      <r.icon size={16} />
                      <span>{r.label}</span>
                    </a>
                  ) : (
                    <Link key={r.key} to={r.path} onClick={() => setQuery("")} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-primary/10">
                      <r.icon size={16} />
                      <span>{r.label}</span>
                    </Link>
                  ),
                )}
                <GlobalSearchResults query={query} onSelect={() => setQuery("")} />
              </div>
            )}
          </div>

          <div className="aq-top-tools">
            <BackButton />
            <span className="aq-site-caption">Site</span>
            <SiteSwitcher />
            <button type="button" className="aq-icon-btn aq-only-sm" aria-label="Search" title="Search" onClick={() => window.dispatchEvent(new Event("accuqual-open-palette"))}>
              <Search size={16} />
            </button>
            <button type="button" className="aq-icon-btn aq-hide-sm" aria-label="Open command palette (Ctrl+K)" title="Command palette (Ctrl/⌘+K)" onClick={() => window.dispatchEvent(new Event("accuqual-open-palette"))}>
              <Command size={16} />
            </button>
            <ScanToFindDialog />
            <ThemeToggleButton />
            <NotificationDropdown />
            <WhatsNewDropdown />
            <UserMenu />
          </div>
        </header>
        <TopMenuBar nodes={menuNodes} catalog={catalog} />
      </div>
    </>
  );
}

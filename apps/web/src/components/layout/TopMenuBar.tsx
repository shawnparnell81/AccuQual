import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { TruncatedName } from "../shared/TruncatedName";
import { SidebarShortcutsButton } from "./sidebarShortcutsPanel";
import {
  isFolder,
  pathMatches,
  PERMANENT_SIDEBAR_LINKS,
  sidebarLinkOpensNewTab,
  type SidebarFolder,
  type SidebarLink,
  type SidebarNode,
} from "./sidebarStructure";
import { placeMenuFlyout } from "../../lib/menuFlyout";
import { collapseSingleItemMenus, folderMenuEntries } from "../../lib/navigationLayout";
import { prefetchRoute } from "../../routes/pages";

function focusItem(item: HTMLElement | undefined) {
  item?.focus({ preventScroll: true });
}

function siblingItems(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>(":scope > li > [role='menuitem'], :scope > li > .aq-topnav-branch > [role='menuitem']"));
}

function moveInList(event: ReactKeyboardEvent<HTMLElement>) {
  const list = event.currentTarget;
  const items = siblingItems(list);
  const index = items.indexOf(event.target as HTMLElement);
  if (index < 0) return false;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    event.stopPropagation();
    focusItem(items[(index + 1) % items.length]);
    return true;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation();
    focusItem(items[(index - 1 + items.length) % items.length]);
    return true;
  }
  if (event.key === "Home") {
    event.preventDefault();
    event.stopPropagation();
    focusItem(items[0]);
    return true;
  }
  if (event.key === "End") {
    event.preventDefault();
    event.stopPropagation();
    focusItem(items[items.length - 1]);
    return true;
  }
  return false;
}

function MenuLink({ node, onPick }: { node: SidebarLink; onPick: () => void }) {
  const label = node.label;
  const className = "aq-topnav-item";
  const body = <TruncatedName name={label} className="aq-topnav-label" />;
  if (sidebarLinkOpensNewTab(node)) {
    return (
      <a role="menuitem" href={node.path} target="_blank" rel="noopener noreferrer" title={`${label} (opens in a new tab)`} className={className} onClick={onPick}>
        {body}
      </a>
    );
  }
  return (
    <NavLink
      role="menuitem"
      to={node.path}
      title={label}
      className={className}
      onClick={onPick}
      onMouseEnter={() => prefetchRoute(node.path)}
      onFocus={() => prefetchRoute(node.path)}
    >
      {body}
    </NavLink>
  );
}

function MenuBranch({ node, onPick }: { node: SidebarFolder; onPick: () => void }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const entries = folderMenuEntries(node);

  function close() {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className="aq-topnav-branch" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        ref={buttonRef}
        type="button"
        role="menuitem"
        id={panelId}
        className="aq-topnav-item"
        title={node.label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${panelId}-menu` : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }
        }}
      >
        <TruncatedName name={node.label} className="aq-topnav-label" />
        <ChevronRight size={14} aria-hidden />
      </button>
      {open && entries.length > 0 && (
        <MenuList
          id={`${panelId}-menu`}
          labelledBy={panelId}
          nodes={entries}
          flyout
          anchorRef={buttonRef}
          onPick={onPick}
          onClose={close}
        />
      )}
    </div>
  );
}

function MenuList({
  id,
  labelledBy,
  nodes,
  flyout = false,
  anchorRef,
  onPick,
  onClose,
}: {
  id: string;
  labelledBy: string;
  nodes: SidebarNode[];
  flyout?: boolean;
  anchorRef?: RefObject<HTMLElement | null>;
  onPick: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    if (flyout) {
      const anchor = anchorRef?.current;
      if (!anchor) return;
      const placed = placeMenuFlyout(anchor.getBoundingClientRect(), { width: list.offsetWidth, height: list.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
      list.style.top = `${placed.top}px`;
      list.style.left = `${placed.left}px`;
      list.dataset.placed = "1";
      return;
    }
    const rect = list.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
      list.style.left = "auto";
      list.style.right = "0";
    }
    if (rect.bottom > window.innerHeight - 8) list.style.maxHeight = `${Math.max(120, window.innerHeight - rect.top - 8)}px`;
  }, [anchorRef, flyout, nodes]);
  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    focusItem(siblingItems(list)[0]);
  }, [flyout]);

  return (
    <ul
      ref={ref}
      id={id}
      role="menu"
      aria-labelledby={labelledBy}
      className={clsx("aq-topnav-panel", flyout && "aq-topnav-fly")}
      onKeyDown={(event) => {
        if (moveInList(event)) return;
        if (event.key === "Escape" || event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {nodes.map((node) => (
        <li key={node.key} role="none">
          {isFolder(node) ? <MenuBranch node={node} onPick={onPick} /> : <MenuLink node={node} onPick={onPick} />}
        </li>
      ))}
    </ul>
  );
}

function RootItem({
  node,
  open,
  onOpen,
  onClose,
  tabIndex,
}: {
  node: SidebarNode;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  tabIndex: number;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const location = useLocation();

  if (!isFolder(node)) {
    const active = pathMatches(location.pathname, node.path);
    if (sidebarLinkOpensNewTab(node)) {
      return (
        <a role="menuitem" href={node.path} target="_blank" rel="noopener noreferrer" title={`${node.label} (opens in a new tab)`} className="aq-topnav-root" tabIndex={tabIndex}>
          {node.label}
        </a>
      );
    }
    return (
      <NavLink
        role="menuitem"
        to={node.path}
        title={node.label}
        tabIndex={tabIndex}
        className={clsx("aq-topnav-root", active && "active")}
        onMouseEnter={() => prefetchRoute(node.path)}
        onFocus={() => prefetchRoute(node.path)}
      >
        {node.label}
      </NavLink>
    );
  }

  const entries = folderMenuEntries(node);
  const active = node.path ? pathMatches(location.pathname, node.path) : false;
  return (
    <div className="aq-topnav-root-wrap" onMouseEnter={onOpen} onMouseLeave={onClose}>
      <button
        ref={buttonRef}
        type="button"
        role="menuitem"
        id={panelId}
        className={clsx("aq-topnav-root", (open || active) && "active")}
        title={node.label}
        tabIndex={tabIndex}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${panelId}-menu` : undefined}
        onClick={() => (open ? onClose() : onOpen())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
      >
        <span className="aq-topnav-root-label">{node.label}</span>
        <ChevronDown size={14} aria-hidden className={clsx("aq-topnav-caret", open && "open")} />
      </button>
      {open && entries.length > 0 && (
        <MenuList id={`${panelId}-menu`} labelledBy={panelId} nodes={entries} onPick={onClose} onClose={() => { onClose(); buttonRef.current?.focus({ preventScroll: true }); }} />
      )}
    </div>
  );
}

/** The arranged menu as dropdowns. Settings and Customize menu stay on the bar. */
export function TopMenuBar({ nodes, catalog }: { nodes: SidebarNode[]; catalog: SidebarNode[] }) {
  const location = useLocation();
  const barRef = useRef<HTMLDivElement>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [rootIndex, setRootIndex] = useState(0);
  const menu = nodes.map(collapseSingleItemMenus);

  useEffect(() => {
    setOpenKey(null);
  }, [location.pathname]);

  function onBarKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest(".aq-topnav-panel")) return;
    const items = Array.from(
      barRef.current?.querySelectorAll<HTMLElement>(":scope > [role='menuitem'], :scope > .aq-topnav-root-wrap > [role='menuitem'], :scope > .aq-topnav-customize [role='menuitem']") ?? [],
    );
    const index = items.indexOf(target);
    if (index < 0) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const next = (index + 1) % items.length;
      setRootIndex(next);
      if (openKey) {
        const node = menu[next];
        setOpenKey(node && isFolder(node) ? node.key : null);
      }
      focusItem(items[next]);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      const next = (index - 1 + items.length) % items.length;
      setRootIndex(next);
      if (openKey) {
        const node = menu[next];
        setOpenKey(node && isFolder(node) ? node.key : null);
      }
      focusItem(items[next]);
    } else if (event.key === "Escape") {
      setOpenKey(null);
    } else if (event.key === "Home") {
      event.preventDefault();
      setRootIndex(0);
      focusItem(items[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      setRootIndex(items.length - 1);
      focusItem(items[items.length - 1]);
    }
  }

  return (
    <div className="aq-topnav-wrap">
      <div ref={barRef} className="aq-topnav" role="menubar" aria-label="Main navigation" onKeyDown={onBarKeyDown}>
        {menu.map((node, index) => (
          <RootItem
            key={node.key}
            node={node}
            open={openKey === node.key}
            tabIndex={index === rootIndex ? 0 : -1}
            onOpen={() => {
              setOpenKey(node.key);
              setRootIndex(index);
            }}
            onClose={() => setOpenKey((current) => (current === node.key ? null : current))}
          />
        ))}
        {PERMANENT_SIDEBAR_LINKS.map((link) => (
          <NavLink
            key={link.key}
            role="menuitem"
            to={link.path}
            title={link.label}
            tabIndex={menu.length === rootIndex ? 0 : -1}
            className={({ isActive }) => clsx("aq-topnav-root", isActive && "active")}
            onFocus={() => setRootIndex(menu.length)}
            onMouseEnter={() => {
              setOpenKey(null);
              prefetchRoute(link.path);
            }}
          >
            {link.label}
          </NavLink>
        ))}
        <div className="aq-topnav-customize" onMouseEnter={() => setOpenKey(null)}>
          <SidebarShortcutsButton catalog={catalog} placement="menu" />
        </div>
      </div>
    </div>
  );
}

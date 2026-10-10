import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type MutableRefObject, type RefObject } from "react";
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
import {
  keepSubmenuWhileTraveling,
  MENU_HOVER_INTENT_MS,
  movingTowardSubmenu,
  type HoverPoint,
} from "../../lib/menuHoverIntent";
import { collapseSingleItemMenus, folderMenuEntries } from "../../lib/navigationLayout";
import { prefetchRoute } from "../../routes/pages";

function focusItem(item: HTMLElement | undefined) {
  item?.focus({ preventScroll: true });
}

function siblingItems(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>(":scope > li > [role='menuitem'], :scope > li > .aq-topnav-branch > [role='menuitem']"));
}

function pointOf(event: { clientX: number; clientY: number }): HoverPoint {
  return { x: event.clientX, y: event.clientY };
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

interface SubmenuIntent {
  origin: HoverPoint;
  element: HTMLElement | null;
  side: "left" | "right";
}

interface IntentApi {
  register(slot: MutableRefObject<SubmenuIntent | null>): () => void;
  movingToward(point: HoverPoint): boolean;
}

const IntentContext = createContext<IntentApi | null>(null);

function useIntentApi(): IntentApi {
  return useContext(IntentContext) ?? { register: () => () => {}, movingToward: () => false };
}

function MenuLink({ node, onPick, onHover }: { node: SidebarLink; onPick: () => void; onHover: (point: HoverPoint) => void }) {
  const label = node.label;
  const className = "aq-topnav-item";
  const body = <TruncatedName name={label} className="aq-topnav-label" />;
  if (sidebarLinkOpensNewTab(node)) {
    return (
      <a
        role="menuitem"
        href={node.path}
        target="_blank"
        rel="noopener noreferrer"
        title={`${label} (opens in a new tab)`}
        className={className}
        onMouseEnter={(event) => onHover(pointOf(event))}
        onClick={onPick}
      >
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
      onMouseEnter={(event) => {
        onHover(pointOf(event));
        prefetchRoute(node.path);
      }}
      onFocus={() => prefetchRoute(node.path)}
    >
      {body}
    </NavLink>
  );
}

function MenuBranch({
  node,
  open,
  onHover,
  onTrack,
  onOpenImmediate,
  onClose,
  onPick,
  onPlaced,
  onRetain,
}: {
  node: SidebarFolder;
  open: boolean;
  onHover: (point: HoverPoint) => void;
  onTrack: (point: HoverPoint) => void;
  onOpenImmediate: () => void;
  onClose: () => void;
  onPick: () => void;
  onPlaced: (element: HTMLElement, side: "left" | "right") => void;
  onRetain: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const entries = folderMenuEntries(node);

  function focusSubmenu() {
    window.requestAnimationFrame(() => {
      const menu = document.getElementById(`${panelId}-menu`);
      if (!menu) return;
      focusItem(siblingItems(menu)[0]);
    });
  }

  function close() {
    onClose();
    buttonRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className="aq-topnav-branch">
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
        onMouseEnter={(event) => onHover(pointOf(event))}
        onMouseMove={(event) => onTrack(pointOf(event))}
        onClick={(event) => {
          event.preventDefault();
          onOpenImmediate();
          focusSubmenu();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            onOpenImmediate();
            focusSubmenu();
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
          onPlaced={onPlaced}
          onRetain={onRetain}
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
  onPlaced,
  onRetain,
}: {
  id: string;
  labelledBy: string;
  nodes: SidebarNode[];
  flyout?: boolean;
  anchorRef?: RefObject<HTMLElement | null>;
  onPick: () => void;
  onClose: () => void;
  onPlaced?: (element: HTMLElement, side: "left" | "right") => void;
  /** Called when the pointer enters this panel, including from a gap outside its parent list. */
  onRetain?: () => void;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const intentApi = useIntentApi();
  const intent = useRef<SubmenuIntent | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openKeyRef = useRef<string | null>(null);
  const lastPoint = useRef<HoverPoint>({ x: Number.NaN, y: Number.NaN });
  const pendingKey = useRef<string | null>(null);
  const switchTimer = useRef<number | null>(null);
  const onPlacedRef = useRef(onPlaced);
  onPlacedRef.current = onPlaced;

  useEffect(() => intentApi.register(intent), [intentApi]);

  function commitOpen(key: string | null) {
    openKeyRef.current = key;
    intent.current = null;
    setOpenKey(key);
  }

  function clearSwitch() {
    if (switchTimer.current != null) window.clearTimeout(switchTimer.current);
    switchTimer.current = null;
  }

  useEffect(() => () => clearSwitch(), []);

  function armSwitch(key: string | null) {
    pendingKey.current = key;
    if (switchTimer.current != null) return;
    const start = lastPoint.current;
    switchTimer.current = window.setTimeout(() => {
      switchTimer.current = null;
      const next = pendingKey.current;
      const moved = Math.hypot(lastPoint.current.x - start.x, lastPoint.current.y - start.y);
      if (keepSubmenuWhileTraveling(intentApi.movingToward(lastPoint.current), moved)) {
        armSwitch(next);
        return;
      }
      commitOpen(next);
    }, MENU_HOVER_INTENT_MS);
  }

  function requestOpen(key: string, point: HoverPoint) {
    lastPoint.current = point;
    if (openKeyRef.current === key) {
      clearSwitch();
      return;
    }
    if (openKeyRef.current && intentApi.movingToward(point)) {
      armSwitch(key);
      return;
    }
    clearSwitch();
    commitOpen(key);
  }

  function requestClear(point: HoverPoint) {
    lastPoint.current = point;
    if (!openKeyRef.current) return;
    if (intentApi.movingToward(point)) {
      armSwitch(null);
      return;
    }
    clearSwitch();
    commitOpen(null);
  }

  function trackRow(key: string, point: HoverPoint) {
    lastPoint.current = point;
    if (openKeyRef.current === key && intent.current) intent.current.origin = point;
  }

  function openImmediate(key: string) {
    clearSwitch();
    commitOpen(key);
  }

  function rememberSubmenu(key: string, element: HTMLElement, side: "left" | "right") {
    if (openKeyRef.current !== key) return;
    const origin = Number.isFinite(lastPoint.current.x) ? lastPoint.current : { x: element.getBoundingClientRect().left, y: element.getBoundingClientRect().top };
    intent.current = { origin, element, side };
  }

  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    if (flyout) {
      const anchor = anchorRef?.current;
      if (!anchor) return;
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const anchorRect = anchor.getBoundingClientRect();
      let placed = placeMenuFlyout(anchorRect, { width: list.offsetWidth, height: list.offsetHeight }, viewport);
      list.dataset.side = placed.side;
      placed = placeMenuFlyout(anchorRect, { width: list.offsetWidth, height: list.offsetHeight }, viewport);
      if (list.dataset.side !== placed.side) {
        list.dataset.side = placed.side;
        placed = placeMenuFlyout(anchorRect, { width: list.offsetWidth, height: list.offsetHeight }, viewport);
      }
      list.style.top = `${placed.top}px`;
      list.style.left = `${placed.left}px`;
      list.dataset.side = placed.side;
      list.dataset.placed = "1";
      onPlacedRef.current?.(list, placed.side);
      return;
    }
    const rect = list.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
      list.style.left = "auto";
      list.style.right = "0";
    }
    if (rect.bottom > window.innerHeight - 8) list.style.maxHeight = `${Math.max(120, window.innerHeight - rect.top - 8)}px`;
  }, [anchorRef, flyout, nodes, openKey]);

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
      onMouseEnter={() => {
        clearSwitch();
        onRetain?.();
      }}
      onMouseMove={(event) => {
        lastPoint.current = pointOf(event);
      }}
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
          {isFolder(node) ? (
            <MenuBranch
              node={node}
              open={openKey === node.key}
              onHover={(hoverPoint) => requestOpen(node.key, hoverPoint)}
              onTrack={(hoverPoint) => trackRow(node.key, hoverPoint)}
              onOpenImmediate={() => openImmediate(node.key)}
              onClose={() => {
                clearSwitch();
                if (openKeyRef.current === node.key) commitOpen(null);
              }}
              onPick={onPick}
              onPlaced={(element, side) => rememberSubmenu(node.key, element, side)}
              onRetain={clearSwitch}
            />
          ) : (
            <MenuLink node={node} onPick={onPick} onHover={requestClear} />
          )}
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const location = useLocation();
  const slots = useRef(new Set<MutableRefObject<SubmenuIntent | null>>());
  const intentApi = useMemo<IntentApi>(() => ({
    register(slot) {
      slots.current.add(slot);
      return () => {
        slots.current.delete(slot);
      };
    },
    movingToward(point) {
      for (const slot of slots.current) {
        const current = slot.current;
        if (!current?.element) continue;
        const rect = current.element.getBoundingClientRect();
        if (movingTowardSubmenu(point, current.origin, rect, current.side)) return true;
      }
      return false;
    },
  }), []);
  const closeTimer = useRef<number | null>(null);
  const watching = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const openRef = useRef(open);
  openRef.current = open;
  const considerRef = useRef<(point: HoverPoint) => void>(() => {});
  const listenerRef = useRef<(event: PointerEvent) => void>((event: PointerEvent) => {
    considerRef.current({ x: event.clientX, y: event.clientY });
  });

  function clearCloseTimer() {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function stopWatch() {
    clearCloseTimer();
    if (watching.current) {
      window.removeEventListener("pointermove", listenerRef.current);
      watching.current = false;
    }
  }

  function pointerInside(point: HoverPoint): boolean {
    const hit = document.elementFromPoint(point.x, point.y);
    return !!hit && !!wrapRef.current?.contains(hit);
  }

  considerRef.current = (point: HoverPoint) => {
    if (!openRef.current) {
      stopWatch();
      return;
    }
    if (pointerInside(point)) {
      stopWatch();
      return;
    }
    if (intentApi.movingToward(point)) {
      clearCloseTimer();
      return;
    }
    if (closeTimer.current == null) {
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null;
        stopWatch();
        onCloseRef.current();
      }, MENU_HOVER_INTENT_MS);
    }
  };

  useEffect(() => () => stopWatch(), []);
  useEffect(() => {
    if (!open) stopWatch();
  }, [open]);

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

  function onMouseLeave(event: ReactMouseEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && wrapRef.current?.contains(next)) return;
    if (!watching.current) {
      watching.current = true;
      window.addEventListener("pointermove", listenerRef.current);
    }
    considerRef.current(pointOf(event));
  }

  return (
    <IntentContext.Provider value={intentApi}>
      <div ref={wrapRef} className="aq-topnav-root-wrap" onMouseEnter={() => { stopWatch(); onOpen(); }} onMouseLeave={onMouseLeave}>
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
    </IntentContext.Provider>
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

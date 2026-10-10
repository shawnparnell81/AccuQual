import { useEffect } from "react";
import { isEditableFocusTarget } from "../lib/editableFocus";

/**
 * Cmd/Ctrl+K, app-wide — the first global keyboard shortcut in this app
 * (see CommandPalette.tsx). Deliberately inert while focus is inside a
 * text field: a Quality Manager typing "K" into an NCR title must never
 * have that keystroke hijacked, and `preventDefault` only runs once we've
 * already decided to actually open the palette, so a browser's own
 * Ctrl+K (address bar search in some browsers) is left alone everywhere
 * else on the page.
 */
export function useGlobalHotkey(onTrigger: () => void) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      if (isEditableFocusTarget(e.target)) return;
      e.preventDefault();
      onTrigger();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onTrigger]);
}

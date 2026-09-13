import { useNavigate } from "react-router-dom";
import { useTabStore } from "../store/useTabStore";

/**
 * The one real "explicit open in new tab" entry point (global search
 * results today). Opens/focuses a tab for the given path and navigates
 * there — never window.open, so it can never escape into a real browser
 * window per the tab system's own rules.
 */
export function useOpenTab() {
  const navigate = useNavigate();
  const openTab = useTabStore((s) => s.openTab);

  return (tab: { path: string; title: string; icon: string }) => {
    openTab(tab);
    navigate(tab.path);
  };
}

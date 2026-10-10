import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { ToastProvider } from "./components/shared/ToastProvider";
import { ConfirmProvider } from "./components/shared/ConfirmDialog";
import { UnsavedChangesProvider } from "./components/layout/unsavedChanges";
import "@fontsource/roboto/latin-400.css";
import "@fontsource/roboto/latin-500.css";
import "@fontsource/roboto/latin-700.css";
import "@fontsource/roboto/latin-800.css";
import "./styles/globals.css";
import { applyStoredThemeVars, getStoredMode, getStoredScheme } from "./lib/theme";
import { initErrorTracking } from "./lib/errorTracking";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import { isMarketingHost, marketingDocumentTarget } from "./lib/publicSite";
import { registerSW } from "virtual:pwa-register";

const marketingTarget = marketingDocumentTarget(window.location.hostname, window.location.pathname, window.location.search, window.location.hash);
if (marketingTarget) {
  window.location.replace(marketingTarget);
}
// The public site never mounts the app, so a session refresh cannot run there.

initErrorTracking();

// Stamps the last-known mode before React even mounts, so the very first
// frame matches the previous session instead of flashing dark-then-light
// (or vice versa) once useThemeSync's real data loads. AppLayout.tsx's
// useThemeSync takes over from here with the company/user's real theme.
const bootScheme = getStoredScheme() ?? "classic";
document.documentElement.setAttribute("data-scheme", bootScheme);
document.documentElement.setAttribute("data-theme", getStoredMode() ?? "dark");
if (bootScheme !== "dma") applyStoredThemeVars();

if (!isMarketingHost(window.location.hostname)) {
  registerSW({ immediate: true });

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 30_000 },
    },
  });

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <ToastProvider>
              <ConfirmProvider>
                <UnsavedChangesProvider>
                  <App />
                </UnsavedChangesProvider>
              </ConfirmProvider>
            </ToastProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

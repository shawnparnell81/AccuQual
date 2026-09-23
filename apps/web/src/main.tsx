import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { ToastProvider } from "./components/shared/ToastProvider";
import "./styles/globals.css";
import { applyStoredThemeVars, getStoredMode } from "./lib/theme";
import { initErrorTracking } from "./lib/errorTracking";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";

initErrorTracking();

// Stamps the last-known mode before React even mounts, so the very first
// frame matches the previous session instead of flashing dark-then-light
// (or vice versa) once useThemeSync's real data loads. AppLayout.tsx's
// useThemeSync takes over from here with the tenant/user's real theme.
document.documentElement.setAttribute("data-theme", getStoredMode() ?? "dark");
applyStoredThemeVars();

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
            <App />
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "../../lib/errorTracking";

interface State {
  error: Error | null;
}

/**
 * Catches a crash while drawing the app. Without one, a single render error leaves the user on a blank screen with no
 * way forward. This shows a plain message with a reload button, and reports the error when tracking is on.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught render error", error, info.componentStack);
    reportError(error, { componentStack: info.componentStack });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">This page hit an unexpected error. Your saved work is safe. Reloading usually fixes it; if it keeps happening, tell your administrator what you were doing.</p>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Reload
          </button>
        </div>
      </div>
    );
  }
}

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
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

/**
 * Catches a crash in one page and leaves the sidebar in place.
 * The boundary around the whole app still covers a crash in the shell itself.
 * Give it key={pathname} so the next page starts clean.
 */
export class RouteErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught page error", error, info.componentStack);
    reportError(error, { componentStack: info.componentStack });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-3 rounded-lg border border-border bg-card p-6" data-testid="route-error">
        <h1 className="text-xl font-semibold">This page couldn't be shown</h1>
        <p className="text-sm text-muted-foreground">Something on this page failed to draw. The rest of AccuQual is still open. Try the page again, or go back to Home.</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => this.setState({ error: null })} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Try again
          </button>
          <Link to="/home" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
            Home
          </Link>
        </div>
      </div>
    );
  }
}

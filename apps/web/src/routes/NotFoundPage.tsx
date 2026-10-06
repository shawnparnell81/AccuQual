import { Link } from "react-router-dom";

/**
 * Shown inside the app shell when the address matches no page.
 * A missing route used to match nothing at all, so the shell never mounted
 * and the window was only the page background.
 */
export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-3 rounded-lg border border-border bg-card p-6" data-testid="not-found">
      <h1 className="text-xl font-semibold">This page isn't in AccuQual</h1>
      <p className="text-sm text-muted-foreground">That address doesn't match a page. Use the sidebar, or go back to Home.</p>
      <Link to="/home" className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
        Home
      </Link>
    </div>
  );
}

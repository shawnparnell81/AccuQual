import { Link } from "react-router-dom";

/** A bookmark to a module that is outside Quality and Engineering. Stored rows are left in the database. */
export function RetiredModulePage({ name }: { name: string }) {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-border bg-card p-6">
      <h1 className="text-2xl font-semibold">{name} is not in this QMS</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        AccuQual here covers Quality and Engineering. This screen is no longer in the menu. Anything already saved stays in the database, and a quality record that still points at a related item opens that item directly.
      </p>
      <Link to="/" className="mt-4 inline-block text-sm text-primary hover:underline">
        Back to home
      </Link>
    </div>
  );
}

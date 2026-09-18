import { useQuery } from "@tanstack/react-query";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import { apiClient } from "../../api/client";
import { AdminOnlyGuard } from "../../components/shared/AdminOnlyGuard";

function useOpenApiSpec() {
  return useQuery({
    queryKey: ["admin-api-docs"],
    queryFn: async () => (await apiClient.get("/admin/api-docs/openapi.json")).data,
  });
}

/**
 * API Availability (cheap version) — Swagger UI rendered as a React
 * component inside this already-authenticated admin page rather than a
 * server-rendered swagger-ui-express HTML page: requireAuth on the backend
 * only recognizes the Authorization header, so apiClient's existing
 * interceptor (the same one every other admin fetch on this page relies on)
 * is what actually gets this page its spec — a plain browser navigation to
 * a standalone docs route would just 401. Same interactive Swagger UI
 * either way.
 */
export function AdminApiDocsPage() {
  const { data: spec, isLoading, error } = useOpenApiSpec();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">API Reference</h1>
        <p className="text-sm text-muted-foreground">
          Generated directly from this app's own request-validation schemas — NCR, CAPA, Documents, and Training for now.
        </p>
      </div>
      <AdminOnlyGuard>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">Could not load the API spec.</p>}
        {spec && (
          <div className="overflow-hidden rounded-lg border border-border bg-white">
            <SwaggerUI spec={spec} />
          </div>
        )}
      </AdminOnlyGuard>
    </div>
  );
}

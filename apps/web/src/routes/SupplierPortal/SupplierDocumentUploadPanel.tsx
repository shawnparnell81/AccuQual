import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { TextField } from "../../components/forms/Field";
import type { SupplierDocument } from "../../api/types";

/** Ongoing document management (post-onboarding) — ISO cert renewals, updated procedures, whatever the supplier needs on file. No approval workflow, unlike onboarding — this is a library, not a gate. */
export function SupplierDocumentUploadPanel({ supplierId }: { supplierId?: number }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");

  const { data: docs = [], isLoading } = useQuery<SupplierDocument[]>({
    queryKey: ["supplier-portal/documents/list", supplierId ?? null],
    queryFn: async () => (await apiClient.get("/supplier-portal/documents/list", { params: supplierId ? { supplierId } : undefined })).data,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      body.append("name", name || file.name);
      if (category) body.append("category", category);
      if (supplierId) body.append("supplierId", String(supplierId));
      return (await apiClient.post("/supplier-portal/documents/upload", body)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-portal/documents/list"] });
      setName("");
      setCategory("");
      toast.success("Document uploaded.");
    },
    onError: async (err) => toast.error(await extractErrorMessageAsync(err, "Couldn't upload this document.")),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 rounded-lg border border-border bg-card p-4 sm:grid-cols-3">
        <TextField label="Document Name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Category (optional)" placeholder="e.g. Certification, Procedure" value={category} onChange={(e) => setCategory(e.target.value)} />
        <div className="flex items-end">
          <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!name || upload.isPending}
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {upload.isPending ? "Uploading…" : "Choose File & Upload"}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Document Library</h3>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents on file yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2">Name</th>
                <th className="pb-2">Category</th>
                <th className="pb-2">File</th>
                <th className="pb-2">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="py-1.5 font-medium">{d.name}</td>
                  <td className="py-1.5 text-muted-foreground">{d.category ?? "—"}</td>
                  <td className="py-1.5 text-muted-foreground">{d.fileName}</td>
                  <td className="py-1.5 text-muted-foreground">{new Date(d.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

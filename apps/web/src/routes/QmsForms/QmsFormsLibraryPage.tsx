import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";

interface FormTemplateLink {
  formKey: string;
  formId: string;
  title: string;
  subjectRoute: string;
  isoPath: string[];
}

/**
 * Lists the master blank templates. These are the same rows filed under
 * Document Folders > ISO Compliance, not a second copy.
 */
export function QmsFormsLibraryPage() {
  const navigate = useNavigate();
  const templates = useQuery({
    queryKey: ["form-templates"],
    queryFn: async () => (await apiClient.get<{ templates: FormTemplateLink[] }>("/document-folders/form-templates")).data.templates,
  });

  const byTopic = new Map<string, FormTemplateLink[]>();
  for (const form of templates.data ?? []) {
    const topic = form.isoPath.join(" / ") || "ISO Compliance";
    byTopic.set(topic, [...(byTopic.get(topic) ?? []), form]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">QMS Forms</h1>
        <p className="text-sm text-muted-foreground">
          Blank templates live in Document Folders under ISO Compliance. Start one here. A filled record is filed in its subject folder.
        </p>
      </div>

      {templates.isLoading && <p className="text-sm text-muted-foreground">Loading forms…</p>}
      {templates.isError && <p className="text-sm text-destructive">Couldn't load the form templates.</p>}

      {[...byTopic.entries()].map(([topic, forms]) => (
        <div key={topic} className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">{topic}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {forms.map((form) => (
              <button
                key={form.formKey}
                onClick={() => navigate(form.subjectRoute)}
                className="flex items-start justify-between gap-2 rounded-md border border-border p-3 text-left text-sm hover:bg-muted"
                data-form-key={form.formKey}
              >
                <span className="font-medium">{form.title}</span>
                <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{form.formId}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

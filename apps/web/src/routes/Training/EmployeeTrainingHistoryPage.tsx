import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { TrainingHistoryPanel } from "../../components/training/TrainingHistoryPanel";
import { AiFieldAssistant } from "../../components/shared/AiFieldAssistant";
import { useSetAssistantContext } from "../../hooks/useAssistantContext";

interface Employee {
  id: number;
  name: string | null;
  email: string;
}

/** One employee's full training record, across every course — reached from a name link in a course's assignment list (TrainingDetailPage). */
export function EmployeeTrainingHistoryPage() {
  const { userId } = useParams();
  const id = Number(userId);
  const { data: employee } = useQuery<Employee>({
    queryKey: ["user", id],
    queryFn: async () => (await apiClient.get(`/users/${id}`)).data,
  });
  const employeeLabel = employee?.name ?? employee?.email ?? `Employee #${id}`;
  // "training_employee" — one employee across every course — is distinct
  // from TrainingDetailPage's "training" context (one course, every
  // employee); see ai.assistant.ts's loadContextSummary.
  useSetAssistantContext("training_employee", id, employeeLabel);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{employeeLabel}</h1>
        <AiFieldAssistant
          module="training_employee"
          recordId={id}
          triggerLabel="AI Compliance Summary"
          buildInitialPrompt={() =>
            `Summarize training compliance for ${employeeLabel} using the assignment counts and course list provided. Call out how` +
            " urgent any overdue courses are, and suggest concrete next steps for getting them fully compliant."
          }
        />
      </div>
      <TrainingHistoryPanel userId={id} />
    </div>
  );
}

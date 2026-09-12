import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { TrainingHistoryPanel } from "../../components/training/TrainingHistoryPanel";

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

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{employee?.name ?? employee?.email ?? `Employee #${id}`}</h1>
      <TrainingHistoryPanel userId={id} />
    </div>
  );
}

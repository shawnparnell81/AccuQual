import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";

export type CalendarModule = "ncr" | "capa" | "audit" | "training" | "document" | "crar";

export interface CalendarItem {
  id: string;
  title: string;
  module: CalendarModule;
  dueDate: string | null;
  status: string;
  link: string;
  isTerminal: boolean;
}

/** GET /calendar — always "my own": everything assigned to/owned by the logged-in user, across modules. */
export function useCalendarItems() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["calendar"],
    queryFn: async () => (await apiClient.get<CalendarItem[]>("/calendar")).data,
    staleTime: 30_000,
  });
  return { items: data, isLoading };
}

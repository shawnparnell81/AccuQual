import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";

export interface FormSignResult {
  stamp: string;
  signedOn: string;
}

export interface FormSignInput {
  path: string;
  description: string;
  pin: string;
}

type FormSigner = (input: FormSignInput) => Promise<FormSignResult>;

const FormSignContext = createContext<FormSigner | null>(null);

/** Signs one field on a forms-engine document. The server writes the stamp. */
export function FormSignProvider({ formType, entityId, children }: { formType: string; entityId: number; children: ReactNode }) {
  const queryClient = useQueryClient();
  const sign = useCallback<FormSigner>(
    async (input) => {
      const response = await apiClient.post<FormSignResult>(`/forms/${formType}/${entityId}/sign`, {
        pin: input.pin,
        certified: true,
        path: input.path,
        description: input.description,
      });
      void queryClient.invalidateQueries({ queryKey: ["form-data", formType, entityId] });
      return response.data;
    },
    [formType, entityId, queryClient],
  );
  return <FormSignContext.Provider value={sign}>{children}</FormSignContext.Provider>;
}

export function useFormSign(): FormSigner | null {
  return useContext(FormSignContext);
}

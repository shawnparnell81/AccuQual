import { useEffect } from "react";
import { useAssistantContextStore } from "../store/assistantContextStore";

/** Registers this page's module/record with the floating AI Assistant while mounted, clearing it on unmount so the panel doesn't keep talking about a page the user has since left. */
export function useSetAssistantContext(module: string, recordId: number | undefined, label: string) {
  const setContext = useAssistantContextStore((s) => s.setContext);
  const clearContext = useAssistantContextStore((s) => s.clearContext);

  useEffect(() => {
    setContext({ module, recordId, label });
    return () => clearContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module, recordId, label]);
}

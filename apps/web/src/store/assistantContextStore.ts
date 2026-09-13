import { create } from "zustand";

export interface AssistantContext {
  module: string;
  recordId?: number;
  label: string; // shown in the panel header, e.g. "NCR #12"
}

interface AssistantContextState {
  context: AssistantContext | null;
  setContext: (context: AssistantContext) => void;
  clearContext: () => void;
}

/** Real-time only, no persistence — a page currently open sets this, and it clears the moment that page unmounts (see useAssistantContext). Read by AiAssistantPanel to label itself and pass {module, recordId} to POST /ai/assistant. */
export const useAssistantContextStore = create<AssistantContextState>((set) => ({
  context: null,
  setContext: (context) => set({ context }),
  clearContext: () => set({ context: null }),
}));

import { EMAIL_STUB_MESSAGE } from "./reports.model.js";

/**
 * Email delivery is not wired. This does not poll, does not write a schedule
 * row, and does not start a timer. The existing Phase 6 scheduler is unchanged.
 */
export function reportScheduleStub() {
  return {
    status: "stub" as const,
    enabled: false,
    message: EMAIL_STUB_MESSAGE,
  };
}

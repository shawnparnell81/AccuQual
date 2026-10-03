/**
 * SLA math for the NCR Process workflow. Stage names and notice titles are
 * data. This file does not decide who is allowed to approve a record.
 */

export const SLA_STATUSES = ["On Track", "Approaching Due Date", "Overdue", "Escalated"] as const;
export type SlaStatus = (typeof SLA_STATUSES)[number];

export type SeverityClass = "Minor" | "Major" | "Critical";

const DAY_MS = 86_400_000;

export const NCR_SLA_RULES = {
  priorityFromSeverity: { Critical: "Critical", Major: "High", Minor: "Normal" } as Record<SeverityClass, string>,
  implementationRiskFromPriority: { Critical: "Critical", High: "High", Normal: "Medium" } as Record<string, string>,
  implementationDays: { Low: 30, Medium: 21, High: 14, Critical: 7 } as Record<string, number>,
  reminders: { daysBefore: [7, 3, 1], onDue: true, daysOverdue: [1, 3, 7, 14], everyDaysAfter: 7 },
  overallDays: { Minor: 30, Major: 45, Critical: 60 } as Record<SeverityClass, number>,
  overallWarnPercent: 0.75,
  overallEscalatePercent: 0.9,
  stages: {
    "Quality Review": { hours: 24, warnHoursRemaining: 12, overdueTargets: ["Quality Manager", "Operations Manager"], escalateAfterDays: 3, escalateTargets: ["Executive Management"] },
    Containment: {
      hoursBySeverity: { Minor: null, Major: 24, Critical: 4 } as Record<SeverityClass, number | null>,
      overdueTargets: ["Production Manager", "Quality Manager"],
      escalateAfterHours: 24,
      escalateTargets: ["Operations Director"],
    },
    "Root Cause Analysis": {
      businessDays: { Minor: 5, Major: 3, Critical: 2 } as Record<SeverityClass, number>,
      warnAtPercent: 0.8,
      warnTargets: ["RCA owner"],
      overdueTargets: ["Quality Manager", "Engineering Manager"],
      escalateAfterDays: 5,
      escalateTargets: ["Executive Management"],
    },
    "Corrective Action": {
      businessDays: { Minor: 5, Major: 3, Critical: 2 } as Record<SeverityClass, number>,
      overdueTargets: ["action owner", "Quality Manager"],
      escalateAfterDays: 3,
      escalateTargets: ["Operations Manager"],
    },
    Implementation: {
      overdueTargets: ["task owner", "Quality Manager"],
      escalateAfterDays: 7,
      escalateTargets: ["Department Manager"],
      executiveAfterDays: 14,
      executiveTargets: ["Executive Management"],
    },
    "Management Approval": { businessDays: 3, overdueTargets: ["approvers"], escalateAfterDays: 5, escalateTargets: ["Executive Management"] },
    "Effectiveness Verification": { daysAfterAction: 30, criticalDays: 15, approachingTargets: ["Quality Manager"], overdueTargets: ["Quality Manager", "Operations Manager"] },
  },
  overallExceededTargets: ["Quality Manager", "Operations Manager", "Executive Sponsor"],
  side: {
    openMoreThanDays: 30,
    openTargets: ["Quality Manager", "Operations Manager", "Executive Sponsor"],
    openEscalationLevel: "High",
    criticalTargets: ["President", "CEO", "Operations Director"],
    customerResponseHours: 48,
    customerTargets: ["Sales Manager", "Quality Manager"],
    supplierAssignee: "Supplier Quality Engineer",
    supplierTargets: ["Supplier Quality Engineer", "Quality Manager"],
    correctiveOverdueTargets: ["action owner", "Quality Manager"],
  },
} as const;

export const NCR_SLA_SUMMARY = [
  "Quality Review is due 1 day after the NCR is submitted. At 12 hours remaining, Quality Manager is notified. Overdue notifies Quality Manager and Operations Manager. More than 3 days overdue is Escalated to Executive Management.",
  "Containment: Minor has no stage deadline. Major is due in 24 hours. Critical is due in 4 hours. Overdue notifies Production Manager and Quality Manager. More than 24 hours overdue escalates to Operations Director.",
  "Root cause: Minor 5 business days, Major 3, Critical 2. At 80% of the SLA the RCA owner is notified. Overdue notifies Quality Manager and Engineering Manager. More than 5 days overdue escalates to executive review.",
  "Corrective action planning uses the same business-day counts as root cause. Overdue notifies the action owner and Quality Manager. More than 3 days overdue escalates to Operations Manager.",
  "Implementation: Low risk 30 days, Medium 21, High 14, Critical 7. A passed due date notifies the task owner and Quality Manager. More than 7 days overdue notifies the Department Manager. More than 14 days requires executive escalation.",
  "Management approval is due in 3 business days. Overdue notifies the approvers. More than 5 days overdue escalates to executive management.",
  "Effectiveness is due 30 days after the last corrective action is done, or 15 days for a Critical NCR. An approaching due date notifies Quality Manager. Overdue notifies Quality Manager and Operations Manager.",
  "Overall close: Minor 30 days, Major 45, Critical 60, measured by days open. At 75% an early warning is sent. At 90% an escalation warning is sent. Past the target, status is Escalated and Quality Manager, Operations Manager, and Executive Sponsor are notified.",
  "Priority follows severity: Critical, Major as High, Minor as Normal.",
  "Reminders are in-app notices at 7, 3, and 1 day before the due date, on the due date, then 1, 3, 7, and 14 days overdue, then every 7 days until the NCR is closed.",
];

export function severityClass(value: unknown): SeverityClass | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "critical") return "Critical";
  if (text === "major" || text === "high" || text === "medium") return "Major";
  if (text === "minor" || text === "low") return "Minor";
  return null;
}

export function priorityForSeverity(severity: SeverityClass | null): string | null {
  if (!severity) return null;
  return NCR_SLA_RULES.priorityFromSeverity[severity];
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

export function addCalendarDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Monday–Friday. No holiday calendar is stored in AccuQual. */
export function addBusinessDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  let left = Math.max(0, Math.trunc(days));
  while (left > 0) {
    next.setUTCDate(next.getUTCDate() + 1);
    const day = next.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return next;
}

export function calendarDaysBetween(start: Date, end: Date): number {
  const from = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const to = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.round((to - from) / DAY_MS);
}

export function hoursBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 3_600_000;
}

function implementationDays(priority: string | null, risk: unknown): number | null {
  const explicit = String(risk ?? "").trim();
  if (explicit && NCR_SLA_RULES.implementationDays[explicit] != null) return NCR_SLA_RULES.implementationDays[explicit]!;
  const mapped = priority ? NCR_SLA_RULES.implementationRiskFromPriority[priority] : undefined;
  if (mapped && NCR_SLA_RULES.implementationDays[mapped] != null) return NCR_SLA_RULES.implementationDays[mapped]!;
  return null;
}

export interface StageClock {
  due: Date | null;
  /** 0–1 of the stage window already used. Null when the stage has no deadline. */
  used: number | null;
}

export function stageDue(input: {
  stage: string | null;
  severity: SeverityClass | null;
  priority: string | null;
  openedAt: Date | null;
  stageEnteredAt: Date | null;
  lastCorrectiveActionAt: Date | null;
  implementationRisk: unknown;
  now: Date;
}): StageClock {
  const start = input.stageEnteredAt ?? input.openedAt;
  const stage = input.stage;
  const severity = input.severity;
  if (!stage || !start || !severity) return { due: null, used: null };
  const rules = NCR_SLA_RULES.stages;
  let due: Date | null = null;
  if (stage === "Quality Review") due = addHours(input.openedAt ?? start, rules["Quality Review"].hours);
  else if (stage === "Containment") {
    const hours = rules.Containment.hoursBySeverity[severity];
    due = hours == null ? null : addHours(start, hours);
  } else if (stage === "Root Cause Analysis") due = addBusinessDays(start, rules["Root Cause Analysis"].businessDays[severity]);
  else if (stage === "Corrective Action") due = addBusinessDays(start, rules["Corrective Action"].businessDays[severity]);
  else if (stage === "Implementation") {
    const days = implementationDays(input.priority, input.implementationRisk);
    due = days == null ? null : addCalendarDays(start, days);
  } else if (stage === "Management Approval") due = addBusinessDays(start, rules["Management Approval"].businessDays);
  else if (stage === "Effectiveness Verification") {
    const anchor = input.lastCorrectiveActionAt;
    if (!anchor) return { due: null, used: null };
    const days = severity === "Critical" ? rules["Effectiveness Verification"].criticalDays : rules["Effectiveness Verification"].daysAfterAction;
    due = addCalendarDays(anchor, days);
  }
  if (!due) return { due: null, used: null };
  const origin = stage === "Quality Review" ? (input.openedAt ?? start) : stage === "Effectiveness Verification" ? (input.lastCorrectiveActionAt ?? start) : start;
  const total = due.getTime() - origin.getTime();
  const used = total > 0 ? (input.now.getTime() - origin.getTime()) / total : 0;
  return { due, used };
}

export function overallTarget(openedAt: Date, severity: SeverityClass): Date {
  return addCalendarDays(openedAt, NCR_SLA_RULES.overallDays[severity]);
}

export interface SlaNotice {
  key: string;
  targets: string[];
  subject: string;
  body: string;
  dashboardAlert?: string;
}

export interface SlaEvaluation {
  severity: SeverityClass | null;
  priority: string | null;
  slaStatus: SlaStatus | null;
  slaTargetDate: Date | null;
  slaDueDate: Date | null;
  stageDueDate: Date | null;
  daysOpen: number | null;
  daysInStage: number | null;
  warning: boolean;
  escalated: boolean;
  escalationLevel: string | null;
  notices: SlaNotice[];
}

function worse(current: SlaStatus | null, next: SlaStatus): SlaStatus {
  const rank: Record<SlaStatus, number> = { "On Track": 0, "Approaching Due Date": 1, Overdue: 2, Escalated: 3 };
  if (!current || rank[next] > rank[current]) return next;
  return current;
}

function reminderKey(daysUntil: number): string | null {
  const { daysBefore, daysOverdue, everyDaysAfter } = NCR_SLA_RULES.reminders;
  if ((daysBefore as readonly number[]).includes(daysUntil)) return `before:${daysUntil}`;
  if (daysUntil === 0) return "due:0";
  if (daysUntil < 0) {
    const overdue = -daysUntil;
    if ((daysOverdue as readonly number[]).includes(overdue)) return `overdue:${overdue}`;
    const last = daysOverdue[daysOverdue.length - 1]!;
    if (overdue > last && (overdue - last) % everyDaysAfter === 0) return `overdue:${overdue}`;
  }
  return null;
}

function pushNotice(notices: SlaNotice[], sent: Set<string>, notice: SlaNotice) {
  if (sent.has(notice.key)) return;
  notices.push(notice);
}

export function evaluateSla(input: {
  now: Date;
  ncrNumber: string;
  severity: unknown;
  workflowStage: string | null;
  openedAt: Date | null;
  stageEnteredAt: Date | null;
  lastCorrectiveActionAt: Date | null;
  implementationRisk: unknown;
  closed: boolean;
  noticesSent: string[];
  correctiveActionDueAt: Date | null;
  correctiveActionComplete: boolean;
  ncrType: unknown;
}): SlaEvaluation {
  const severity = severityClass(input.severity);
  const priority = priorityForSeverity(severity);
  const sent = new Set(input.noticesSent);
  const notices: SlaNotice[] = [];
  const number = input.ncrNumber;
  if (!severity || !input.openedAt) {
    return {
      severity,
      priority,
      slaStatus: null,
      slaTargetDate: null,
      slaDueDate: null,
      stageDueDate: null,
      daysOpen: input.openedAt ? Math.max(0, calendarDaysBetween(input.openedAt, input.closed ? input.now : input.now)) : null,
      daysInStage: null,
      warning: false,
      escalated: false,
      escalationLevel: null,
      notices,
    };
  }

  const end = input.now;
  const daysOpen = Math.max(0, calendarDaysBetween(input.openedAt, end));
  const daysInStage = input.stageEnteredAt ? Math.max(0, calendarDaysBetween(input.stageEnteredAt, end)) : daysOpen;
  const target = overallTarget(input.openedAt, severity);
  const clock = stageDue({
    stage: input.workflowStage,
    severity,
    priority,
    openedAt: input.openedAt,
    stageEnteredAt: input.stageEnteredAt,
    lastCorrectiveActionAt: input.lastCorrectiveActionAt,
    implementationRisk: input.implementationRisk,
    now: input.now,
  });
  const stageDueDate = clock.due;
  const slaDueDate = stageDueDate ?? target;
  let status: SlaStatus | null = input.closed ? "On Track" : "On Track";
  let warning = false;
  let escalated = false;
  let escalationLevel: string | null = null;

  const overallDays = NCR_SLA_RULES.overallDays[severity];
  const overallUsed = overallDays > 0 ? daysOpen / overallDays : 0;
  if (!input.closed && overallUsed >= NCR_SLA_RULES.overallWarnPercent && daysOpen <= overallDays) {
    status = worse(status, "Approaching Due Date");
    warning = true;
    const key = overallUsed >= NCR_SLA_RULES.overallEscalatePercent ? "overall:90" : "overall:75";
    const label = overallUsed >= NCR_SLA_RULES.overallEscalatePercent ? "90%" : "75%";
    pushNotice(notices, sent, {
      key,
      targets: [...NCR_SLA_RULES.overallExceededTargets],
      subject: `NCR ${number} has used ${label} of its close target`,
      body: `NCR ${number} has been open ${daysOpen} days. The close target for a ${severity} nonconformance is ${overallDays} days.`,
    });
  }
  if (!input.closed && daysOpen > overallDays) {
    status = worse(status, "Escalated");
    escalated = true;
    pushNotice(notices, sent, {
      key: "overall:exceeded",
      targets: [...NCR_SLA_RULES.overallExceededTargets],
      subject: `NCR ${number} is past its close target`,
      body: `NCR ${number} has been open ${daysOpen} days, past the ${overallDays}-day close target for a ${severity} nonconformance. The SLA status is Escalated.`,
    });
  }

  if (!input.closed && stageDueDate && input.workflowStage) {
    const hoursLeft = hoursBetween(input.now, stageDueDate);
    const daysUntil = calendarDaysBetween(input.now, stageDueDate);
    if (input.now.getTime() > stageDueDate.getTime()) status = worse(status, "Overdue");
    else if (input.workflowStage === "Quality Review" && hoursLeft <= NCR_SLA_RULES.stages["Quality Review"].warnHoursRemaining) {
      status = worse(status, "Approaching Due Date");
      warning = true;
      pushNotice(notices, sent, {
        key: "stage:quality-review:12h",
        targets: ["Quality Manager"],
        subject: `NCR ${number} quality review has 12 hours remaining`,
        body: `NCR ${number} is due for Quality Review on ${stageDueDate.toISOString()}. 12 hours or less remain.`,
      });
    } else if (input.workflowStage === "Root Cause Analysis" && (clock.used ?? 0) >= NCR_SLA_RULES.stages["Root Cause Analysis"].warnAtPercent) {
      status = worse(status, "Approaching Due Date");
      warning = true;
      pushNotice(notices, sent, {
        key: "stage:rca:80",
        targets: [...NCR_SLA_RULES.stages["Root Cause Analysis"].warnTargets],
        subject: `NCR ${number} root cause analysis is at 80% of its SLA`,
        body: `NCR ${number} has used 80% or more of the root cause analysis SLA. The due date is ${stageDueDate.toISOString()}.`,
      });
    } else if (input.workflowStage === "Effectiveness Verification" && daysUntil <= 7 && daysUntil >= 0) {
      status = worse(status, "Approaching Due Date");
      warning = true;
      pushNotice(notices, sent, {
        key: "stage:effectiveness:approaching",
        targets: [...NCR_SLA_RULES.stages["Effectiveness Verification"].approachingTargets],
        subject: `NCR ${number} effectiveness verification is approaching its due date`,
        body: `NCR ${number} effectiveness verification is due ${stageDueDate.toISOString()}.`,
      });
    } else if (daysUntil <= 7 && daysUntil >= 0) {
      status = worse(status, "Approaching Due Date");
      warning = true;
    }

    const bucket = reminderKey(daysUntil);
    if (bucket) {
      const when = daysUntil > 0 ? `${daysUntil} day${daysUntil === 1 ? "" : "s"} before the due date` : daysUntil === 0 ? "due today" : `${-daysUntil} day${daysUntil === -1 ? "" : "s"} overdue`;
      pushNotice(notices, sent, {
        key: `reminder:${input.workflowStage}:${bucket}`,
        targets: stageReminderTargets(input.workflowStage),
        subject: `NCR ${number} reminder: ${input.workflowStage} is ${when}`,
        body: `NCR ${number} is in ${input.workflowStage}. The stage due date is ${stageDueDate.toISOString()}. This reminder is an in-app notice.`,
      });
    }

    if (input.now.getTime() > stageDueDate.getTime()) {
      const overdueHours = hoursBetween(stageDueDate, input.now);
      const overdueDays = calendarDaysBetween(stageDueDate, input.now);
      const stageRules = stageOverdue(input.workflowStage);
      pushNotice(notices, sent, {
        key: `stage-overdue:${input.workflowStage}`,
        targets: stageRules.overdue,
        subject: `NCR ${number} is overdue in ${input.workflowStage}`,
        body: `NCR ${number} missed the ${input.workflowStage} due date of ${stageDueDate.toISOString()}. The SLA status is Overdue.`,
      });
      const escalate = stageRules.escalateAfterDays != null && overdueDays > stageRules.escalateAfterDays;
      const escalateHours = input.workflowStage === "Containment" && overdueHours > NCR_SLA_RULES.stages.Containment.escalateAfterHours;
      const executive = input.workflowStage === "Implementation" && overdueDays > NCR_SLA_RULES.stages.Implementation.executiveAfterDays;
      if (escalate || escalateHours) {
        status = worse(status, "Escalated");
        escalated = true;
        pushNotice(notices, sent, {
          key: `stage-escalated:${input.workflowStage}`,
          targets: stageRules.escalate,
          subject: `NCR ${number} ${input.workflowStage} is escalated`,
          body: `NCR ${number} is past the escalation point for ${input.workflowStage}. The SLA status is Escalated.`,
        });
      }
      if (executive) {
        status = worse(status, "Escalated");
        escalated = true;
        pushNotice(notices, sent, {
          key: `stage-executive:${input.workflowStage}`,
          targets: [...NCR_SLA_RULES.stages.Implementation.executiveTargets],
          subject: `NCR ${number} implementation requires executive escalation`,
          body: `NCR ${number} is more than 14 days overdue in Implementation. Executive escalation is required.`,
        });
      }
    }
  }

  if (!input.closed && daysOpen > NCR_SLA_RULES.side.openMoreThanDays) {
    escalationLevel = NCR_SLA_RULES.side.openEscalationLevel;
    status = worse(status, "Escalated");
    escalated = true;
    pushNotice(notices, sent, {
      key: "side:open-30",
      targets: [...NCR_SLA_RULES.side.openTargets],
      subject: `NCR ${number} has been open more than 30 days`,
      body: `NCR ${number} has been open ${daysOpen} days. The escalation level is High. The record stays on its current step.`,
    });
  }

  if (!input.closed && severity === "Critical") {
    pushNotice(notices, sent, {
      key: "side:critical",
      targets: [...NCR_SLA_RULES.side.criticalTargets],
      subject: `NCR ${number} is critical`,
      body: `NCR ${number} is classified Critical. Priority is Critical. Executive approval is required before the workflow continues.`,
    });
  }

  if (!input.closed && input.correctiveActionDueAt && !input.correctiveActionComplete && input.now.getTime() > input.correctiveActionDueAt.getTime()) {
    status = worse(status, "Overdue");
    pushNotice(notices, sent, {
      key: "side:corrective-overdue",
      targets: [...NCR_SLA_RULES.side.correctiveOverdueTargets],
      subject: `NCR ${number} corrective action is overdue`,
      body: `NCR ${number} has a corrective action past its due date and the task is not complete. Priority is raised. Please return to the task.`,
      dashboardAlert: `Corrective action for NCR ${number} is overdue.`,
    });
  }

  const ncrType = String(input.ncrType ?? "").trim().toLowerCase();
  if (!input.closed && ncrType === "customer") {
    pushNotice(notices, sent, {
      key: "side:customer",
      targets: [...NCR_SLA_RULES.side.customerTargets],
      subject: `NCR ${number} needs a customer response`,
      body: `NCR ${number} is a customer nonconformance. A customer response is due in ${NCR_SLA_RULES.side.customerResponseHours} hours.`,
    });
  }
  if (!input.closed && ncrType === "supplier") {
    pushNotice(notices, sent, {
      key: "side:supplier",
      targets: [...NCR_SLA_RULES.side.supplierTargets],
      subject: `NCR ${number} needs a supplier corrective action`,
      body: `NCR ${number} is a supplier nonconformance. A SCAR is opened and assigned to the Supplier Quality Engineer. Supplier response and supplier corrective actions stay on this quality record.`,
    });
  }

  if (input.closed && daysOpen <= NCR_SLA_RULES.overallDays[severity]) status = "On Track";

  return {
    severity,
    priority,
    slaStatus: status,
    slaTargetDate: target,
    slaDueDate,
    stageDueDate,
    daysOpen,
    daysInStage,
    warning,
    escalated,
    escalationLevel,
    notices,
  };
}

function stageReminderTargets(stage: string): string[] {
  return stageOverdue(stage).overdue;
}

function stageOverdue(stage: string): { overdue: string[]; escalate: string[]; escalateAfterDays: number | null } {
  const rules = NCR_SLA_RULES.stages;
  if (stage === "Quality Review") return { overdue: [...rules["Quality Review"].overdueTargets], escalate: [...rules["Quality Review"].escalateTargets], escalateAfterDays: rules["Quality Review"].escalateAfterDays };
  if (stage === "Containment") return { overdue: [...rules.Containment.overdueTargets], escalate: [...rules.Containment.escalateTargets], escalateAfterDays: null };
  if (stage === "Root Cause Analysis") return { overdue: [...rules["Root Cause Analysis"].overdueTargets], escalate: [...rules["Root Cause Analysis"].escalateTargets], escalateAfterDays: rules["Root Cause Analysis"].escalateAfterDays };
  if (stage === "Corrective Action") return { overdue: [...rules["Corrective Action"].overdueTargets], escalate: [...rules["Corrective Action"].escalateTargets], escalateAfterDays: rules["Corrective Action"].escalateAfterDays };
  if (stage === "Implementation") return { overdue: [...rules.Implementation.overdueTargets], escalate: [...rules.Implementation.escalateTargets], escalateAfterDays: rules.Implementation.escalateAfterDays };
  if (stage === "Management Approval") return { overdue: [...rules["Management Approval"].overdueTargets], escalate: [...rules["Management Approval"].escalateTargets], escalateAfterDays: rules["Management Approval"].escalateAfterDays };
  if (stage === "Effectiveness Verification") return { overdue: [...rules["Effectiveness Verification"].overdueTargets], escalate: [...rules["Effectiveness Verification"].overdueTargets], escalateAfterDays: null };
  return { overdue: ["Quality Manager"], escalate: ["Executive Management"], escalateAfterDays: null };
}

export interface StageMark {
  stage: string;
  at: string;
}

export function daysBetweenMarks(history: StageMark[], from: string, to: string): number | null {
  const start = history.find((mark) => mark.stage === from);
  const end = history.find((mark) => mark.stage === to);
  if (!start || !end) return null;
  const days = calendarDaysBetween(new Date(start.at), new Date(end.at));
  return days >= 0 ? days : null;
}

export interface NcrMetricSource {
  id: number;
  status: string;
  severity: string | null;
  title: string;
  description: string | null;
  supplierId: number | null;
  createdAt: Date | string | null;
  closedAt: Date | string | null;
  workflowStage: string | null;
  slaStatus: string | null;
  daysOpen: number | null;
  daysInStage: number | null;
  processData: Record<string, unknown> | null;
}

export interface NcrProcessMetrics {
  openCount: number;
  overdueCount: number;
  criticalCount: number;
  customerCount: number;
  supplierCount: number;
  repeatCount: number;
  averageDaysOpen: number | null;
  averageDaysInStage: number | null;
  averageRcaDays: number | null;
  averageCorrectiveActionDays: number | null;
  averageVerificationDays: number | null;
  averageCycleDays: number | null;
  slaCompliancePercent: number | null;
  closureTrend: { label: string; count: number }[];
  byDepartment: { label: string; count: number }[];
  byRootCause: { label: string; count: number }[];
  dashboardAlerts: { id: number; message: string }[];
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10) / 10;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function historyOf(data: Record<string, unknown> | null): StageMark[] {
  const raw = data?.stageHistory;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is StageMark => !!item && typeof item === "object" && typeof (item as StageMark).stage === "string" && typeof (item as StageMark).at === "string");
}

export function ncrProcessMetrics(rows: NcrMetricSource[], now = new Date()): NcrProcessMetrics {
  const open = rows.filter((row) => row.status !== "closed" && row.workflowStage !== "Closed" && row.workflowStage !== "Rejected");
  const overdueCount = rows.filter((row) => row.slaStatus === "Overdue" || row.slaStatus === "Escalated").length;
  const criticalCount = rows.filter((row) => severityClass(row.severity) === "Critical" || severityClass(row.processData?.severity) === "Critical").length;
  const customerCount = rows.filter((row) => String(row.processData?.ncr_type ?? "").toLowerCase() === "customer").length;
  const supplierCount = rows.filter((row) => String(row.processData?.ncr_type ?? "").toLowerCase() === "supplier").length;
  const daysOpenValues = rows.map((row) => (typeof row.daysOpen === "number" ? row.daysOpen : row.createdAt ? Math.max(0, calendarDaysBetween(asDate(row.createdAt)!, asDate(row.closedAt) ?? now)) : null)).filter((value): value is number => value != null);
  const daysInStageValues = open.map((row) => row.daysInStage).filter((value): value is number => typeof value === "number");
  const rca: number[] = [];
  const corrective: number[] = [];
  const verification: number[] = [];
  const cycle: number[] = [];
  let compliant = 0;
  let measured = 0;
  const departments = new Map<string, number>();
  const causes = new Map<string, number>();
  const alerts: { id: number; message: string }[] = [];
  const closures = new Map<string, number>();

  for (const row of rows) {
    const data = row.processData ?? {};
    const department = String(data.department ?? "").trim() || "Unassigned";
    departments.set(department, (departments.get(department) ?? 0) + 1);
    const cause = String(data.root_cause ?? "").trim();
    if (cause) {
      const label = cause.length > 42 ? `${cause.slice(0, 39)}...` : cause;
      causes.set(label, (causes.get(label) ?? 0) + 1);
    }
    const alert = data.dashboardAlert;
    if (typeof alert === "string" && alert && row.status !== "closed" && row.workflowStage !== "Closed") alerts.push({ id: row.id, message: alert });
    const marks = historyOf(data);
    const rcaDays = daysBetweenMarks(marks, "Root Cause Analysis", "Corrective Action");
    const caDays = daysBetweenMarks(marks, "Corrective Action", "Implementation");
    const verifyDays = daysBetweenMarks(marks, "Effectiveness Verification", "Closed");
    if (rcaDays != null) rca.push(rcaDays);
    if (caDays != null) corrective.push(caDays);
    if (verifyDays != null) verification.push(verifyDays);
    const opened = asDate(row.createdAt);
    const closed = asDate(row.closedAt) ?? (row.workflowStage === "Closed" ? asDate(typeof data.date_closed === "string" ? data.date_closed : null) : null);
    if (opened && closed) {
      const span = calendarDaysBetween(opened, closed);
      if (span >= 0) cycle.push(span);
      const severity = severityClass(row.severity) ?? severityClass(data.severity);
      if (severity) {
        measured += 1;
        if (span <= NCR_SLA_RULES.overallDays[severity]) compliant += 1;
      }
    }
    if (closed) {
      const key = `${closed.getUTCFullYear()}-${String(closed.getUTCMonth() + 1).padStart(2, "0")}`;
      closures.set(key, (closures.get(key) ?? 0) + 1);
    }
    if (data.repeat === true) {
      // counted below from the flag; the cluster pass adds ids that are not already flagged
    }
  }

  const repeatIds = new Set<number>(rows.filter((row) => row.processData?.repeat === true).map((row) => row.id));
  // A repeat is two or more NCRs that share a part number or a supplier and a similar title.
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const part = String(row.processData?.part_number ?? "").trim().toLowerCase();
    const supplier = row.supplierId != null ? `supplier:${row.supplierId}` : "";
    const title = row.title.trim().toLowerCase();
    const key = part || (supplier && title ? `${supplier}|${title}` : "");
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(row.id);
    groups.set(key, list);
  }
  for (const ids of groups.values()) {
    if (ids.length >= 2) for (const id of ids) repeatIds.add(id);
  }

  const byCount = (map: Map<string, number>) => [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 8);

  return {
    openCount: open.length,
    overdueCount,
    criticalCount,
    customerCount,
    supplierCount,
    repeatCount: repeatIds.size,
    averageDaysOpen: average(daysOpenValues),
    averageDaysInStage: average(daysInStageValues),
    averageRcaDays: average(rca),
    averageCorrectiveActionDays: average(corrective),
    averageVerificationDays: average(verification),
    averageCycleDays: average(cycle),
    slaCompliancePercent: measured === 0 ? null : Math.round((compliant / measured) * 1000) / 10,
    closureTrend: [...closures.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => ({ label, count })),
    byDepartment: byCount(departments),
    byRootCause: byCount(causes),
    dashboardAlerts: alerts,
  };
}

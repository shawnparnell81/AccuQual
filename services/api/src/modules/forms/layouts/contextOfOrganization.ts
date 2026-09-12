import type { FormLayout } from "./types.js";

/**
 * Derived 1:1 from the user-provided "Context of the Organization.pdf" (ISO
 * 9001 clause 4.1 SWOT-style analysis). The source groups items under
 * category headers (VALUES, CULTURE, ...) with no sub-header row concept in
 * this engine's table block, so each row's label is prefixed with its
 * category to preserve the grouping instead of losing it.
 */
const INTERNAL_ITEMS = [
  "VALUES — Ethical action policy, standards of conduct",
  "VALUES — Quality policy",
  "VALUES — Employee satisfaction",
  "VALUES — Security policy",
  "VALUES — Staff motivation",
  "VALUES — Employment stability",
  "VALUES — Organizational strategy",
  "VALUES — Hierarchical structure",
  "VALUES — Process structure",
  "CULTURE — Quality awareness",
  "CULTURE — Management system",
  "CULTURE — Internal communication",
  "CULTURE — IT infrastructure",
  "CULTURE — Building infrastructure",
  "CULTURE — Problem Solving",
  "CULTURE — Recruitment of employees",
  "KNOWLEDGE — Staff competences",
  "KNOWLEDGE — Experience",
  "KNOWLEDGE — Staff training",
  "KNOWLEDGE — Technology and innovation",
  "PERFORMANCE RESULTS — Process results",
  "PERFORMANCE RESULTS — Costs of poor quality",
  "PERFORMANCE RESULTS — Results of internal audits",
  "PERFORMANCE RESULTS — Corporation + requirements",
];

const EXTERNAL_ITEMS = [
  "LAWS AND REGULATIONS — Labor Code",
  "LAWS AND REGULATIONS — Tax Office, Police, Fire Department, courts",
  "TECHNOLOGY — Plant infrastructure",
  "COMPETITION — Participation in the labor market",
  "MARKET — Customer requirements",
  "MARKET — Cooperation with suppliers",
  "MARKET — Market stability",
  "CULTURE — Brand recognition and strength",
  "CULTURE — Cultural differences - foreigners",
  "OPERATING ENVIRONMENT — Location",
  "OPERATING ENVIRONMENT — Insurers (cargo, liability insurance, property insurance)",
  "OPERATING ENVIRONMENT — Cooperation with universities and secondary schools",
  "OPERATING ENVIRONMENT — Availability of employees on the labor market",
  "OPERATING ENVIRONMENT — Local community / Neighbors",
  "OPERATING ENVIRONMENT — External companies",
  "OPERATING ENVIRONMENT — Corporation + requirements",
  "OPERATING ENVIRONMENT — Unions",
  "OPERATING ENVIRONMENT — Employees (representatives, social/health & safety committees, families)",
  "OPERATING ENVIRONMENT — Environment (customers, suppliers, transport, corporation)",
  "OPERATING ENVIRONMENT — Suppliers of equipment for building prototypes and conducting tests",
];

export const contextOfOrganizationLayout: FormLayout = {
  formType: "context_of_organization",
  title: "CONTEXT OF THE ORGANIZATION",
  sections: [
    {
      number: "1",
      title: "INTERNAL CONTEXT — STRENGTHS & WEAKNESSES",
      blocks: [
        {
          type: "table",
          name: "internalContext",
          labelColumnHeader: "Internal Context",
          fixedRowLabels: INTERNAL_ITEMS,
          columns: [
            { key: "strengths", label: "Strengths", kind: "textarea" },
            { key: "weaknesses", label: "Weaknesses", kind: "textarea" },
            { key: "interestedParty", label: "Interested Party", kind: "text" },
          ],
        },
      ],
    },
    {
      number: "2",
      title: "EXTERNAL CONTEXT — OPPORTUNITIES & THREATS",
      blocks: [
        {
          type: "table",
          name: "externalContext",
          labelColumnHeader: "External Context",
          fixedRowLabels: EXTERNAL_ITEMS,
          columns: [
            { key: "opportunities", label: "Opportunities", kind: "textarea" },
            { key: "threats", label: "Threats", kind: "textarea" },
            { key: "interestedParty", label: "Interested Party", kind: "text" },
          ],
        },
      ],
    },
  ],
};

/**
 * Default document folder taxonomy, seeded for every company
 * the first time GET /document-folders finds none yet (see document-folders.controller.ts).
 * Derived from the user's own 7 uploaded department folder/subfolder lists; every
 * subfolder that had no documents in the source was dropped rather than kept as an
 * empty stub.
 *
 * ISO Compliance Documents is the only content root. Engineering, Quality, and the
 * other departments are children of that folder.
 */
export interface DefaultFolderSeed {
  name: string;
  children: DefaultFolderSeed[];
}

const DEPARTMENT_BRANCHES: DefaultFolderSeed[] = [
  {
    name: "Engineering",
    children: [
      { name: "Design & Development", children: [{ name: "Design Inputs", children: [] }, { name: "Design Outputs", children: [] }, { name: "Design Reviews", children: [] }, { name: "DFMEA (Design FMEA)", children: [] }, { name: "Risk Analysis", children: [] }, { name: "Prototypes / Samples", children: [] }, { name: "Design Verification", children: [] }, { name: "Design Validation", children: [] }, { name: "DHF (Design History File)", children: [] }] },
      { name: "Engineering Change Control", children: [{ name: "Engineering Change Requests (ECR)", children: [] }, { name: "Engineering Change Orders (ECO)", children: [] }, { name: "Change Impact Assessments", children: [] }, { name: "Revision Logs", children: [] }, { name: "Archived/Obsolete Designs", children: [] }] },
      { name: "Specifications & Standards", children: [{ name: "Product Specifications", children: [] }, { name: "Material Specifications", children: [] }, { name: "Component Specs", children: [] }, { name: "GD&T / Tolerance Standards", children: [] }, { name: "Workmanship Standards", children: [] }, { name: "Engineering Standards", children: [] }, { name: "Customer-Specific Requirements (CSR)", children: [] }] },
      { name: "Drawings & CAD", children: [{ name: "Mechanical Drawings", children: [] }, { name: "Electrical Schematics", children: [] }, { name: "Tooling Drawings", children: [] }, { name: "Fixture/Jig Drawings", children: [] }, { name: "CAD Models (2D/3D)", children: [] }, { name: "Revision Archive", children: [] }] },
      { name: "Calibration & Measurement", children: [{ name: "Calibration Procedures", children: [] }, { name: "Calibration Certificates", children: [] }, { name: "Equipment Master List", children: [] }, { name: "Gage R&R Studies", children: [] }, { name: "MSA (Measurement System Analysis)", children: [] }] },
      { name: "Manufacturing Engineering", children: [{ name: "Process Flow Diagrams", children: [] }, { name: "PFMEA", children: [] }, { name: "Control Plans", children: [] }, { name: "Work Instructions (Engineering-owned)", children: [] }, { name: "Tooling & Fixture Documentation", children: [] }, { name: "Capability Studies (Cp/Cpk)", children: [] }, { name: "Run @ Rate Documentation", children: [] }, { name: "Process Validation", children: [] }] },
      { name: "Supplier Engineering", children: [{ name: "Supplier Specifications", children: [] }, { name: "Supplier Drawings", children: [] }, { name: "Supplier Change Notifications", children: [] }, { name: "Supplier PPAP Submissions", children: [] }, { name: "Supplier Capability Studies", children: [] }, { name: "Supplier Engineering Reports", children: [] }] },
      { name: "Technical Records", children: [{ name: "Failure Analysis Reports", children: [] }, { name: "Root Cause Engineering Reports", children: [] }, { name: "Field Issue Engineering Analysis", children: [] }, { name: "Reliability Studies", children: [] }, { name: "Engineering Support for CAR/PAR", children: [] }, { name: "MRB Engineering Decisions", children: [] }] },
    ],
  },
  {
    name: "Quality",
    children: [
      { name: "Quality Manual & Policies", children: [{ name: "Quality Manual", children: [] }, { name: "Quality Policy", children: [] }, { name: "Mission / Vision / Values", children: [] }, { name: "Organizational Chart", children: [] }, { name: "Scope of QMS", children: [] }, { name: "Exclusions & Justifications", children: [] }, { name: "Quality Objectives & Action Plans", children: [] }, { name: "Management Review Records", children: [] }] },
      { name: "Procedures (SOPs)", children: [{ name: "Document Control Procedure", children: [] }, { name: "Record Control Procedure", children: [] }, { name: "Training Procedure", children: [] }, { name: "Calibration Procedure", children: [] }, { name: "Internal Audit Procedure", children: [] }, { name: "Control of Nonconforming Product", children: [] }, { name: "Corrective Action Procedure", children: [] }, { name: "Preventive Action Procedure", children: [] }, { name: "Supplier Quality Procedure", children: [] }, { name: "Risk Management Procedure", children: [] }, { name: "Change Control Procedure", children: [] }, { name: "Complaint Handling Procedure", children: [] }, { name: "Engineering Change Procedure", children: [] }, { name: "Production Control Procedure", children: [] }] },
      { name: "Work Instructions", children: [{ name: "Department Work Instructions", children: [] }, { name: "Process Work Instructions", children: [] }, { name: "Equipment Work Instructions", children: [] }, { name: "Inspection Work Instructions", children: [] }, { name: "Packaging Work Instructions", children: [] }, { name: "Shipping Work Instructions", children: [] }] },
      { name: "Forms & Templates", children: [{ name: "NCR Form", children: [] }, { name: "8D Form", children: [] }, { name: "CAPA Form", children: [] }, { name: "SCAR Form", children: [] }, { name: "Audit Checklist", children: [] }, { name: "Calibration Form", children: [] }, { name: "Training Record", children: [] }, { name: "Change Request Form", children: [] }, { name: "Engineering Change Order Form", children: [] }, { name: "Inspection Forms", children: [] }, { name: "Receiving Inspection Form", children: [] }, { name: "Final Inspection Form", children: [] }] },
      { name: "Records", children: [{ name: "NCR Records", children: [] }, { name: "8D Records", children: [] }, { name: "CAPA Records", children: [] }, { name: "SCAR Records", children: [] }, { name: "Audit Records", children: [] }, { name: "Calibration Certificates", children: [] }, { name: "Training Records", children: [] }, { name: "Inspection Records", children: [] }, { name: "Production Records", children: [] }, { name: "Customer Complaint Records", children: [] }, { name: "Supplier Performance Records", children: [] }, { name: "Change Control Records", children: [] }, { name: "Engineering Change Records", children: [] }] },
      { name: "Corrective & Preventive Actions", children: [{ name: "CAPA Reports", children: [] }, { name: "Root Cause Analysis", children: [] }, { name: "Containment Actions", children: [] }, { name: "Corrective Actions", children: [] }, { name: "Preventive Actions", children: [] }, { name: "Effectiveness Checks", children: [] }, { name: "Closure Documentation", children: [] }] },
      { name: "Nonconformance Management", children: [{ name: "Quarantine Material", children: [] }, { name: "WIP Hold / Quarantine", children: [] }, { name: "Incoming NCRs", children: [] }, { name: "Deviation / Waiver Requests", children: [] }] },
      { name: "Supplier Quality", children: [{ name: "Supplier Audits", children: [] }, { name: "Supplier NCR", children: [] }, { name: "Supplier SCAR", children: [] }, { name: "Supplier Scorecards", children: [] }] },
      { name: "Calibration & Equipment", children: [{ name: "Calibration Procedures", children: [] }, { name: "Calibration Certificates", children: [] }, { name: "Equipment Master List", children: [] }, { name: "Equipment Maintenance Records", children: [] }, { name: "Gage R&R", children: [] }, { name: "MSA Studies", children: [] }] },
      { name: "Risk Management", children: [{ name: "PFMEA", children: [] }, { name: "DFMEA", children: [] }, { name: "Process Flow Diagrams", children: [] }, { name: "Control Plans", children: [] }, { name: "Risk Assessments", children: [] }, { name: "Hazard Analysis", children: [] }] },
      { name: "Customer Quality", children: [{ name: "Complaint NCRs", children: [] }, { name: "Complaint 8Ds", children: [] }, { name: "Complaint Corrective Actions", children: [] }, { name: "Complaint Closure Documentation", children: [] }, { name: "RMA Requests", children: [] }, { name: "RMA Approvals", children: [] }, { name: "Returned Product Inspection", children: [] }, { name: "RMA NCRs", children: [] }, { name: "RMA Root Cause Analysis", children: [] }, { name: "RMA Credit / Replacement Documentation", children: [] }] },
      { name: "Production & Inspection", children: [{ name: "First Article Inspection (FAI)", children: [] }, { name: "In-Process Inspection", children: [] }, { name: "Final Inspection", children: [] }, { name: "SPC Charts", children: [] }, { name: "Process Capability Studies", children: [] }, { name: "Measurement Records", children: [] }, { name: "Sampling Plans", children: [] }, { name: "Inspection Checklists", children: [] }, { name: "Defect Trend Analysis", children: [] }, { name: "Pareto Charts", children: [] }, { name: "Control Charts", children: [] }, { name: "Production Quality KPIs", children: [] }, { name: "Corrective Actions (Production-related)", children: [] }] },
      { name: "Document Control", children: [{ name: "Master Document List", children: [] }, { name: "Revision History", children: [] }, { name: "Obsolete Documents", children: [] }, { name: "Controlled Document Archive", children: [] }, { name: "Record Retention Log", children: [] }, { name: "Quality Record Disposition", children: [] }] },
      { name: "Training & Competency", children: [{ name: "Training Matrix", children: [] }, { name: "Training Records", children: [] }, { name: "Competency Assessments", children: [] }, { name: "Certifications", children: [] }, { name: "Qualification Records", children: [] }] },
    ],
  },
  {
    name: "Audits",
    children: [
      { name: "Internal Audit Schedule", children: [] },
      { name: "Internal Audit Reports", children: [] },
      { name: "External Audit Reports", children: [] },
      { name: "Audit Findings", children: [] },
      { name: "Audit Follow-Up", children: [] },
      { name: "Audit Evidence", children: [] },
      { name: "Safety Audits", children: [] },
    ],
  },
  {
    name: "Training",
    children: [
      { name: "Operator Training Records", children: [] },
      { name: "Machine Qualification", children: [] },
      { name: "Cross-Training Matrix", children: [] },
      { name: "Safety Training", children: [] },
      { name: "Production Certifications", children: [] },
    ],
  },
  {
    name: "Safety",
    children: [
      { name: "Safety Procedures", children: [] },
      { name: "PPE Requirements", children: [] },
      { name: "Incident Reports", children: [] },
      { name: "Lockout/Tagout Procedures", children: [] },
      { name: "Environmental Condition Records", children: [] },
    ],
  },
  { name: "Production", children: [] },
  { name: "CAPA", children: [] },
  { name: "NCR", children: [] },
  { name: "8D", children: [] },
  { name: "Work Instruction", children: [] },
  { name: "Procedures", children: [] },
  {
    name: "SOP",
    children: [
      { name: "Policies", children: [] },
      { name: "Procedures", children: [] },
    ],
  },
  {
    name: "Material Management",
    children: [
      { name: "Material Receiving", children: [{ name: "Receiving Logs", children: [] }, { name: "Receiving Inspection Forms (Quality?)", children: [] }, { name: "Supplier Packing Lists", children: [] }, { name: "Delivery Receipts", children: [] }, { name: "Material Certifications (MTRs, COCs)", children: [] }, { name: "Incoming Inspection (Create NCRs Only)", children: [] }] },
      { name: "Components & Parts", children: [{ name: "Component Inventory", children: [] }, { name: "Component Specifications", children: [] }, { name: "Approved Component List", children: [] }, { name: "Component Revision History (Engineering?)", children: [] }, { name: "Component Traceability Records (Quality/Engineering?)", children: [] }] },
      { name: "Inventory Control", children: [{ name: "Inventory Adjustments", children: [] }, { name: "Cycle Count Records", children: [] }, { name: "Physical Inventory Reports", children: [] }, { name: "FIFO/LIFO Tracking", children: [] }, { name: "Lot Control Records", children: [] }, { name: "Material Shortage Reports", children: [] }] },
    ],
  },
  {
    name: "Shipping & Receiving",
    children: [
      { name: "Receiving Inspection", children: [] },
      { name: "Incoming Inspection Record", children: [] },
      { name: "Supplier NCRs", children: [] },
    ],
  },
];

/** One content root. Every department folder is a child of this folder. */
export const DEFAULT_DOCUMENT_FOLDERS: DefaultFolderSeed[] = [
  { name: "ISO Compliance Documents", children: DEPARTMENT_BRANCHES },
];

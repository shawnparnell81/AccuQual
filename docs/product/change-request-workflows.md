# Change request workflows

Four requests share one stage machine. Engineering Change Request (FRM-ECR-001) is the template. Drawing (FRM-DWG-001), process (FRM-PCR-001), and document (FRM-DOC-001) requests use the same cells, roles, PIN gate, and history, with their own labels.

Blank forms open from Blank Forms. A filled copy is saved into a Documents folder. The sidebar does not gain a new item for each request. ECR can still be pinned, and the ECR folder is unchanged. The existing Document changes page (`/document-change-requests`) and the Process Change sidebar item (`/change`, the product/process change notice) stay as they are. These sheets do not replace them.

No database migration. Each master (its labels and revision) is stored on the company profile: `ecrTemplate`, `drawingChangeTemplate`, `processChangeTemplate`, and `documentChangeTemplate`. Filled copies stay on the existing ISO form record. Company Settings spreads the profile, so a settings save keeps the masters.

The engine is `services/api/src/modules/change-requests/changeRequestWorkflow.ts`. The four kinds, including labels and the words used in the audit line, are `changeRequestKinds.ts`. The web sheet is the same grid as FRM-ECR-001.

## Shared stages

Each request moves in this order:

1. **Request** — the requester fills the sheet.
2. **Review** — engineering review and quality review run together. Either can finish first. Approval waits until both are recorded.
3. **Approve or reject** — one decision. Reject returns the request for correction. Approve freezes the request.
4. **Implement** — the change is made. Only the implementation verification can be edited.
5. **Close** — verification is answered and the request is finished. A closed copy cannot be edited.

A rejected request can be corrected and submitted again. That clears the two reviews so they are done on the corrected copy.

Record signatures are the existing 4-digit PIN plus the certification checkbox. The stamp stores the name, date, and time. The PIN is hashed and is not shown again.

Template structure is separate from filling a copy. Changing labels on a change-request master requires a role that can already edit form structure, and the same PIN plus certification, before the editor opens and again when the change is saved. VERSION and REV move only when the saved structure is actually different. Filling answers does not move the revision.

History on the record is the audit line: who, what, when, and a short description. Anyone who can open the record can read it.

## Who does what

| Action | Who |
| --- | --- |
| Create and fill | Quality or Engineering with edit on Documents. Other departments can read. |
| Engineering review | Engineering, or a title that can approve. |
| Quality review | Quality, or a title that can approve. |
| Approve, reject, close | Owner, Administrator, Quality Manager, Engineering Manager, Vice President, or VP of Quality and Engineering. A general engineer does not approve. |
| Manager signature | The same approver titles, with PIN and certification, during request or review. |
| Supplier signature | Anyone who can edit the copy, until it is closed. Optional. |
| Edit the template | Quality Manager, Engineering Manager, Engineer, Engineers, Quality, VP of Quality and Engineering, Product Engineer, Owner, and Administrator. PIN and certification are required. |

Approve also needs both reviews and the manager signature already on the sheet.

## Transitions

| From | Action | To | Notes |
| --- | --- | --- | --- |
| Request | Submit for review | Review | Needs Documents edit. Freezes the label snapshot on the copy. |
| Review | Engineering review complete | Review | Once. Engineering, or a title that can approve. |
| Review | Quality review complete | Review | Once. Quality, or a title that can approve. Either review can finish first. |
| Review | Approve | Approved | Both reviews and the manager PIN signature. The sheet freezes. |
| Review | Reject | Rejected | Approver title. A reason is required and is written into the audit line. |
| Rejected | Return to request | Request | Clears both reviews so they are done again on the corrected copy. |
| Approved | Start implementation | Implementation | Documents edit. Only the verification cells (answer, verified by, date) stay open. |
| Implementation | Close | Closed | Approver title. The verification answer must be YES or NO. A closed copy cannot be edited. |

## Required content

The sheet is the record. Submit does not block on an empty identification line, matching the ECR already in use. Close does block until the verification answer (YES or NO) is on the sheet. Approval blocks until both reviews and the manager signature are recorded.

Each kind's identification line is the thing being changed: part numbers (ECR), drawing number, process name, or document number. The rest of that kind's typical fields are the labeled lines on the same grid.

## 1. Drawing Change Request (DCR)

**Purpose.** Ask for a drawing to be revised, replaced, or withdrawn, and record what happens to the old revision.

**Typical fields.** Drawing number, current revision, proposed revision, part numbers, reason, marked-up difference, fit/form/function, validation needed, stock disposition (use as-is, scrap, rework) for raw material, WIP, and finished goods.

**Links.** Drawing number, part number, related process, and any specification the drawing calls out.

**Disposition.** The old revision stays in force until approval. After approval, the disposition lines say whether old stock is used, scrapped, or reworked. The new revision is the one released at implementation.

**Training and impact.** Training required, a training reference, customer notification, and whether PPAP or validation must be repeated.

**Where it lives.** Blank Forms and the filled-record list at `/iso-forms/frm-dwg-001`. Save to folder files the copy into Documents. History is the ISO form history panel. Suggested folder: Engineering / Engineering Change Control / Drawing Change Requests.

**Built on the shared engine.** Same stages, role checks, PIN structure gate, and history as ECR. Rev A. Do not add a sidebar entry.

## 2. Engineering Change Request (ECR) — built

**Purpose.** Ask engineering to change a part, a specification, or a related drawing, and carry that change through review, approval, implementation, and close.

**Form.** FRM-ECR-001, Engineering Change Request. It is the dense sheet already filed from Blank Forms into Documents. Rev B adds the links, training, and impact section and the workflow status line. Older filled copies keep the revision they were started on.

**Typical fields.** Date, requester, part numbers, current and proposed revision, job, change type, description (current versus proposed), reason, drawing update, fit/form/function, validation plan, mix-prevention, planned batch, stock disposition, manager and supplier signatures, implementation verification.

**Links.** Part number, affected drawing, affected document, and affected process. These are identifiers on the sheet so a person can trace them. They are not a second copy of the document.

**Disposition.** Current revision and proposed revision are on the identification block. Section 4 records use-as-is, scrap, or rework for raw material, WIP, and finished goods.

**Training and impact.** Training required, training reference, customer notification, and PPAP or validation impact. These are checklist hooks. They do not open a training assignment by themselves.

**Where it lives.** Blank Forms and the filled-record list at `/iso-forms/frm-ecr-001`. Save to folder files the copy into Documents. History is the ISO form history panel.

**Template edits.** Edit structure on an open ECR. The role check matches the other form-structure editors. The PIN flow matches a signature. A saved edit that does not change the labels keeps the current VERSION and REV. A real change advances them. Copies already submitted keep the labels they were submitted with. A request that has not been submitted, and every new copy, uses the new master.

## 3. Process Change Request (PCR)

**Purpose.** Ask to change how a part is made: method, tooling, equipment, control plan, or process flow. This is not the existing Product / Process Change Notice sheet. That notice stays as it is.

**Typical fields.** Process name, operation, current method, proposed method, affected part and drawing, reason, risk to fit/form/function, validation or capability study, mix-prevention, effectivity date, stock disposition.

**Links.** Process or routing identifier, part, drawing, control plan, and work instruction.

**Disposition.** Old method stays in force until approval. Implementation records the first batch on the new method. Old stock follows the same use-as-is, scrap, or rework lines as ECR.

**Training and impact.** Operators who run the process, customer notification, and PPAP or control-plan impact.

**Where it lives.** Blank Forms and `/iso-forms/frm-pcr-001`. Suggested folder: Engineering / Engineering Change Control / Process Change Requests. This is not the Process Change sidebar item.

**Built on the shared engine.** Same stages, roles, PIN structure gate, and history as ECR. Rev A.

## 4. Document Change Request (DocCR)

**Purpose.** Ask to revise, add, or retire a controlled document (procedure, work instruction, form, or specification). The Document changes page already in the app stays as it is. This design is the later sheet, cloned from ECR, not a rewrite of that page.

**Typical fields.** Document number, current revision, proposed revision, document title, reason, summary of the edit, related process or part, training required before release, and the old-revision disposition (obsolete, archive, or keep for traceability).

**Links.** Document number, process, and any part or drawing the document controls.

**Disposition.** The released revision stays in force until the request is implemented. Close records that the new revision is the one in use and what happened to the old one.

**Training and impact.** Training required before the new revision is used, training reference, and whether external distribution is required.

**Where it lives.** Blank Forms and `/iso-forms/frm-doc-001`. Suggested folder: Quality / Document Control / Document Change Requests. The Document changes page already in the app stays as it is.

**Built on the shared engine.** Same stages, roles, PIN structure gate, and history as ECR. Rev A.

## What the four requests share

- The stage order and the two parallel reviews.
- Documents edit to create and fill. Approver titles to approve, reject, and close.
- PIN and certification for record signatures.
- PIN, certification, and the existing structure-edit roles before a template change, with VERSION and REV moving only when the structure hash changes.
- Filing from Blank Forms into a Documents folder.
- Audit history on the record.

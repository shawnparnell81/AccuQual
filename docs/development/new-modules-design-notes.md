# Design notes: the versioning engine, quarantine, calibration, and training

Document versioning shipped in PR #76. Equipment and calibration, quarantine, and training and competency shipped in PR #77. This file is why each is built this way. The API shape is in OpenAPI.

## The shared document-versioning engine

`services/api/src/modules/versioning/versioning.service.ts` is one
draft → in_review → published state machine shared by every controlled
document type (Document Control, Workflow Builder's workflows,
Management Review, Context of the Organization) rather than four separate
implementations.

A subject opts in by implementing `SubjectAdapter` — every hook is
optional, so a subject only overrides the ones where it differs from the
default:

- `bootstrapStatus(live)` — if the subject already has a status word of
  its own (a workflow's `status` column, say), map it onto
  `"published" | "draft" | "in_review"` instead of trusting the engine's
  own tracking naively.
- `guardDraft(db, companyId, subjectId)` — throw to block a new draft (e.g.
  a document mid-review already).
- `seedDraft(payload, ctx)` — what a *new* draft starts from when revising
  a published version (usually just the published payload verbatim; a
  subject can strip fields that shouldn't carry forward).
- `checkPayload(db, companyId, subjectId, versionNumber, payload, stage)` —
  validation that only applies at a given stage (`"save" | "submit" |
  "publish"`) — e.g. a document can be saved half-filled but not
  published that way.
- `onTransition(db, companyId, subjectId, event)` — side effects (an
  audit-trail row, a notification) on `draft_created`, `submitted`,
  `published`, etc.
- `notifyReviewLifecycle` — whether the generic reviewer-notification
  path fires for this subject.

**Why one engine instead of four:** the four subjects' actual state
machines are identical in shape — draft, review, publish, a frozen
published record, a new draft revises without touching the live one — the
differences are all in what happens *around* a transition, which is
exactly what the adapter hooks are for. A `controlled_versions` table with
a DB-level freeze trigger (`version-freeze.sql`) makes a published version
physically un-editable, not just discouraged by application code — the
same trigger the Full-System Audit and PR #52's canvas work both rely on.

**Where each of the four differs, in practice:** Document Control's
`checkPayload` enforces required metadata only at `"publish"`; Workflow
Builder's `onTransition` is what triggers the DB freeze audit entry for
its canvas; Management Review and Context of the Organization are
deliberately-simple fixed singletons layered on the same engine rather
than a real list+detail module (see the README's "Remaining TODOs" —
that's a known, accepted simplification, not a bug).

## Quarantine: real enforcement, not a status flag

`quarantine_records` (the hold itself: reason, quantity, status,
disposition) is a genuinely separate table from inventory — the thing
that makes a hold *real* rather than cosmetic lives in inventory's own
tables: `inventory_items.held_qty` and `inventory_lots.held_qty`,
written only by `modules/inventory/inventoryHolds.service.ts`.

Every place inventory quantity actually moves —
`applyMovement`/`reserveStock`/`consumeFromLot` — calls
`inventoryHoldGuard.ts`'s `assertNotHeld` before letting the move
through:

```ts
// held > 0 && totalOnHand - quantity < held  → refuse
```

That's a deliberately narrow, dependency-free file: it imports nothing
from the rest of `inventory`, specifically so any code that moves or
reserves stock can call it without a circular import. A lot-scoped hold
protects *that lot's* held units specifically — releasing lot A's hold
never accidentally frees lot B's.

**Two-person release is enforced in the service, not just a UI
convention:** whoever opened a hold cannot be the one who releases,
destroys, or relocates it — see `quarantine.service.ts`'s check before
any resolution write. `quarantine_resolutions` is append-only (DB
trigger, same `version-freeze.sql` pattern as controlled versions) —
history of who released/destroyed what is permanent.

**Known, accepted gap:** held quantity is not netted out of the low-stock
alert calculation — a heavily-held item can still show as "adequate
stock" because the alert only looks at total on-hand, not
available-minus-held. Documented, not yet fixed.

## Calibration: due status is computed, never stored

`dueStatusOf(nextDueAt, latestFailed, now)` in
`calibration.service.ts` is a pure function — given equipment's next due
date and whether its latest result failed, it returns one of
`failed | uncalibrated | overdue | due_soon | upcoming | current`
(30/60-day thresholds). Nothing persists a due-status column that could
drift from reality; every view recomputes it from `nextDueAt` and the
latest result at read time.

**A failed calibration moves equipment to `out_of_service`
automatically** — this is a real side effect in the service layer, not
just a display state. Bringing it back into service requires an explicit
override with a reason, which is recorded (who, when, why) — there's no
silent path back to `in_service`.

The 6-hourly sweep (`startCalibrationSweep`, `index.ts`) and the
attention-list endpoint both call the same `dueStatusOf` — one function,
two consumers, so "what's due" can't disagree between the digest email
and the on-screen list.

## Training & competency: qualification is computed, never stored

The core of the module is `qualificationStatus(inputs, now)` in
`training.service.ts` — a pure function that takes the person's latest
completed training, their latest *decided* competency evaluation, the
course's validity window, and the course's linked document's current
version, and returns one of ten states (`qualified`, `expiring_soon`,
`expired`, `revision_changed`, `failed`, `awaiting_evaluation`,
`overdue`, `in_progress`, `assigned`, `not_trained`).

Deliberately **not** a stored column: qualification depends on things
that change independently of any training event (a course's linked
document getting a new released version should retroactively mean
"retrain," without a batch job going and updating everyone's row). Read
`qualificationStatus`'s own branches for the exact precedence — most
notably, a `fail` decided *after* someone's last completion overrides
otherwise-valid training (`evalFailedSinceTraining`'s timestamp
comparison), and a document revision after someone's completion produces
`revision_changed` even if their training hasn't technically expired yet.

**A decided competency evaluation is frozen** (`training_competencies`
trigger, same append-only pattern as quarantine resolutions and published
document versions) — a mistaken "pass" is corrected by recording a new
evaluation, never by editing the old one. Nobody can evaluate their own
competency (admin excepted, and that exception is itself recorded).

**Known, accepted gaps:** no prerequisite enforcement (course A required
before course B isn't modeled); the existing "Competency Matrix" *form*
(the source spreadsheet layout, in the generic forms engine)
is intentionally untouched and separate from this module's computed
"Training status" view — they answer different questions and were never
meant to be merged.

## Pass/Fail is calculated

Every AccuQual form that has a Pass/Fail result (or the same kind of
disposition) calculates that result from the requirement and the
measured value. Inside the tolerance is Pass, shown green. Outside the
tolerance is Fail, shown red. The cell stays blank until both sides of
the comparison are filled, and it is not a dropdown.

The check lives in `services/api/src/utils/passFail.ts` (re-exported for
grids from `apps/web/src/lib/passFail.ts`). A new measured grid calls
`rowPassFail` — or adds a `kind: "computed"` column whose formula is
`dimensionalPassFail` or `characteristicStatus` — instead of a Pass/Fail
select. Screen, saved JSON, and PDF all use that result. No migration:
the word is stored on the row that already holds the readings.

Reference sheet: Production Part Approval — Dimensional Test Results
(`dimensional_report`). Each row's Nominal, Tolerance, and Actual fill
Pass / Fail. An older row that still has Specification / Limits and
Organization Measurement Results is copied into those three columns the
next time the form opens.

Also calculated:

- First Article Inspection (same dimensional sheet) — already calculated
  on screen; the word is now stored on the line when the record is saved.
- Final Inspection key characteristics — Specification & Tolerance
  against Actual Result(s).
- Quality Inspection checklist rows — when Min, Max, and Actual Value
  are filled. A row with no numbers (a visual check) still uses the
  Pass/Fail choice.

Already calculated, left as they are: CSA Validation Report row results,
and Fuel Pump measured results plus the section 6 Pass/Fail.

Left as a manual choice, because the row is a judgment rather than a
tolerance check, or because the sheet already has a deliberate override:

- NCR corrective-action effectiveness, and the rest of NCR / CAPA / 8D.
- DVP&R OK / KO, Appearance Approval OK / NOT OK, calibration
  pass / fail / adjusted.
- Final inspection prerequisite, product, and packaging rows
  (Pass / Fail / N/A).
- Fuel Pump section 7 further review (a later human decision after a
  failed sample).
- CSA overall disposition, which includes Conditional Pass.
- Quality inspection rows that have no numeric min, max, and actual.

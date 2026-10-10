import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { emptyTeamDraft, TEAM_STEPS, validateTeamStep, type TeamDraft } from "./newTeamMember";
import { NewTeamMemberWizard } from "./NewTeamMemberWizard";

function filled(): TeamDraft {
  return {
    ...emptyTeamDraft(),
    name: "Jamie Rivera",
    preferredName: "Jamie",
    jobTitle: "Quality inspector",
    roleId: "2",
    department: "quality",
    siteIds: [1],
    email: "jamie.rivera@plant.example",
    phone: "214",
    employeeId: "E-4410",
    hireDate: "2026-03-02",
    employmentType: "full_time",
    shift: "day",
    siteLocation: "Inspection crib",
    bio: "Incoming inspector on first shift.",
    password: "Violet-Lantern-88!",
    requireMfa: true,
    trainingCourseIds: [9],
    documentIds: [4],
  };
}

const roles = [{ id: 2, name: "staff", displayName: "Staff" }];
const people = [{ id: 1, name: "Pat Kim", email: "pat@plant.example", isActive: true }];
const sites = [
  { id: 1, name: "Greer" },
  { id: 2, name: "Wellman" },
];
const courses = [{ id: 9, title: "Document control awareness", description: "Read the procedure." }];
const documents = [{ id: 4, title: "SOP-001 Control of documents", status: "approved" }];
const preview = {
  capabilities: ["Can view login history"],
  departmentAccess: ["Can change NCR."],
  extraRoles: [],
  adjustPath: "/admin/roles-permissions",
};

function renderStep(step: number, draft: TeamDraft = filled(), created: { id: number; name: string } | null = null): string {
  return renderToString(
    <MemoryRouter>
      <NewTeamMemberWizard
        step={step}
        draft={draft}
        error={step === 0 && !draft.name ? "Enter their full name." : null}
        busy={false}
        roles={roles}
        people={people}
        sites={sites}
        courses={courses}
        documents={documents}
        permissionRoles={[]}
        preview={preview}
        created={created}
        onDraft={() => undefined}
        onStep={() => undefined}
        onNext={() => undefined}
        onCreate={() => undefined}
        onAddAnother={() => undefined}
      />
    </MemoryRouter>,
  );
}

describe("New team member wizard", () => {
  it("checks each step before it continues", () => {
    const draft = emptyTeamDraft();
    assert.match(validateTeamStep(0, draft) ?? "", /full name/i);
    draft.name = "Jamie Rivera";
    assert.match(validateTeamStep(0, draft) ?? "", /role/i);
    draft.roleId = "2";
    assert.match(validateTeamStep(0, draft) ?? "", /site/i);
    draft.siteIds = [1];
    assert.equal(validateTeamStep(0, draft), null);
    assert.match(validateTeamStep(1, draft) ?? "", /email/i);
    draft.email = "jamie@plant.example";
    assert.equal(validateTeamStep(1, draft), null);
    assert.match(validateTeamStep(2, draft) ?? "", /12/);
    draft.password = "Violet-Lantern-88!";
    assert.equal(validateTeamStep(2, draft), null);
  });

  it("renders every step, the review, and the success page", () => {
    assert.equal(TEAM_STEPS.length, 5);
    const identity = renderStep(0);
    assert.match(identity, /New team member/);
    assert.match(identity, /Full name/);
    assert.match(identity, /Greer/);
    assert.match(identity, /Wellman/);
    assert.match(identity, /All sites/);
    assert.match(identity, /Jamie Rivera/);
    assert.match(identity, />Next</);

    const about = renderStep(1);
    assert.match(about, /Work email/);
    assert.match(about, /Employee ID/);
    assert.match(about, /E-4410/);
    assert.match(about, /Profile photo/);
    assert.doesNotMatch(about, /EMP-\d{4,}/);

    const access = renderStep(2);
    assert.match(access, /Temporary password/);
    assert.match(access, /Very strong/);
    assert.match(access, /Require two-step sign-in/);
    assert.match(access, /Can view login history/);
    assert.match(access, /Can change NCR/);
    assert.match(access, /permissions screen/);
    assert.match(access, /first time they sign in/);

    const training = renderStep(3);
    assert.match(training, /Required training/);
    assert.match(training, /Document control awareness/);
    assert.match(training, /SOP-001 Control of documents/);
    assert.match(training, /checklist/);

    const review = renderStep(4);
    assert.match(review, /Quality inspector/);
    assert.match(review, /jamie.rivera@plant.example/);
    assert.match(review, /Inspection crib/);
    assert.match(review, /Required/);
    assert.match(review, />Edit</);
    assert.match(review, /Create team member/);

    const blocked = renderStep(0, emptyTeamDraft());
    assert.match(blocked, /Enter their full name/);

    const success = renderStep(4, filled(), { id: 18, name: "Jamie Rivera" });
    assert.match(success, /Jamie Rivera can sign in/);
    assert.match(success, /View profile/);
    assert.match(success, /href="\/admin\/users\/18"/);
    assert.match(success, /Add another/);
    assert.match(success, /signature PIN/);
  });
});

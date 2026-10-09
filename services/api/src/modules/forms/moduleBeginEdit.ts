import { and, eq } from "drizzle-orm";
import { audits } from "../../drizzle/schema/audits.js";
import { capa } from "../../drizzle/schema/capa.js";
import { equipment } from "../../drizzle/schema/calibration.js";
import { changeRequests } from "../../drizzle/schema/change.js";
import { documentChangeRequests } from "../../drizzle/schema/documentChangeRequests.js";
import { eightD } from "../../drizzle/schema/eightD.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { quarantineRecords } from "../../drizzle/schema/quarantine.js";
import { riskAssessments } from "../../drizzle/schema/risk.js";
import { scarForms } from "../../drizzle/schema/scarForms.js";
import { trainingCourses } from "../../drizzle/schema/training.js";
import { beginFormEditHandler } from "./formEditAudit.js";

export const beginNcrEdit = beginFormEditHandler("NCR", async (db, id) => {
  const [row] = await db.select({ id: ncr.id }).from(ncr).where(and(eq(ncr.id, id), eq(ncr.isDeleted, false)));
  return row;
});

export const beginCapaEdit = beginFormEditHandler("CAPA", async (db, id) => {
  const [row] = await db.select({ id: capa.id }).from(capa).where(eq(capa.id, id));
  return row;
});

export const beginEightDEdit = beginFormEditHandler("8D Report", async (db, id) => {
  const [row] = await db.select({ id: eightD.id }).from(eightD).where(eq(eightD.id, id));
  return row;
});

export const beginRiskEdit = beginFormEditHandler("RiskAssessment", async (db, id) => {
  const [row] = await db.select({ id: riskAssessments.id }).from(riskAssessments).where(eq(riskAssessments.id, id));
  return row;
});

export const beginAuditEdit = beginFormEditHandler("Audit", async (db, id) => {
  const [row] = await db.select({ id: audits.id }).from(audits).where(eq(audits.id, id));
  return row;
});

export const beginEquipmentEdit = beginFormEditHandler("Equipment", async (db, id) => {
  const [row] = await db.select({ id: equipment.id }).from(equipment).where(eq(equipment.id, id));
  return row;
});

export const beginDcrEdit = beginFormEditHandler("DocumentChangeRequest", async (db, id) => {
  const [row] = await db.select({ id: documentChangeRequests.id }).from(documentChangeRequests).where(eq(documentChangeRequests.id, id));
  return row;
});

export const beginTrainingCourseEdit = beginFormEditHandler("TrainingCourse", async (db, id) => {
  const [row] = await db.select({ id: trainingCourses.id }).from(trainingCourses).where(eq(trainingCourses.id, id));
  return row;
});

export const beginChangeEdit = beginFormEditHandler("Change request", async (db, id) => {
  const [row] = await db.select({ id: changeRequests.id }).from(changeRequests).where(eq(changeRequests.id, id));
  return row;
});

export const beginQuarantineEdit = beginFormEditHandler("Quarantine", async (db, id) => {
  const [row] = await db.select({ id: quarantineRecords.id }).from(quarantineRecords).where(eq(quarantineRecords.id, id));
  return row;
});

export const beginScarEdit = beginFormEditHandler("ScarForm", async (db, id) => {
  const [row] = await db.select({ id: scarForms.id }).from(scarForms).where(eq(scarForms.id, id));
  return row;
});

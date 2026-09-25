import { Router, type Request, type Response } from "express";
import multer from "multer";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb, type TenantDb } from "../../lib/tenantScope.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import * as service from "./training.service.js";
import {
  createCourseSchema,
  updateCourseSchema,
  assignSchema,
  assignRequiredSchema,
  completeAssignmentSchema,
  createSessionSchema,
  updateSessionSchema,
  completeSessionSchema,
  cancelSessionSchema,
  createCompetencySchema,
  decideCompetencySchema,
} from "./training.validation.js";
import {
  listCourses,
  createCourse,
  getCourse,
  updateCourse,
  listAssignmentsForCourse,
  assignHandler,
  completeHandler,
  completeAssignmentHandler,
  uploadCertificateHandler,
  downloadCertificateHandler,
  employeeHistoryHandler,
  listEmployeesHandler,
} from "./training.controller.js";

const idParam = (req: Request, name = "id") => {
  const id = Number(req.params[name]);
  if (!Number.isInteger(id) || id < 1) throw AppError.badRequest(`Invalid ${name}`);
  return id;
};
const dbOf = (req: Request) => req.db as TenantDb;
const actorOf = (req: Request) => ({ id: req.user!.id, roleName: req.user!.roleName });
const optNum = (v: unknown) => (typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

export const trainingRouter = Router();
// Had no RBAC gate at all before this, and no ResourceKey existed to add
// one — structurally excluded from the permission system (Full-System
// Audit finding C2). Quality edit, everyone else read — see
// defaultPermissions.ts's own comment on this module's entry. Each route below also names the action it needs
// (training.view / manageCourses / manageSessions / evaluate), which resolves onto that same department access and writes a
// refusal to the audit trail.
trainingRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("training"));

const view = requirePermission("training.view");
const manageCourses = requirePermission("training.manageCourses");
const manageSessions = requirePermission("training.manageSessions");
const evaluate = requirePermission("training.evaluate");

// Same memoryStorage pattern as document-folders/calibration/documents.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Fixed-path routes first — would otherwise be swallowed by "/:id".
trainingRouter.get("/employees", view, listEmployeesHandler);
trainingRouter.get("/employee/:userId/history", view, employeeHistoryHandler);
trainingRouter.post("/assignment/:assignmentId/complete", manageSessions, validate(completeAssignmentSchema), completeAssignmentHandler);
trainingRouter.post("/assignment/:assignmentId/certificate", manageSessions, upload.single("file"), uploadCertificateHandler);
trainingRouter.get("/assignment/:assignmentId/certificate", view, downloadCertificateHandler);

// ---- Sessions ---------------------------------------------------------------------------------------------------------------------------------------
trainingRouter.get(
  "/sessions",
  view,
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    res.json(await service.listSessions(dbOf(req), { courseId: optNum(q.courseId), status: q.status }));
  }),
);
trainingRouter.post(
  "/session",
  manageSessions,
  validate(createSessionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await service.scheduleSession(dbOf(req), req.body as service.SessionInput, req.user?.id));
  }),
);
trainingRouter.get(
  "/session/:id",
  view,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.getSession(dbOf(req), idParam(req)));
  }),
);
trainingRouter.patch(
  "/session/:id",
  manageSessions,
  validate(updateSessionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.updateSession(dbOf(req), idParam(req), req.body as Parameters<typeof service.updateSession>[3], req.user?.id));
  }),
);
trainingRouter.post(
  "/session/:id/complete",
  manageSessions,
  validate(completeSessionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.completeSession(dbOf(req), idParam(req), req.body as Parameters<typeof service.completeSession>[3], req.user?.id));
  }),
);
trainingRouter.post(
  "/session/:id/cancel",
  manageSessions,
  validate(cancelSessionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.cancelSession(dbOf(req), idParam(req), (req.body as { reason: string }).reason, req.user?.id));
  }),
);

// ---- Competency ---------------------------------------------------------------------------------------------------------------------------------------
trainingRouter.get(
  "/competency",
  view,
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    res.json(await service.listCompetencies(dbOf(req), { userId: optNum(q.userId), courseId: optNum(q.courseId), status: q.status }));
  }),
);
trainingRouter.post(
  "/competency",
  evaluate,
  validate(createCompetencySchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await service.createCompetency(dbOf(req), req.body as Parameters<typeof service.createCompetency>[2], actorOf(req)));
  }),
);
trainingRouter.post(
  "/competency/:id/evaluate",
  evaluate,
  validate(decideCompetencySchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.decideCompetency(dbOf(req), idParam(req), req.body as service.DecideInput, actorOf(req)));
  }),
);

// ---- Who is qualified ---------------------------------------------------------------------------------------------------------------------------------
trainingRouter.get(
  "/status",
  view,
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    res.json(await service.trainingStatus(dbOf(req), { courseId: optNum(q.courseId), userId: optNum(q.userId), department: q.department, status: q.status }));
  }),
);
trainingRouter.get(
  "/attention",
  view,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.attention(dbOf(req)));
  }),
);
trainingRouter.post(
  "/notify-due",
  manageSessions,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await service.notifyDue(dbOf(req)));
  }),
);

// ---- Courses ------------------------------------------------------------------------------------------------------------------------------------------
trainingRouter.get("/", view, listCourses);
trainingRouter.post("/", manageCourses, validate(createCourseSchema), createCourse);
trainingRouter.post("/course", manageCourses, validate(createCourseSchema), createCourse); // the specification's URL for the same thing
trainingRouter.get("/:id", view, getCourse);
trainingRouter.patch("/:id", manageCourses, validate(updateCourseSchema), updateCourse);
trainingRouter.get("/:id/assignments", view, listAssignmentsForCourse);
trainingRouter.post("/:id/assign", manageSessions, validate(assignSchema), assignHandler);
trainingRouter.post(
  "/:id/assign-required",
  manageSessions,
  validate(assignRequiredSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await service.assignRequired(dbOf(req), idParam(req), { dueAt: (req.body as { dueAt?: Date }).dueAt }, req.user?.id));
  }),
);
trainingRouter.post("/:id/complete", manageSessions, completeHandler); // retired: answers 410 with the replacement

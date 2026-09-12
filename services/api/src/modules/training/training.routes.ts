import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createCourseSchema, assignSchema } from "./training.validation.js";
import { listCourses, createCourse, getCourse, assignHandler, completeHandler } from "./training.controller.js";

export const trainingRouter = Router();
trainingRouter.use(requireAuth, withTenantDb);

trainingRouter.get("/", listCourses);
trainingRouter.post("/", validate(createCourseSchema), createCourse);
trainingRouter.get("/:id", getCourse);
trainingRouter.post("/:id/assign", validate(assignSchema), assignHandler);
trainingRouter.post("/:id/complete", completeHandler);

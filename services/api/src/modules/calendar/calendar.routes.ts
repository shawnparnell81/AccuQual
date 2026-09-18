import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { getCalendarItems } from "./calendar.controller.js";

export const calendarRouter = Router();
calendarRouter.use(requireAuth, withTenantDb);

calendarRouter.get("/", getCalendarItems);

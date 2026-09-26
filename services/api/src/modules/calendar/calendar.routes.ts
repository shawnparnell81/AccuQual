import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { withSiteContext } from "../sites/siteContext.js";
import { getCalendarItems } from "./calendar.controller.js";

export const calendarRouter = Router();
calendarRouter.use(requireAuth, withDb, withSiteContext);

calendarRouter.get("/", getCalendarItems);

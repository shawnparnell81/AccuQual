import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { exportLoginHistoryHandler, listLoginHistoryHandler, requireLoginHistory } from "./loginHistory.controller.js";

export const loginHistoryRouter = Router();

loginHistoryRouter.use(requireAuth, withDb, requireLoginHistory);
loginHistoryRouter.get("/export", exportLoginHistoryHandler);
loginHistoryRouter.get("/", listLoginHistoryHandler);

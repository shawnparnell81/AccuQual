import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { createModelSchema, updateModelSchema, simulateSchema, iotIngestSchema, registerDeviceSchema, updateDeviceSchema } from "./digital-twin.validation.js";
import { baseHandlers, simulateDigitalTwin, getSimulation, ingestIot, listDevicesHandler, registerDeviceHandler, updateDeviceHandler, deleteDeviceHandler, listAlertsHandler, rotateDeviceKeyHandler, revokeDeviceKeyHandler } from "./digital-twin.controller.js";

export const digitalTwinRouter = Router();
digitalTwinRouter.use(requireAuth, withDb);

// Model creation/editing and device registration are admin-only (see the
// Tenant Digital Twin Setup review) — a real tightening, but not a
// back-compat break: no frontend ever called these POST/PATCH endpoints
// before this round (DigitalTwinPage only ever listed models — "create one
// via the API/DB seed"). /simulate is deliberately NOT gated here: the
// existing DigitalTwinPage already has a real, live "Run simulation" button
// any tenant user can use today — restricting it now would be an actual
// regression, not a tightening. Viewing (GET) stays open to the whole
// tenant throughout, unchanged.
digitalTwinRouter.get("/models", baseHandlers.list);
digitalTwinRouter.post("/models", requireRole("admin"), validate(createModelSchema), baseHandlers.create);
digitalTwinRouter.get("/models/:id", baseHandlers.getOne);
digitalTwinRouter.patch("/models/:id", requireRole("admin"), validate(updateModelSchema), baseHandlers.update);

digitalTwinRouter.post("/simulate", validate(simulateSchema), simulateDigitalTwin);
digitalTwinRouter.get("/simulations/:id", getSimulation);

digitalTwinRouter.get("/devices", listDevicesHandler);
digitalTwinRouter.post("/devices", requireRole("admin"), validate(registerDeviceSchema), registerDeviceHandler);
digitalTwinRouter.patch("/devices/:id", requireRole("admin"), validate(updateDeviceSchema), updateDeviceHandler);
digitalTwinRouter.delete("/devices/:id", requireRole("admin"), deleteDeviceHandler);

digitalTwinRouter.post("/devices/:id/api-key", requireRole("admin"), rotateDeviceKeyHandler);
digitalTwinRouter.delete("/devices/:id/api-key", requireRole("admin"), revokeDeviceKeyHandler);

// Drift alerts the worker recorded — viewing stays open to the whole tenant, like every other GET here.
digitalTwinRouter.get("/alerts", listAlertsHandler);

digitalTwinRouter.post("/iot-ingest", validate(iotIngestSchema), ingestIot);

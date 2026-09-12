import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createModelSchema, updateModelSchema, simulateSchema, iotIngestSchema } from "./digital-twin.validation.js";
import { baseHandlers, simulateDigitalTwin, getSimulation, ingestIot } from "./digital-twin.controller.js";

export const digitalTwinRouter = Router();
digitalTwinRouter.use(requireAuth, withTenantDb);

digitalTwinRouter.get("/models", baseHandlers.list);
digitalTwinRouter.post("/models", validate(createModelSchema), baseHandlers.create);
digitalTwinRouter.get("/models/:id", baseHandlers.getOne);
digitalTwinRouter.patch("/models/:id", validate(updateModelSchema), baseHandlers.update);

digitalTwinRouter.post("/simulate", validate(simulateSchema), simulateDigitalTwin);
digitalTwinRouter.get("/simulations/:id", getSimulation);

digitalTwinRouter.post("/iot-ingest", validate(iotIngestSchema), ingestIot);

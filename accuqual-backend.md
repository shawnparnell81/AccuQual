# AccuQual Backend Specification

## 1. Backend Technology Stack

- **Node.js** (runtime)
- **Express** (HTTP framework)
- **Drizzle ORM** (database layer)
- **PostgreSQL** (primary DB)
- **Zod** (schema validation)
- **JWT** (authentication)
- **Winston** (logging)
- **Multer** (file uploads)
- **pgvector** (AI embeddings)
- **Redis Streams** (workflow + event queue)
- **ElasticSearch** (search + analytics)

---

## 2. Backend Folder Structure

```
services/api/
  src/
    modules/
      ncr/
      capa/
      audits/
      documents/
      training/
      change/
      risk/
      supplier/
      calibration/
      complaints/
      workflow/
      ai/
      digital-twin/
    middleware/
    routes/
    controllers/
    services/
    db/
    utils/
    index.ts
  drizzle/
    schema/
    migrations/
```

---

## 3. API Endpoint Specification

### AUTH
- POST `/auth/register`
- POST `/auth/login`
- POST `/auth/refresh`
- POST `/auth/logout`
- GET `/auth/me`

### USERS & ROLES
- GET `/users`
- POST `/users`
- GET `/users/:id`
- PATCH `/users/:id`
- DELETE `/users/:id`
- GET `/roles`
- POST `/roles`
- PATCH `/roles/:id`

### DOCUMENT CONTROL
- GET `/documents`
- POST `/documents`
- GET `/documents/:id`
- POST `/documents/:id/version`
- POST `/documents/:id/approve`
- GET `/documents/:id/history`

### NCR
- GET `/ncr`
- POST `/ncr`
- GET `/ncr/:id`
- PATCH `/ncr/:id`
- POST `/ncr/:id/assign`
- POST `/ncr/:id/containment`
- POST `/ncr/:id/root-cause`
- POST `/ncr/:id/corrective-action`
- POST `/ncr/:id/close`

### CAPA
- GET `/capa`
- POST `/capa`
- GET `/capa/:id`
- PATCH `/capa/:id`
- POST `/capa/:id/verify`
- POST `/capa/:id/close`

### 8D
- GET `/8d`
- POST `/8d`
- GET `/8d/:id`
- PATCH `/8d/:id`
- POST `/8d/:id/complete-step/:step`

### AUDITS
- GET `/audits`
- POST `/audits`
- GET `/audits/:id`
- POST `/audits/:id/item`
- POST `/audits/:id/complete`

### TRAINING
- GET `/training`
- POST `/training`
- POST `/training/:id/assign`
- POST `/training/:id/complete`

### CHANGE MANAGEMENT
- GET `/change`
- POST `/change`
- PATCH `/change/:id`
- POST `/change/:id/approve`

### RISK / FMEA
- GET `/risk`
- POST `/risk`
- GET `/risk/:id`
- POST `/risk/:id/fmea`

### SUPPLIER QUALITY
- GET `/suppliers`
- POST `/suppliers`
- GET `/suppliers/:id`
- POST `/suppliers/:id/scorecard`

### CALIBRATION
- GET `/equipment`
- POST `/equipment`
- POST `/equipment/:id/calibration`

### CUSTOMER COMPLAINTS
- GET `/complaints`
- POST `/complaints`
- PATCH `/complaints/:id`

### WORKFLOW ENGINE
- GET `/workflow`
- POST `/workflow`
- POST `/workflow/:id/run`

### AI ENGINE
- POST `/ai/root-cause`
- POST `/ai/capa`
- POST `/ai/8d`
- POST `/ai/risk-score`
- POST `/ai/analysis`

### DIGITAL TWIN
- GET `/digital-twin/models`
- POST `/digital-twin/models`
- POST `/digital-twin/simulate`
- POST `/digital-twin/iot-ingest`

---

## 4. Example Controllers

### NCR Controller Example

```ts
export const createNcr = async (req, res) => {
  const { title, description, severity, assignedTo } = req.body;
  const userId = req.user.id;

  const [created] = await db.insert(ncr).values({
    title,
    description,
    severity,
    assignedTo,
    createdBy: userId,
  }).returning();

  res.status(201).json(created);
};
```

### AI Root Cause Controller Example

```ts
export const analyzeRootCause = async (req, res) => {
  const { ncrId, ncrData } = req.body;

  const suggestion = await callRootCauseLLM(ncrData);

  const [saved] = await db.insert(aiSuggestions).values({
    module: "ncr",
    input: ncrData,
    output: suggestion,
    createdBy: req.user.id,
  }).returning();

  res.json(saved);
};
```

---

## 5. Backend Cross-Cutting Concerns

### Authentication
- JWT access + refresh tokens
- Role-based access control (RBAC)
- Optional MFA

### Logging
- Winston logger
- Centralized log aggregation

### Audit Trails
- Every change logged
- Immutable history

### Error Handling
- Global error middleware
- Structured error responses

### Security
- OWASP best practices
- Rate limiting
- Input validation (Zod)

---

## 6. TODOs for Claude

### Backend TODOs
- TODO: Scaffold all controllers
- TODO: Scaffold all routes
- TODO: Implement RBAC middleware
- TODO: Implement JWT auth system
- TODO: Implement Zod validation schemas
- TODO: Implement service layer for each module
- TODO: Implement global error handler
- TODO: Implement logging framework
- TODO: Implement file upload service
- TODO: Implement Redis Streams event bus

### Integration TODOs
- TODO: Create ERP/MES integration stubs
- TODO: Create IoT ingestion endpoints
- TODO: Create AI engine service bindings

